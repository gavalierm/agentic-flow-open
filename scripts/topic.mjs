// Topics: create, claim, release, list (P-036, P-037, P-045, P-047).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { git, readJson, nowIso, relPosix } from './util.mjs';
import { isWakeTurn, machineName, inSubagent, readThreadState, writeThreadState } from './config.mjs';
import { brainWrite, brainSync, readHolder, currentBranch, withBrainLock } from './brain.mjs';
import { freeHandover } from './brain-checks.mjs';
import { readTopics } from './records.mjs';
import { isValidId } from './keys.mjs';
import { registerTopic, mailCount, mailLines, isMainTopic, MAIN_TOPIC } from './comms.mjs';

export function topicDir(brainDir, id) {
  return path.join(brainDir, 'topics', id);
}

export function topicExists(brainDir, id) {
  return fs.existsSync(path.join(topicDir(brainDir, id), 'topic.json'));
}

export function readTopic(brainDir, id) {
  return readJson(path.join(topicDir(brainDir, id), 'topic.json'), null);
}

export function codeCopyPath(ctx, id) {
  return path.resolve(ctx.projectDir, '..', `${ctx.projectName}-topics`, id);
}

function guardThread(ctx, action, { allowWake = false } = {}) {
  if (inSubagent()) throw new Error(`topic ${action} refused in subagent (P-025)`);
  if (!ctx.thread) throw new Error(`topic ${action} needs a stable thread id: start the harness via thread.mjs or in T3 (WORKFLOW_THREAD_ID / T3CODE_THREAD_ID, P-038)`);
  if (!allowWake && isWakeTurn(ctx.brainDir, ctx.thread)) throw new Error(`topic ${action} refused: this turn was started by a message, not by the operator (P-047)`);
}

function idleHours(since) {
  const t = Date.parse(since || '');
  return Number.isNaN(t) ? null : Math.round((Date.now() - t) / 36e5);
}

export function heldBy(holder) {
  const idle = idleHours(holder.since);
  return `held by thread ${holder.thread}${holder.machine ? ` on ${holder.machine}` : ''}${idle !== null ? ` (since ${holder.since}, idle ${idle}h)` : ''}`;
}

export function createTopic(ctx, opts = {}) {
  return withBrainLock(ctx.brainDir, () => createTopicUnlocked(ctx, opts));
}

function createTopicUnlocked(ctx, { id, subject, kind = 'discussion', mode, claim = true, copy = true, forThread = null, newThread = false }) {
  if (!isValidId(id)) throw new Error(`topic id "${id}" must be lowercase letters, digits and hyphens (P-036)`);
  if (id === MAIN_TOPIC) throw new Error('topic id "main" is reserved for the persona main thread: use topic.mjs main (P-045)');
  if (!subject || !String(subject).trim()) throw new Error('topic needs --subject "<one sentence>" (P-045)');
  if (!['code', 'discussion'].includes(kind)) throw new Error('kind must be code or discussion');
  guardThread(ctx, 'create');
  if (topicExists(ctx.brainDir, id) || fs.existsSync(path.join(ctx.brainDir, 'topics', 'archive', id))) throw new Error(`topic ${id} already exists`);
  const topic = { id, subject: String(subject).trim(), kind, state: 'working', created: nowIso() };
  if (kind === 'code') topic.copy = relPosix(ctx.projectDir, codeCopyPath(ctx, id));
  const res = brainWrite(ctx, {
    internal: true,
    ops: [
      { path: `topics/${id}/topic.json`, content: JSON.stringify(topic, null, 2) + '\n' },
      { path: `topics/${id}/holder.json`, content: '{}\n' },
      { path: `topics/${id}/handover.md`, content: freeHandover() },
    ],
    message: `topic create ${id}`,
  });
  const out = { topic, write: res, claim: null, copy: null, thread: null };
  if (newThread && !forThread) {
    // P-036: a new topic gets its own T3 thread titled by the topic; its first message shows what the topic holds, so the
    // operator does not have to prompt it (alice 2026-11-02). Failure keeps the topic free and says why.
    const started = startTopicThread(ctx, topic);
    if (!started.ok) { out.claim = { ok: false, reason: `topic ${id} created, but no thread was started (${started.reason}); claim it with topic.mjs claim ${id}` }; return out; }
    out.thread = started.thread;
    forThread = started.thread;
  }
  if (forThread) {
    // Topic for a new thread (P-037): the new thread holds it from its first turn, so its status block shows the topic
    // instead of `Téma: žiadna` (Bob 2026-11-01: topic beszel created for a new thread that then asked for a topic).
    out.claim = assignTopic(ctx, id, String(forThread), { mode });
    if (kind === 'code' && copy) out.copy = ensureCodeCopy(ctx, id);
    return out;
  }
  if (claim) {
    out.claim = claimTopic(ctx, id, { mode });
    if (!out.claim.ok) return out;
    if (kind === 'code' && copy) out.copy = ensureCodeCopy(ctx, id);
  }
  return out;
}

