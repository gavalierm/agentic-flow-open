#!/usr/bin/env node
// Close a unit of work or a whole topic (P-029, P-005, P-006, P-011, P-020, P-036, P-044).
//   finish.mjs [--topic-id <id>] --verified "<observation>" [--procedures a,b] [--derivations k1,k2]
//   finish.mjs --list                       existing names in procedures.log / derivations.log
//   finish.mjs --topic [--topic-id <id>] --verified "<observation>" [--keep-copy]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, fail, git, nowIso } from '../scripts/util.mjs';
import { loadContext, isWakeTurn, inSubagent } from '../scripts/config.mjs';
import { brainWrite, brainSync, formatWriteResult, readHolder } from '../scripts/brain.mjs';
import { freeHandover } from '../scripts/brain-checks.mjs';
import { recordNames, existingNames } from '../scripts/logs.mjs';
import { rejectedProposal } from '../scripts/find.mjs';
import { heldTopics, readTopic, setTopicState, freePointMail } from '../scripts/topic.mjs';
import { registerTopic } from '../scripts/comms.mjs';
import { buildIndexes } from '../scripts/index.mjs';
import { asList } from '../scripts/frontmatter.mjs';

const args = parseArgs(process.argv.slice(2));
const out = (s) => process.stdout.write(s + '\n');

function pickTopic(ctx) {
  if (args['topic-id']) return args['topic-id'];
  const all = heldTopics(ctx.brainDir, ctx.thread);
  // The persona main topic (P-045) is chosen only when the thread holds nothing else.
  const held = all.some((t) => t.kind !== 'main') ? all.filter((t) => t.kind !== 'main') : all;
  if (held.length === 1) return held[0].id;
  if (!held.length) {
    // A unit of work done in a thread without a topic is still finished (operator 2026-11-02: finish kept bouncing back).
    if (!args.topic) return null;
    fail('this thread holds no topic: nothing to finish with --topic. Do not claim a topic (least of all main) just to finish it; finish the unit without --topic (P-026, P-037, P-045)');
  }
  fail(`this thread holds several topics (${held.map((t) => t.id).join(', ')}); pass --topic-id`);
}

function guard(ctx, id) {
  if (inSubagent()) fail('finish refused in subagent (P-025)');
  if (!ctx.thread) fail('finish needs a stable thread id (P-038)');
  brainSync(ctx.brainDir);
  const holder = readHolder(ctx.brainDir, id);
  if (holder.thread !== ctx.thread) fail(`topic ${id} is held by ${holder.thread || 'nobody'}; only the holder finishes it (P-037)`);
  if (!args.verified || args.verified === true) fail('state how the result was verified: --verified "<one observation>" (P-020)');
}

function guardThread(ctx) {
  if (inSubagent()) fail('finish refused in subagent (P-025)');
  if (!ctx.thread) fail('finish needs a stable thread id (P-038)');
  if (!args.verified || args.verified === true) fail('state how the result was verified: --verified "<one observation>" (P-020)');
}

