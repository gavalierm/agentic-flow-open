#!/usr/bin/env node
// PreToolUse: brain protection (P-013, persona P-024), dangerous targets (P-018), work files outside the project (P-052), subagent limits incl. mail (P-025), decision binding (P-031), agent-to-agent channel (P-055), foreground waiting (P-057). Output: deny/ask or 1 line (c).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHookInput, emit, permissionOutput, contextOutput, isMain } from '../scripts/hooks-io.mjs';
import { loadContext, readThreadState, writeThreadState, personaWritable, SCRATCH_DIR } from '../scripts/config.mjs';
import { git, isInside, toPosix } from '../scripts/util.mjs';
import { findRelatesTo } from '../scripts/find.mjs';
import { SUBAGENT_ALLOWED } from '../scripts/comms.mjs';

export const HOOK_META = { event: 'PreToolUse', class: 'block+c', limit: '1 line', principles: ['P-013', 'P-018', 'P-024', 'P-025', 'P-031', 'P-052', 'P-055'] };

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

function targetOf(toolName, toolInput = {}) {
  if (toolName === 'NotebookEdit') return toolInput.notebook_path;
  if (FILE_TOOLS.includes(toolName)) return toolInput.file_path;
  return null;
}

/** Root of a sibling workflow project (or its topic copies) that contains abs; a persona manages them (P-024, P-052). */
export function managedProjectOf(projectDir, abs) {
  const parent = path.dirname(projectDir);
  const rel = path.relative(parent, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const top = rel.split(path.sep)[0];
  const name = top.endsWith('-topics') ? top.slice(0, -'-topics'.length) : top;
  return fs.existsSync(path.join(parent, name, '.workflow.json')) ? path.join(parent, top) : null;
}

/** Files this thread created (P-018): rewriting or deleting them is recoverable from the agent's own work. */
const CREATED_LIMIT = 500;
function createdByThread(ctx) {
  if (!ctx.brainDir || !ctx.thread) return new Set();
  return new Set(readThreadState(ctx.brainDir, ctx.thread).created_files || []);
}
function rememberCreated(ctx, abs) {
  if (!ctx.brainDir || !ctx.thread) return;
  const state = readThreadState(ctx.brainDir, ctx.thread);
  const list = (state.created_files || []).filter((f) => f !== abs);
  list.push(abs);
  writeThreadState(ctx.brainDir, ctx.thread, { ...state, created_files: list.slice(-CREATED_LIMIT) });
}

/** History operation that needs confirmation: a listed command as a whole word sequence, minus listed safe forms (P-018). */
export function historyOperation(normalized, asks, except = []) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = (a) => new RegExp(`(^|[\\s;&|(])${esc(a)}(?=\\s|$|[;&|)])`).test(normalized);
  if (except.some(hit)) return null;
  return asks.find(hit) || null;
}

/** Directory of the code copies of topics next to the project (P-036). */
export function topicsDir(projectDir) {
  return path.join(path.dirname(projectDir), `${path.basename(projectDir)}-topics`);
}

function existingAncestor(p) {
  let cur = p;
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return cur;
}

/** Danger classification of one filesystem target (P-018). */
export function classifyTarget(file) {
  const abs = path.resolve(file);
  const exists = fs.existsSync(abs);
  const anchor = existingAncestor(abs);
  const top = anchor ? git(['rev-parse', '--show-toplevel'], { cwd: fs.statSync(anchor).isDirectory() ? anchor : path.dirname(anchor) }) : { ok: false };
  if (!top.ok) return { dangerous: true, reason: 'not in a git repository', exists };
  const repo = path.resolve(top.stdout);
  const ignored = git(['check-ignore', '-q', '--', abs], { cwd: repo }).ok;
  if (ignored) return { dangerous: true, reason: 'ignored by git', exists, repo };
  if (!exists) return { dangerous: false, reason: 'new file', exists, repo };
  const status = git(['status', '--porcelain', '--', abs], { cwd: repo }).stdout;
  if (status.startsWith('??')) return { dangerous: true, reason: 'untracked', exists, repo };
  if (status.trim()) return { dangerous: true, reason: 'uncommitted changes', exists, repo };
  return { dangerous: false, reason: 'tracked and clean', exists, repo };
}