/** First message of a topic's own thread: what the topic holds and what to do (P-036). */
export function topicThreadMessage(topic) {
  return [
    `Téma ${topic.id} (${topic.kind}) je pridelená tomuto vláknu.`,
    `Predmet: ${topic.subject}`,
    ...(topic.copy ? [`Kópia kódu: ${topic.copy}`] : []),
    '',
    'Vypíš operátorovi stručne, čo téma obsahuje (predmet, handover), a počkaj na jeho pokyn.',
  ].join('\n');
}

/** Start a T3 thread for the topic via `topics.thread_start_command` (default `t3 thread start --json`); returns its id. */
export function startTopicThread(ctx, topic, run = spawnSync) {
  const cmd = String(ctx.policy?.topics?.thread_start_command || '').trim().split(/\s+/).filter(Boolean);
  if (!cmd.length) return { ok: false, reason: 'topics.thread_start_command not set' };
  const r = run(cmd[0], [...cmd.slice(1), '--title', topic.id, ctx.projectDir, '-'], { encoding: 'utf8', input: topicThreadMessage(topic), timeout: 30000 });
  if (r.error || r.status !== 0) return { ok: false, reason: (r.error?.message || r.stderr || `exit ${r.status}`).trim().split('\n')[0] };
  let thread = null;
  try {
    const d = JSON.parse(r.stdout);
    thread = d?.threadId ?? d?.thread?.threadId ?? d?.thread?.id ?? d?.id ?? null;
  } catch { thread = String(r.stdout || '').trim().split(/\s+/)[0] || null; }
  if (!thread || !/^[A-Za-z0-9._:-]{1,200}$/.test(thread)) return { ok: false, reason: `no thread id in output of ${cmd.join(' ')}` };
  return { ok: true, thread };
}

/** Holder of a just-created topic is another (new) thread; the topic has no holder yet, so no takeover is possible. */
function assignTopic(ctx, id, thread, { mode } = {}) {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(thread)) throw new Error(`--for-thread "${thread}" is not a thread id`);
  const policyMode = ctx.policy?.topics?.default_holder_mode || 'operator';
  const holder = { thread, machine: machineName(), mode: mode || policyMode, since: nowIso(), assigned_by: ctx.thread };
  const res = brainWrite(ctx, {
    internal: true,
    ops: [{ path: `topics/${id}/holder.json`, content: JSON.stringify(holder, null, 2) + '\n' }],
    message: `topic assign ${id} to ${thread} by ${ctx.thread}`,
  });
  const comms = registerTopic(ctx, id, { holder: thread });
  return { ok: true, assigned: true, holder, pushed: !!res.pushed, sha: res.sha, comms };
}

/** Claim per P-037: sync, check holder, write, push immediately; holder.json content after fetch decides. */
export function claimTopic(ctx, id, opts = {}) {
  return withBrainLock(ctx.brainDir, () => claimTopicUnlocked(ctx, id, opts));
}