function finishUnit(ctx, id) {
  if (!id && !args.verified && !args.procedures && !args.derivations) {
    // Thread without a topic and without work in this context (e.g. after /clear): finish just closes the thread,
    // nothing is recorded and nothing needs verifying (operator 2026-11-02: finish after /clear asked what to close).
    if (inSubagent()) fail('finish refused in subagent (P-025)');
    out('thread closed: no topic and no recorded work in this thread, nothing to write. Do not ask the operator what to close (P-059).');
    if (process.env.T3CODE_THREAD_ID) out('thread: as the last step of this turn archive this thread (tool t3_thread_organize, action archive, no threadId), P-036');
    return;
  }
  if (id) guard(ctx, id);
  else guardThread(ctx);
  const ops = [];
  const notes = [];
  const procedures = asList(args.procedures);
  const derivations = asList(args.derivations);
  const p = recordNames(ctx, 'procedures.log', procedures, { thread: ctx.thread });
  const d = recordNames(ctx, 'derivations.log', derivations, { thread: ctx.thread });
  ops.push(p.op, d.op);
  for (const [name, n] of p.counts) {
    if (n >= ctx.policy.thresholds.procedure_repeats && procedures.includes(name)) {
      notes.push(rejectedProposal(ctx.brainDir, name)
        ? `procedure ${name} ${n}x: skill was rejected earlier, no new proposal (P-005)`
        : `procedure ${name} ${n}x: create the skill yourself, no operator approval (name, trigger, steps, script): save skill <name> --origin routine --from-procedure ${name} (P-005)`);
    }
  }
  for (const [key, n] of d.counts) {
    if (n >= ctx.policy.thresholds.derivation_repeats && derivations.includes(key)) {
      notes.push(`derivation ${key} ${n}x: save the conclusion (save memory ... --origin derived --sources ...) and the log lines will be removed (P-006)`);
    }
  }
  if (!id) {
    // No topic: nothing to hand over; the logs still count procedures and derivations (P-005, P-006).
    const res = brainWrite(ctx, { ops, message: `finish: unit of work done without a topic (verified: ${String(args.verified).slice(0, 60)})` });
    out(formatWriteResult(res, []));
    out('unit finished: this thread held no topic, so there is no handover. The next unit of work starts in a new session with its own topic (skill workflow:topic, P-026).');
    if (process.env.T3CODE_THREAD_ID) out('thread: as the last step of this turn archive this thread (tool t3_thread_organize, action archive, no threadId), P-036');
    for (const n of notes) out(n);
    return;
  }
  ops.push({ path: `topics/${id}/handover.md`, content: freeHandover() });
  // The main topic stays held and is never free (P-045): no state change, no free point.
  const main = readTopic(ctx.brainDir, id)?.kind === 'main';
  if (!main) ops.push(setTopicState(ctx, id, 'free'));
  const res = brainWrite(ctx, { ops, message: `finish ${id}: unit of work done (verified: ${String(args.verified).slice(0, 60)})` });
  out(formatWriteResult(res, [`topics/${id}/handover.md`, `topics/${id}/topic.json`]));
  if (main) out(`topic main stays held by ${ctx.thread} (persona main thread, never free, P-045); handover reset.`);
  else out(`topic ${id} is free; handover reset. Continue in a new session for the next unit of work (P-026).`);
  const mail = freePointMail(ctx, id, { record: !main });
  if (mail) out(mail);
  for (const n of notes) out(n);
  for (const w of buildIndexes(ctx.brainDir, ctx.policy).warnings) out(`limit: ${w}`);
}

function mergeCode(ctx, id, topic) {
  const copy = path.resolve(ctx.projectDir, topic.copy || `../${ctx.projectName}-topics/${id}`);
  const branch = `topic/${id}`;
  if (!fs.existsSync(path.join(copy, '.git'))) return { merged: false, note: `no code copy at ${copy}; nothing to merge` };
  const dirtyCopy = git(['status', '--porcelain', '--untracked-files=no'], { cwd: copy }).stdout;
  if (dirtyCopy) fail(`code copy ${copy} has uncommitted changes; commit or discard them in the copy first`);
  const mainBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ctx.projectDir }).stdout || 'main';
  const dirtyProject = git(['status', '--porcelain', '--untracked-files=no'], { cwd: ctx.projectDir }).stdout;
  if (dirtyProject) fail(`project checkout has uncommitted changes; commit or stash them before merging ${branch}`);
  if (git(['remote', 'get-url', 'origin'], { cwd: ctx.projectDir }).ok) {
    const pull = git(['pull', '--ff-only', '--quiet', 'origin', mainBranch], { cwd: ctx.projectDir });
    if (!pull.ok) out(`note: project pull from origin failed (${pull.stderr.split('\n')[0]}); merging into local ${mainBranch}`);
  }
  const fetch = git(['fetch', '--quiet', 'origin', mainBranch], { cwd: copy });
  if (!fetch.ok) fail(`fetch of ${mainBranch} into the copy failed: ${fetch.stderr}`);
  const merge = git(['merge', '--quiet', '--no-edit', 'FETCH_HEAD'], { cwd: copy });
  if (!merge.ok) {
    const files = git(['diff', '--name-only', '--diff-filter=U'], { cwd: copy }).stdout;
    git(['merge', '--abort'], { cwd: copy });
    fail(`merge of ${mainBranch} into ${branch} has conflicts in the copy: ${files.split('\n').join(', ')}; resolve them in ${copy}, verify, commit, then rerun`);
  }
  const fetchBranch = git(['fetch', '--quiet', copy, branch], { cwd: ctx.projectDir });
  if (!fetchBranch.ok) fail(`fetch of ${branch} from copy failed: ${fetchBranch.stderr}`);
  const mergeMain = git(['merge', '--no-ff', '--quiet', '-m', `Merge ${branch} (finish --topic ${id})`, 'FETCH_HEAD'], { cwd: ctx.projectDir });
  if (!mergeMain.ok) {
    git(['merge', '--abort'], { cwd: ctx.projectDir });
    fail(`merge of ${branch} into ${mainBranch} failed: ${mergeMain.stderr}`);
  }
  if (!args['keep-copy']) fs.rmSync(copy, { recursive: true, force: true });
  return { merged: true, note: `${branch} merged into ${mainBranch}${args['keep-copy'] ? '' : `; copy ${copy} removed`}` };
}