export function removedLines(toolInput, file) {
  if (toolInput.old_string !== undefined) {
    const oldLines = String(toolInput.old_string).split('\n').length;
    const newLines = String(toolInput.new_string ?? '').split('\n').length;
    return Math.max(0, oldLines - newLines);
  }
  if (toolInput.content !== undefined && fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8').split('\n').length;
  }
  return 0;
}

const MASK = { '>': '\u0001', ';': '\u0002', '&': '\u0003', '|': '\u0004', ' ': '\u0005' };
const UNMASK = Object.fromEntries(Object.entries(MASK).map(([k, v]) => [v, k]));

/** Heredoc bodies removed, operators and spaces inside quotes masked, so only real shell syntax is parsed. */
export function maskShell(command) {
  let cmd = String(command);
  cmd = cmd.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (m) => m.split('\n')[0]);
  return cmd.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (q) => q.replace(/[>;&| ]/g, (c) => MASK[c]));
}
const unmask = (s) => s.replace(/[\u0001-\u0005]/g, (c) => UNMASK[c]).replace(/^['"]|['"]$/g, '');

/**
 * Absolute filesystem targets a shell command writes or deletes (P-018, P-013). `cd <dir>` changes the base of
 * relative paths for the following parts; cp sources are only read; redirects to devices (>/dev/null, >&2) are not files.
 */
export function bashTargets(command, cwd = process.cwd()) {
  const targets = [];
  let base = cwd;
  const home = process.env.HOME || '';
  const abs = (p) => path.resolve(base, p.startsWith('~/') ? path.join(home, p.slice(2)) : p);
  for (const part of maskShell(command).split(/\s*(?:&&|\|\||;|\n)\s*/)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    const lead = words[0] === 'sudo' ? 1 : 0;
    const prog = words[lead]?.split('/').pop();
    const args = words.slice(lead + 1).filter((w) => !w.startsWith('-') && !/^['"]?[$<>|(`]/.test(w) && !/^[0-9]*>/.test(w));
    if (prog === 'cd') {
      if (args[0] && !/[$`]/.test(args[0])) base = abs(unmask(args[0]));
      continue;
    }
    if (['rm', 'mv', 'rmdir', 'truncate', 'shred'].includes(prog)) targets.push(...args.map((w) => abs(unmask(w))));
    if (prog === 'cp' && args.length > 1) targets.push(abs(unmask(args[args.length - 1])));
    for (const m of part.matchAll(/(?:^|\s)>{1,2}\s*(\S+)/g)) {
      const target = unmask(m[1]);
      if (!/^(&|\/dev\/|\$)/.test(target)) targets.push(abs(target));
    }
  }
  return targets;
}

/**
 * Mail in a subagent (P-025): any subagent may only read (`receive`, `list`, `count`) through the comms client.
 * Returns a deny reason or null.
 */
const INTERPRETERS = new Set(['node', 'nodejs', 'bun', 'deno']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const PREFIXES = new Set(['sudo', 'exec', 'time', 'env', 'nice', 'nohup', 'command', 'timeout']);

/**
 * Scripts a shell command executes: the head of each segment, `[prefix] [node [flags]] <script.mjs> args`, also inside
 * `sh -c "..."`. A script only named as an argument (`cat bin/comms.mjs`, `grep x bin/topic.mjs`) or in quoted text and
 * heredocs is not executed. Returns [{ script, args }].
 */
export function executedScripts(command, depth = 0) {
  const out = [];
  for (const seg of maskShell(command).split(/[;&|\n()`]+|\$\(/)) {
    const t = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < t.length && (PREFIXES.has(t[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]) || (PREFIXES.has(t[i - 1]) && /^-|^\d/.test(t[i])))) i++;
    const head = path.basename(t[i] || '');
    if (SHELLS.has(head) && depth < 2) {
      const c = t.indexOf('-c', i);
      if (c > 0 && t[c + 1]) out.push(...executedScripts(unmask(t[c + 1]), depth + 1));
      continue;
    }
    if (INTERPRETERS.has(head)) {
      i++;
      while (i < t.length && t[i].startsWith('-')) i++;
      if (head === 'deno' && t[i] === 'run') i++;
    }
    if (t[i] && /\.[cm]?[jt]s$/.test(unmask(t[i]))) out.push({ script: toPosix(unmask(t[i])), args: t.slice(i + 1).map(unmask) });
  }
  return out;
}

export function commsSubagentCheck(command, agentType = '') {
  const cmd = String(command || '');
  const calls = executedScripts(cmd).filter((e) => /(^|\/)comms\.mjs$/.test(e.script)).map((e) => e.args.find((a) => !a.startsWith('-')) || '');
  for (const sub of calls) {
    if (!SUBAGENT_ALLOWED.includes(sub)) return `subagents do not send, ack or decide mail (comms ${sub}); they may only read it (receive, list, count), P-025`;
  }
  return null;
}

/** Denied tool (P-055): exact name or MCP-namespaced `mcp__<server>__<name>`. Returns the denied name or null. */
export function deniedTool(toolName, denied = []) {
  const t = String(toolName || '');
  return denied.find((d) => t === d || t.endsWith(`__${d}`)) || null;
}

const WAIT_UNIT = { '': 1, s: 1, m: 60, h: 3600, d: 86400 };
/**
 * P-057: a foreground command that waits for an event (sleep > 10 s, a loop that sleeps, watch) keeps the turn open
 * and burns tokens. Quoted data and heredoc bodies are not waits, except strings the shell runs (-c, eval, ssh, watch).
 * Returns the reason or null.
 */
export function foregroundWait(command) {
  let cmd = String(command).replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (m) => m.split('\n')[0]);
  cmd = cmd.replace(/(-c|\beval|\bssh\s+(?:-\S+\s+)*\S+|\bwatch(?:\s+-\S+)*)?(\s*)('[^']*'|"(?:[^"\\]|\\.)*")/g, (all, runs, sp, str) => {
    if (runs) return all;
    if (str[0] === '"' && /\$\(|`/.test(str)) return all;
    return `${sp}''`;
  });
  if (/\b(until|while)\b[\s\S]*\bsleep\b/.test(cmd)) return 'loop with sleep';
  if (/\bwatch\s+(-\S+\s+)*\S/.test(cmd)) return 'watch';
  for (const m of cmd.matchAll(/\bsleep\s+(\d+(?:\.\d+)?)([smhd]?)\b/g)) {
    if (Number(m[1]) * WAIT_UNIT[m[2]] > 10) return `sleep ${m[1]}${m[2]}`;
  }
  return null;
}

/** System temp directories (os.tmpdir(), /tmp, /var/tmp; WORKFLOW_TEMP_DIRS overrides, the test fixtures live in /tmp). */
export function isTempPath(abs, env = process.env) {
  const dirs = env.WORKFLOW_TEMP_DIRS ? env.WORKFLOW_TEMP_DIRS.split(path.delimiter).filter(Boolean) : [os.tmpdir(), '/tmp', '/var/tmp'];
  return dirs.some((d) => isInside(d, abs));
}

export function run(input) {
  const ctx = loadContext({ requireBrain: false });
  const tool = input.tool_name;
  const toolInput = input.tool_input || {};
  const cwd = input.cwd || process.cwd();
  const policy = ctx.policy;
  const resolve = (p) => path.resolve(cwd, p);

  // P-055: work for another agent goes through mail, never straight into its thread.
  const denied = deniedTool(tool, policy.harness?.denied_tools || []);
  if (denied) return permissionOutput('deny', `${denied} is not used to hand work to another agent: it has no reply path and wakes nobody; send mail (comms send --level blocker|assist --to @<persona>/main or [<project>/]<topic>), the answer comes as --reply-to and wakes you (P-055)`);

  // P-057: no foreground waiting; the agent arms a waker and ends the turn.
  if (tool === 'Bash' && !toolInput.run_in_background) {
    const why = foregroundWait(toolInput.command || '');
    if (why) return permissionOutput('deny', `foreground waiting (${why}) keeps the turn open and burns tokens; arm a waker and end the turn: mail reply/TTL (comms send --level blocker|assist), a scheduled re-check (harness scheduler, e.g. T3 schedule_task), or a background watcher (run_in_background) for an event on this machine; a pause up to 10 s is allowed (P-057)`);
  }

  // Subagent: no brain scripts, no mail except reading (P-025).
  if ((input.agent_id || input.agent_type) && (tool === 'Bash' || tool === 'PowerShell')) {
    const cmd = String(toolInput.command || '');
    const executed = executedScripts(cmd);
    const hit = (policy.harness?.subagent_denied_scripts || []).find((s) => executed.some((e) => e.script === s || e.script.endsWith(`/${s}`)));
    if (hit) return permissionOutput('deny', `subagents do not write to brain or hold topics (${hit}); return the result to the main agent (P-025)`);
    const comms = commsSubagentCheck(cmd, input.agent_type);
    if (comms) return permissionOutput('deny', comms);
  }

  // P-052: a worker brief built by hand misses the work-file path, and the worker then writes into /tmp (2026-11-02:
  // 13 operator confirmations in one implementation run). The brief comes from `delegate.mjs prepare`.
  if ((tool === 'Agent' || tool === 'Task') && /(^|:)worker$/.test(String(toolInput.subagent_type || ''))) {
    const scratch = toPosix(path.join(ctx.projectDir, SCRATCH_DIR));
    if (!String(toolInput.prompt || '').includes(`${scratch}/`)) {
      return permissionOutput('deny', `worker brief has no work-file path (${scratch}/), so the worker would write into /tmp and every write would ask the operator; build the brief with delegate.mjs prepare --task "..." and pass its output as the prompt (workflow:delegate, P-052)`);
    }
  }

  const target = targetOf(tool, toolInput);
  if (target) {
    const abs = resolve(target);
    if (ctx.brainDir && isInside(ctx.brainDir, abs) && !personaWritable(ctx, abs)) {
      const persona = ctx.persona ? `; in a persona only ${SCRATCH_DIR}/ and local/ are written directly, outputs belong to the managed projects (P-024)` : '';
      return permissionOutput('deny', `direct write into brain is not allowed; use workflow:save, topic or finish (P-013, P-040)${persona}`);
    }
    // P-052: work files stay in the project; topic copies ../<project>-topics/ are part of the project's work (P-036).
    if (ctx.brainInfo && !ctx.brainInfo.error && !isInside(ctx.projectDir, abs) && !isInside(topicsDir(ctx.projectDir), abs) && !(ctx.persona && managedProjectOf(ctx.projectDir, abs))) {
      // A temp file is never a target the operator named: redirect the agent instead of asking the operator (2026-11-02).
      if (isTempPath(abs)) return permissionOutput('deny', `target ${toPosix(abs)} is in the system temp dir; write work files to ${toPosix(path.join(ctx.projectDir, SCRATCH_DIR))}/ instead (gitignored, no confirmation, P-052)`);
      return permissionOutput('ask', `target ${toPosix(abs)} is outside the project; work files go to ${toPosix(path.join(ctx.projectDir, SCRATCH_DIR))}/ (gitignored, free to write without asking${ctx.persona ? ', also in a persona brain' : ''}, P-052); write elsewhere only to a target the operator named`);
    }
    const generatedSkills = /[\\/]\.(claude|agents)[\\/]skills[\\/]/.exec(abs);
    if (tool !== 'NotebookEdit' && generatedSkills && isInside(ctx.projectDir, abs)) {
      return permissionOutput('deny', `.${generatedSkills[1]}/skills/ in the project is generated from brain at session start; edit skills in brain via workflow:save (P-017)`);
    }
    const inScratch = isInside(path.join(ctx.projectDir, SCRATCH_DIR), abs);
    const createdHere = createdByThread(ctx).has(abs);
    const cls = inScratch || createdHere ? { dangerous: false, exists: fs.existsSync(abs) } : classifyTarget(abs);
    if (!cls.exists && !inScratch) rememberCreated(ctx, abs);
    let out = null;
    if (cls.dangerous && cls.exists) {
      const removed = removedLines(toolInput, abs);
      const total = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n').length : 0;
      const whole = tool === 'Write' || tool === 'NotebookEdit';
      const thr = policy.destructive || {};
      if (whole || removed > (thr.removed_lines_threshold ?? 50) || (total && removed > total * (thr.removed_fraction_threshold ?? 0.5))) {
        out = permissionOutput('ask', `target ${toPosix(path.relative(cwd, abs))} is ${cls.reason} (not recoverable from git); ${whole ? 'overwriting the whole file' : `removing ${removed} of ${total} lines`} needs operator confirmation with the exact target list (P-018)`);
      }
    }
    // Decision binding (P-031): one line, once per file per thread.
    if (ctx.brainDir) {
      const rel = isInside(ctx.projectDir, abs) ? toPosix(path.relative(ctx.projectDir, abs)) : toPosix(abs);
      const matches = findRelatesTo(ctx.brainDir, rel, { validOnly: true }).filter((m) => m.kind === 'decision');
      if (matches.length && ctx.thread) {
        const state = readThreadState(ctx.brainDir, ctx.thread);
        const seen = state.signaled_relates || [];
        if (!seen.includes(rel)) {
          writeThreadState(ctx.brainDir, ctx.thread, { ...state, signaled_relates: [...seen, rel] });
          const m = matches[0];
          const line = `decision ${m.id || m.key} relates to ${rel}: ${m.description} (read ${m.path} before changing, P-008)`;
          if (out) out.hookSpecificOutput.additionalContext = line;
          else out = contextOutput('PreToolUse', line);
        }
      }
    }
    return out || {};
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(toolInput.command || '');
    const asks = policy.harness?.ask_commands || [];
    const normalized = cmd.replace(/\s+/g, ' ');
    const historyOp = historyOperation(normalized, asks, policy.harness?.ask_commands_except || []);
    if (historyOp) return permissionOutput('ask', `"${historyOp}" rewrites or drops git history; always needs explicit operator confirmation (P-018)`);
    const targets = bashTargets(cmd, cwd);
    // An untracked file in brain is not brain data (git has none of it): removing such stray output goes through P-018
    // below, not the P-013 deny (Bob 2026-11-01: `rm 0` in the persona root was denied as a brain write).
    const stray = (t) => fs.existsSync(t) && classifyTarget(t).reason === 'untracked';
    if (ctx.brainDir && targets.some((t) => isInside(ctx.brainDir, t) && !personaWritable(ctx, t) && !stray(t))) {
      return permissionOutput('deny', `shell write into brain is not allowed; use workflow:save, topic or finish (P-013, P-040)`);
    }
    const created = createdByThread(ctx);
    const dangerous = targets.filter((t) => !isInside(path.join(ctx.projectDir, SCRATCH_DIR), t) && !created.has(t) && fs.existsSync(t) && classifyTarget(t).dangerous);
    const thr = policy.destructive || {};
    if (targets.length > (thr.files_threshold ?? 5)) {
      return permissionOutput('ask', `operation on ${targets.length} files (> ${thr.files_threshold}); confirm the exact target list with the operator (P-018)`);
    }
    if (dangerous.length) {
      return permissionOutput('ask', `targets not recoverable from git: ${dangerous.map((t) => toPosix(path.relative(cwd, t))).join(', ')}; confirm with the operator before deleting or overwriting (P-018)`);
    }
    // A file this command creates (redirect, cp to a new target) is the thread's own: removing a stray one later needs
    // no confirmation (operator 2026-11-01: a file born by mistake is cleaned up, P-018).
    for (const t of targets) if (!fs.existsSync(t) && !isInside(path.join(ctx.projectDir, SCRATCH_DIR), t)) rememberCreated(ctx, t);
  }
  return {};
}

if (isMain(import.meta.url)) {
  try {
    emit(run(readHookInput()));
  } catch (err) {
    process.stderr.write(`pre-tool-use: ${err.message}\n`);
    emit({});
  }
}
