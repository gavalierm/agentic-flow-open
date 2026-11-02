// Observation logs (P-030, P-028, P-005, P-006): per-turn buffer in <brain>/local/log-buffer/, one brain write per turn.
import fs from 'node:fs';
import path from 'node:path';
import { readText, today, nowIso, listFiles, PLUGIN_ROOT } from './util.mjs';
import { brainWrite } from './brain.mjs';
import { rejectedProposal } from './find.mjs';

export const LOG_FILES = ['sequences.log', 'failures.log', 'procedures.log', 'derivations.log'];

export function bufferFile(brainDir, sessionId) {
  return path.join(brainDir, 'local', 'log-buffer', `${sessionId || 'unknown'}.jsonl`);
}

export function bufferAppend(brainDir, sessionId, entry) {
  const file = bufferFile(brainDir, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ t: nowIso(), ...entry }) + '\n');
}

export function readBuffer(brainDir, sessionId) {
  return readText(bufferFile(brainDir, sessionId), '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const INTERPRETERS = ['node', 'python', 'python3', 'bash', 'sh'];

/** Script of the installed workflow plugin (any install path or the hook placeholder). */
export function isWorkflowScript(p) {
  const norm = String(p).replace(/\\/g, '/');
  const root = String(PLUGIN_ROOT).replace(/\\/g, '/');
  return norm.startsWith(root + '/') || norm.includes('${CLAUDE_PLUGIN_ROOT}') || /\/\.claude\/skills\/workflow\//.test(norm);
}

/** Split a shell command line into simple commands and normalize to "program [subcommand]". */
export function normalizeCommand(command, policy) {
  const programs = policy?.logs?.subcommand_programs || [];
  const out = [];
  for (const part of String(command).split(/\s*(?:&&|\|\||;|\|)\s*/)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    if (!words.length) continue;
    let prog = words[0].split('/').pop();
    if (['sudo', 'time', 'env'].includes(prog) && words[1]) { words.shift(); prog = words[0].split('/').pop(); }
    // Interpreter + script: the script is the procedure (`node bin/<script>.mjs` -> `node <script>.mjs`). Scripts of the workflow
    // itself are already procedures with a skill and never count toward a skill proposal (P-005, pilot 2026-11-01).
    if (INTERPRETERS.includes(prog) && words[1] && /\.(m?js|cjs|py|sh)$/.test(words[1])) {
      if (isWorkflowScript(words[1])) continue;
      out.push(`${prog} ${words[1].split('/').pop()}`);
      continue;
    }
    let sub = null;
    if (programs.includes(prog)) {
      const cand = words.slice(1).find((w) => !w.startsWith('-'));
      if (cand && /^[a-z][a-z0-9:-]*$/.test(cand)) sub = cand;
    }
    out.push(sub ? `${prog} ${sub}` : prog);
  }
  return out;
}

export function isReadonly(normalized, policy) {
  const list = policy?.logs?.readonly_commands || [];
  return list.includes(normalized) || list.includes(normalized.split(' ')[0]);
}

export function sequencesFrom(commands, { min = 2, max = 5 } = {}) {
  const seqs = [];
  for (let len = min; len <= max; len++) {
    for (let i = 0; i + len <= commands.length; i++) {
      seqs.push(commands.slice(i, i + len).map((c) => c.replace(/\s+/g, '-')).join('+'));
    }
  }
  return seqs;
}

export function rotateLines(lines, days) {
  const cutoff = Date.now() - days * 864e5;
  return lines.filter((l) => {
    const d = Date.parse(l.slice(0, 10));
    return Number.isNaN(d) || d >= cutoff;
  });
}

export function countByField(lines, index = 1) {
  const counts = new Map();
  for (const l of lines) {
    const f = l.split(' ')[index];
    if (f) counts.set(f, (counts.get(f) || 0) + 1);
  }
  return counts;
}

/** Key of a P-030 proposal signal (`sequence <name> <n>x: propose a skill ...` -> `sequence <name>`), null for other signals. */
export function proposalKey(signal) {
  const m = /^sequence (\S+) \d+x: propose a skill/.exec(String(signal || ''));
  return m ? `sequence ${m[1]}` : null;
}

/** Turn the per-session buffer into log lines; returns ops for brainWrite and signals. */
export function flushBuffer(ctx, sessionId) {
  const { brainDir, policy } = ctx;
  const entries = readBuffer(brainDir, sessionId);
  const signals = [];
  if (!entries.length) return { written: false, signals };
  const logsDir = path.join(brainDir, 'logs');
  const seqLines = rotateLines(readText(path.join(logsDir, 'sequences.log'), '').split('\n').filter(Boolean), policy.logs.rotation_days);
  const failLines = readText(path.join(logsDir, 'failures.log'), '').split('\n').filter(Boolean);
  const before = countByField(seqLines);

  // Sequences: consecutive successful shell commands per agent; a failure breaks the run.
  const runs = new Map();
  const newSeqs = [];
  const push = (agent) => {
    const run = runs.get(agent) || [];
    if (run.length >= policy.logs.sequence_min_length) newSeqs.push(...sequencesFrom(run, { min: policy.logs.sequence_min_length, max: policy.logs.sequence_max_length }));
    runs.set(agent, []);
  };
  for (const e of entries) {
    const agent = e.agent || 'main';
    if (e.kind === 'cmd') {
      const run = runs.get(agent) || [];
      for (const c of e.commands || []) if (!isReadonly(c, policy)) run.push(c);
      runs.set(agent, run);
    } else if (e.kind === 'fail') {
      push(agent);
      failLines.push(`${e.t} ${agent} ${sessionId} ${(e.command || e.tool || '?').replace(/\s+/g, ' ').slice(0, 120)} :: ${(e.error || '').split('\n')[0].slice(0, 160)}`);
    }
  }
  for (const agent of runs.keys()) push(agent);
  const date = today();
  for (const s of newSeqs) seqLines.push(`${date} ${s} ${sessionId}`);
  const after = countByField(seqLines);
  const threshold = policy.thresholds.sequence_repeats;
  for (const s of new Set(newSeqs)) {
    if (after.get(s) >= threshold && (before.get(s) || 0) < threshold && !rejectedProposal(brainDir, s)) {
      signals.push(`sequence ${s} ${after.get(s)}x: propose a skill with a script (P-030)`);
    }
  }
  const oldFailures = failLines.filter((l) => {
    const d = Date.parse(l.slice(0, 10));
    return !Number.isNaN(d) && Date.now() - d > policy.logs.failure_signal_days * 864e5;
  });
  if (oldFailures.length) signals.push(`failures.log: ${oldFailures.length} unprocessed failure(s) older than ${policy.logs.failure_signal_days} days; run error skill (P-030)`);

  const ops = [
    { path: 'logs/sequences.log', content: seqLines.length ? seqLines.join('\n') + '\n' : '' },
    { path: 'logs/failures.log', content: failLines.length ? failLines.join('\n') + '\n' : '' },
  ];
  const res = brainWrite(ctx, { ops, internal: true, message: `logs flush ${sessionId}` });
  fs.rmSync(bufferFile(brainDir, sessionId), { force: true });
  return { written: res.committed, signals, unpushed: res.unpushed, sequences: newSeqs.length, failures: entries.filter((e) => e.kind === 'fail').length };
}

/** procedures.log / derivations.log (P-005, P-006): append names, rotate, report repeats. */
export function recordNames(ctx, logName, names, { thread }) {
  const { brainDir, policy } = ctx;
  const file = path.join(brainDir, 'logs', logName);
  let lines = rotateLines(readText(file, '').split('\n').filter(Boolean), policy.logs.rotation_days);
  const date = today();
  for (const n of names) lines.push(`${date} ${n} ${thread || '-'}`);
  const counts = countByField(lines);
  return { op: { path: `logs/${logName}`, content: lines.length ? lines.join('\n') + '\n' : '' }, counts, lines };
}

export function existingNames(brainDir, logName) {
  const lines = readText(path.join(brainDir, 'logs', logName), '').split('\n').filter(Boolean);
  return [...countByField(lines).entries()].map(([name, n]) => ({ name, count: n }));
}

export function removeNames(brainDir, logName, names) {
  const lines = readText(path.join(brainDir, 'logs', logName), '').split('\n').filter(Boolean);
  const keep = lines.filter((l) => !names.includes(l.split(' ')[1]));
  return { path: `logs/${logName}`, content: keep.length ? keep.join('\n') + '\n' : '' };
}

export function listFailures(brainDir) {
  return readText(path.join(brainDir, 'logs', 'failures.log'), '').split('\n').filter(Boolean);
}

export function pendingBuffers(brainDir) {
  return listFiles(path.join(brainDir, 'local', 'log-buffer'), (f) => f.endsWith('.jsonl'));
}