function finishTopic(ctx, id) {
  guard(ctx, id);
  if (isWakeTurn(ctx.brainDir, ctx.thread)) fail('finish --topic refused: this turn was started by a message, not the operator (P-047)');
  const topic = readTopic(ctx.brainDir, id);
  if (!topic) fail(`topic ${id} does not exist`);
  if (topic.kind === 'main') fail('topic main is the persona main thread: it is never finished or archived (P-045)');
  let merge = { merged: false, note: 'discussion topic, no code' };
  if (topic.kind === 'code') merge = mergeCode(ctx, id, topic);
  const closed = { ...topic, state: 'closed', closed: nowIso(), closed_by: ctx.thread, verified: String(args.verified), merged: merge.merged };
  const ops = [
    { from: `topics/${id}`, to: `topics/archive/${id}` },
    { path: `topics/archive/${id}/topic.json`, content: JSON.stringify(closed, null, 2) + '\n' },
    { path: `topics/archive/${id}/holder.json`, content: '{}\n' },
  ];
  const res = brainWrite(ctx, { ops, internal: true, message: `finish --topic ${id}: archived (verified: ${String(args.verified).slice(0, 60)})` });
  out(formatWriteResult(res, [`topics/archive/${id}/`]));
  out(merge.note);
  out(`topic ${id} closed and archived. Start a new session for the next topic (P-026).`);
  // The mail closes the topic too: new mail gets 410 at once, waiting mail bounces to its senders (alice 2026-11-02).
  const comms = registerTopic(ctx, id, { close: true });
  if (comms.ok) out(`mail: topic ${id} closed in the mail service (new mail refused, waiting mail returned to the senders)`);
  else if (!comms.skipped) out(`mail: closing ${id} in the mail service failed (${comms.reason}); the next session start retries`);
  // P-036: the topic's T3 thread is archived with the topic (only inside T3). A thread that also holds the persona main
  // topic is never archived (P-045; alice 2026-11-02: main stayed held by an archived thread and @alice/main went unread).
  const holdsMain = heldTopics(ctx.brainDir, ctx.thread).some((t) => t.kind === 'main');
  if (holdsMain) out('thread: this thread holds the persona main topic, so it stays open: do not archive it (P-045)');
  else if (process.env.T3CODE_THREAD_ID) out('thread: as the last step of this turn archive this thread (tool t3_thread_organize, action archive, no threadId), P-036');
  for (const w of buildIndexes(ctx.brainDir, ctx.policy).warnings) out(`limit: ${w}`);
}

try {
  const ctx = loadContext({ project: args.project });
  if (args.list) {
    const p = existingNames(ctx.brainDir, 'procedures.log');
    const d = existingNames(ctx.brainDir, 'derivations.log');
    out(`procedures: ${p.length ? p.map((n) => `${n.name} ${n.count}x`).join(', ') : 'none'}`);
    out(`derivations: ${d.length ? d.map((n) => `${n.name} ${n.count}x`).join(', ') : 'none'}`);
  } else {
    const id = pickTopic(ctx);
    if (args.topic) finishTopic(ctx, id);
    else finishUnit(ctx, id);
  }
} catch (err) {
  fail(err.message);
}