function claimTopicUnlocked(ctx, id, { force = false, operatorApproved = false, mode, allowWake = false } = {}) {
  guardThread(ctx, 'claim', { allowWake });
  const first = brainSync(ctx.brainDir);
  if (first.conflict) throw new Error(`brain has a disagreement: ${first.conflict.join(', ')}; resolve before claiming (P-040)`);
  if (!topicExists(ctx.brainDir, id)) throw new Error(`topic ${id} does not exist (archived or never created)`);
  let holder = readHolder(ctx.brainDir, id);
  if (holder.thread && holder.thread !== ctx.thread) {
    if (!force) return { ok: false, reason: `topic ${id} ${heldBy(holder)}; not taken. An instruction to claim it is not an instruction to take it over: tell the operator who holds it and ask (blocker, P-059) whether to take it over; only after an explicit yes: --force --operator-approved (P-037)`, holder };
    if (!operatorApproved) throw new Error('--force requires --operator-approved: takeover is allowed only on explicit operator instruction (P-037)');
  }
  if (holder.thread === ctx.thread) {
    // Idempotent re-registration: repairs a claim whose mail registration failed earlier (P-041).
    if (!mode || holder.mode === mode) return { ok: true, already: true, holder, pushed: first.pushed, comms: registerTopic(ctx, id) };
    // Holder changes its own mode (P-037): rewrite holder.json and re-register so wake events follow the new mode.
    const updated = { ...holder, mode };
    const w = brainWrite(ctx, {
      internal: true,
      ops: [{ path: `topics/${id}/holder.json`, content: JSON.stringify(updated, null, 2) + '\n' }],
      message: `topic mode ${id} ${mode} by ${ctx.thread}`,
    });
    const comms = registerTopic(ctx, id);
    return { ok: true, modeChanged: true, holder: updated, pushed: !!w.pushed, sha: w.sha, comms };
  }
  const policyMode = ctx.policy?.topics?.default_holder_mode || 'operator';
  const newHolder = { thread: ctx.thread, machine: machineName(), mode: mode || policyMode, since: nowIso() };
  if (force && holder.thread) newHolder.took_over_from = holder.thread;
  const res = brainWrite(ctx, {
    internal: true,
    sync: false,
    ops: [{ path: `topics/${id}/holder.json`, content: JSON.stringify(newHolder, null, 2) + '\n' }],
    message: `topic claim ${id} by ${ctx.thread}${force ? ' (force, operator approved)' : ''}`,
  });
  const sync = brainSync(ctx.brainDir);
  if (sync.conflict) {
    // Lost the race: drop our local commit, re-read the remote holder.
    const branch = currentBranch(ctx.brainDir);
    git(['reset', '--quiet', '--hard', `origin/${branch}`], { cwd: ctx.brainDir });
    holder = readHolder(ctx.brainDir, id);
    if (holder.thread && holder.thread !== ctx.thread) {
      return { ok: false, reason: `topic ${id} ${heldBy(holder)} (claimed first)`, holder };
    }
    return { ok: false, reason: `claim of ${id} could not be pushed (conflict: ${sync.conflict.join(', ')})`, holder };
  }
  if (sync.error && sync.error !== 'no remote origin') {
    // Mail registration comes after a successful push: it is not done here; a repeated claim registers it (`already`).
    const comms = { ok: false, reason: 'brain push failed: mail registration not done (repeat topic.mjs claim to register)', topic: id, skipped: false };
    return { ok: true, holder: newHolder, pushed: false, warning: `claim committed but not pushed (${sync.error}); other machines will not see it until push succeeds`, comms };
  }
  // A takeover replaces the other holder in the mail service too (the service refuses it without takeover, P-037).
  const comms = registerTopic(ctx, id, { takeover: !!newHolder.took_over_from });
  return { ok: true, holder: newHolder, pushed: sync.pushed, sha: res.sha, comms };
}

/**
 * Main thread of a persona (P-045, P-050): permanent topic `main` (kind `main`) held by the persona's main thread.
 * Created on first use, registered in the mail service as `@<persona>/main`. A claim held by another thread is refused
 * without --force (a new main thread after a restart takes over on operator instruction, `--force --operator-approved`; bob 2026-11-01: a topic thread
 * took main silently and got the persona bell); refused in a wake turn (P-047) unless main has no holder yet (first adoption takes nothing over). Outside the topic limit, never offered as free, never finished.
 */
export function claimMain(ctx, opts = {}) {
  if (!ctx.brainInfo?.persona) throw new Error('topic main exists only in a persona brain ("brain": ".", P-024)');
  return withBrainLock(ctx.brainDir, () => {
    // First adoption takes nothing over: allowed in a wake turn, so a request by mail to @<persona>/main is enough.
    const unheld = !topicExists(ctx.brainDir, MAIN_TOPIC) || !readHolder(ctx.brainDir, MAIN_TOPIC).thread;
    guardThread(ctx, 'main', { allowWake: unheld });
    if (!topicExists(ctx.brainDir, MAIN_TOPIC)) {
      const topic = { id: MAIN_TOPIC, subject: `Hlavné vlákno persony ${ctx.projectName}`, kind: 'main', state: 'working', created: nowIso() };
      brainWrite(ctx, {
        internal: true,
        ops: [
          { path: `topics/${MAIN_TOPIC}/topic.json`, content: JSON.stringify(topic, null, 2) + '\n' },
          { path: `topics/${MAIN_TOPIC}/holder.json`, content: '{}\n' },
          { path: `topics/${MAIN_TOPIC}/handover.md`, content: freeHandover() },
        ],
        message: 'topic main created',
      });
    } else if (!isMainTopic(readTopic(ctx.brainDir, MAIN_TOPIC))) {
      throw new Error('topic main exists but is not of kind main; rename it first (P-045)');
    }
    // Takeover of a main held by another thread only with --force on operator instruction (a new main thread after a
    // restart); a topic thread must not take the persona mailbox (bob 2026-11-01: tunnel thread took main).
    const holder = readHolder(ctx.brainDir, MAIN_TOPIC).thread;
    const takeover = !!holder && holder !== ctx.thread;
    if (takeover && !opts.force) return { ok: false, reason: `topic main is held by ${holder}: only a new persona main thread takes it over, on operator instruction: topic.mjs main --force --operator-approved (P-045, P-037)` };
    // Same rule as `claim --force` (P-037): the operator's approval is named by the flag, not implied by --force.
    if (takeover && !opts.operatorApproved) return { ok: false, reason: '--force requires --operator-approved: takeover of topic main is allowed only on explicit operator instruction (P-045, P-037)' };
    return claimTopicUnlocked(ctx, MAIN_TOPIC, { mode: opts.mode, force: takeover, operatorApproved: takeover, allowWake: unheld });
  });
}

export function releaseTopic(ctx, id, opts = {}) {
  return withBrainLock(ctx.brainDir, () => releaseTopicUnlocked(ctx, id, opts));
}

function releaseTopicUnlocked(ctx, id, { force = false, operatorApproved = false } = {}) {
  guardThread(ctx, 'release');
  // Main is the persona's main thread, permanent and never free (P-045), like finish (finish.mjs refuses it too).
  if (isMainTopic(readTopic(ctx.brainDir, id))) throw new Error('topic main is the persona main thread: it is never released (P-045)');
  const holder = readHolder(ctx.brainDir, id);
  if (holder.thread && holder.thread !== ctx.thread) {
    if (!force) throw new Error(`topic ${id} ${heldBy(holder)}; only the holder releases it (P-037)`);
    if (!operatorApproved) throw new Error('--force requires --operator-approved (P-037)');
  }
  // An already free topic still registers the release: a mail registration that failed earlier is repaired here (P-041).
  const res = holder.thread ? brainWrite(ctx, {
    internal: true,
    ops: [{ path: `topics/${id}/holder.json`, content: '{}\n' }],
    message: `topic release ${id} by ${ctx.thread}`,
  }) : null;
  // The mail service stops carrying this thread as holder (wake events, P-043); messages for the topic keep waiting.
  const comms = registerTopic(ctx, id, { holder: null, release: true });
  return { ok: true, already: !holder.thread, write: res, comms, mail: freePointMail(ctx, id) };
}

/**
 * Messages waiting for a topic at its free point (P-044): offered to the agent, never injected. The thread is passed to
 * the count (the message ids are listed, not read). An outage says so and still records the topic (the
 * mailbox is read again when the service is back).
 * `record: false` (topic main, never free, P-045) leaves the free_point list alone.
 */
export function freePointMail(ctx, id, { record = true } = {}) {
  const topic = readTopic(ctx.brainDir, id);
  if (!topic) return null;
  // The topic record keeps its kind: topic main is read from the persona mailbox `@<persona>/main` (bob 2026-11-01).
  const mail = mailCount(ctx, [{ ...topic, state: 'free' }]);
  if (!mail.count && !mail.unknown) return null;
  // The thread no longer holds the topic, yet handles its free-point mail: remember it so comms list/receive still
  // read that mailbox (pilot 2026-11-01: after release `receive --id` found nothing).
  if (record && ctx.brainDir && ctx.thread) {
    const state = readThreadState(ctx.brainDir, ctx.thread);
    const fp = Array.isArray(state.free_point) ? state.free_point : [];
    if (!fp.includes(id)) writeThreadState(ctx.brainDir, ctx.thread, { ...state, free_point: [...fp, id] });
  }
  if (mail.count) {
    const ids = mailLines(mail.items);
    return `mail: ${mail.count} waiting for topic ${id} (free point)${ids.length ? `: ${ids.join('; ')}` : ''}; read each one with comms receive --id <id> and handle it now (skill workflow:comms, P-044)`;
  }
  if (mail.unknown) return `mail: unknown (comms unavailable) for topic ${id} (free point): run comms receive when it is back (P-044)`;
  return null;
}

/**
 * Topics whose mailbox this thread reads (P-044): the held topics, then the topics it released with mail waiting (free
 * point, until another thread claims them). Status line, Stop free-point block, comms list/receive use the same set.
 */
export function mailboxTopics(ctx) {
  if (!ctx.brainDir) return [];
  const own = heldTopics(ctx.brainDir, ctx.thread);
  const fp = ctx.thread ? (readThreadState(ctx.brainDir, ctx.thread).free_point || []) : [];
  const extra = [];
  for (const id of fp) {
    if (own.some((t) => t.id === id) || extra.some((t) => t.id === id)) continue;
    const topic = readTopic(ctx.brainDir, id);
    // Main is never free (P-045): a stale free_point entry for it is not a free topic.
    if (topic && !isMainTopic(topic) && !readHolder(ctx.brainDir, id).thread) extra.push({ ...topic, state: 'free' });
  }
  return [...own, ...extra];
}

export function setTopicState(ctx, id, state) {
  const topic = readTopic(ctx.brainDir, id);
  if (!topic) throw new Error(`topic ${id} does not exist`);
  topic.state = state;
  topic.updated = nowIso();
  return { path: `topics/${id}/topic.json`, content: JSON.stringify(topic, null, 2) + '\n' };
}

export function ensureCodeCopy(ctx, id) {
  const copy = codeCopyPath(ctx, id);
  const branch = `topic/${id}`;
  if (fs.existsSync(path.join(copy, '.git'))) return { path: copy, branch, created: false };
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  const clone = git(['clone', '--quiet', ctx.projectDir, copy]);
  if (!clone.ok) throw new Error(`clone of project into ${copy} failed: ${clone.stderr.split('\n')[0]}`);
  const existing = git(['rev-parse', '--verify', '--quiet', `origin/${branch}`], { cwd: copy });
  const checkout = existing.ok
    ? git(['checkout', '--quiet', '-b', branch, `origin/${branch}`], { cwd: copy })
    : git(['checkout', '--quiet', '-b', branch], { cwd: copy });
  if (!checkout.ok) throw new Error(`checkout ${branch} failed: ${checkout.stderr}`);
  return { path: copy, branch, created: true };
}

export function listTopics(brainDir) {
  return readTopics(brainDir);
}

export function heldTopics(brainDir, thread) {
  if (!thread) return [];
  // Work topics first: the main topic (P-045) is the fallback, so a main thread working on a topic shows that topic.
  const held = readTopics(brainDir).filter((t) => t.holder?.thread === thread);
  return [...held.filter((t) => !isMainTopic(t)), ...held.filter(isMainTopic)];
}
