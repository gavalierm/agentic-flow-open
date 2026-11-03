#!/usr/bin/env node
// topic.mjs create <id> --subject "..." [--task "<operator's task>"] [--kind code|discussion] [--no-claim] [--no-copy] [--for-thread <new thread id>] [--here | --new-thread]
//           claim <id> [--force --operator-approved] [--mode operator|auto]
//           release <id> [--force --operator-approved]
//           main [--force --operator-approved]   persona main thread (topic main, P-045)
//           thread <id> [--task ".."] [--mode operator|auto]   new T3 thread for a free topic (P-036)
//           list | status | copy <id>
import { parseArgs, fail } from '../scripts/util.mjs';
import { loadContext } from '../scripts/config.mjs';
import { createTopic, startThreadForTopic, claimTopic, claimMain, releaseTopic, listTopics, heldTopics, ensureCodeCopy, readTopic } from '../scripts/topic.mjs';
import { topicLine } from '../scripts/index.mjs';

const args = parseArgs(process.argv.slice(2));
const [cmd, id] = args._;
const out = (s) => process.stdout.write(s + '\n');

try {
  const ctx = loadContext({ project: args.project });
  if (cmd === 'create') {
    if (!id) fail('usage: topic.mjs create <id> --subject "..." [--kind code|discussion]');
    const res = createTopic(ctx, { id, subject: args.subject, kind: args.kind || 'discussion', mode: args.mode, claim: !args['no-claim'], copy: !args['no-copy'], forThread: args['for-thread'] || null, task: args.task || null, explicitProject: !!args.project,
      // In T3 a new topic gets its own thread (P-036) when this thread already works on a topic (or --new-thread); a
      // thread without a topic takes it itself: the operator gave the task here (alice 2026-11-03: a duplicate thread).
      newThread: !!process.env.T3CODE_THREAD_ID && !args.here && !args['no-claim'] && !args['for-thread'] && (!!args['new-thread'] || heldTopics(ctx.brainDir, ctx.thread).length > 0) });
    out(`topic ${id} created (${res.topic.kind})`);
    if (res.thread) out(`thread ${res.thread} started with title ${id}; it holds the topic (this thread does not)`);
    if (res.claim) out(res.claim.ok ? `${res.claim.assigned ? `assigned to ${res.claim.holder.thread}` : `claimed by ${ctx.thread}`}${res.claim.pushed ? ', pushed' : ''}` : res.claim.reason);
    if (res.claim?.comms && !res.claim.comms.ok && !res.claim.comms.skipped) out(`comms: topic not registered (${res.claim.comms.reason})`);
    if (res.copy) out(`code copy: ${res.copy.path} (branch ${res.copy.branch})`);
    if (res.write.unpushed) out(`unpushed: ${res.write.unpushed}`);
    if (res.claim && !res.claim.ok) process.exit(1);
  } else if (cmd === 'thread') {
    if (!id) fail('usage: topic.mjs thread <id> [--task ".."] [--mode operator|auto]');
    const res = startThreadForTopic(ctx, id, { task: args.task || null, mode: args.mode });
    if (!res.ok) fail(res.reason);
    out(`thread ${res.thread} started with title ${id}; it holds the topic${res.claim.pushed ? ', pushed' : ''}`);
    if (res.claim.comms && !res.claim.comms.ok && !res.claim.comms.skipped) out(`comms: topic not registered (${res.claim.comms.reason})`);
  } else if (cmd === 'claim') {
    if (!id) fail('usage: topic.mjs claim <id> [--force --operator-approved]');
    const res = claimTopic(ctx, id, { force: !!args.force, operatorApproved: !!args['operator-approved'], mode: args.mode });
    if (!res.ok) fail(res.reason);
    out(res.modeChanged ? `topic ${id} mode ${res.holder.mode}${res.comms?.ok ? ', comms updated' : ''}` : res.already ? `topic ${id} already held by ${ctx.thread}${res.comms?.ok ? ', comms registered' : ''}` : `topic ${id} claimed by ${ctx.thread}${res.pushed ? ', pushed' : ''}`);
    if (res.warning) out(res.warning);
    if (res.comms && !res.comms.ok && !res.comms.skipped) out(`comms: topic not registered (${res.comms.reason})`);
    const topic = readTopic(ctx.brainDir, id);
    if (topic?.kind === 'code' && !args['no-copy']) {
      const copy = ensureCodeCopy(ctx, id);
      out(`code copy: ${copy.path} (branch ${copy.branch})`);
    }
  } else if (cmd === 'main') {
    const res = claimMain(ctx, { mode: args.mode, force: !!args.force, operatorApproved: !!args['operator-approved'] });
    if (!res.ok) fail(res.reason);
    out(res.already ? `topic main already held by ${ctx.thread}${res.comms?.ok ? ', comms registered' : ''}` : `topic main claimed by ${ctx.thread}${res.holder?.took_over_from ? ` (took over from ${res.holder.took_over_from})` : ''}${res.pushed ? ', pushed' : ''}`);
    if (res.warning) out(res.warning);
    if (res.comms && !res.comms.ok && !res.comms.skipped) out(`comms: main thread not registered (${res.comms.reason})`);
  } else if (cmd === 'release') {
    if (!id) fail('usage: topic.mjs release <id>');
    const res = releaseTopic(ctx, id, { force: !!args.force, operatorApproved: !!args['operator-approved'] });
    out(res.already ? `topic ${id} has no holder` : `topic ${id} released`);
    if (res.comms && !res.comms.ok && !res.comms.skipped) out(`comms: topic not registered as free (${res.comms.reason})`);
    if (res.mail) out(res.mail);
  } else if (cmd === 'list') {
    const topics = listTopics(ctx.brainDir);
    out(topics.length ? topics.map((t) => topicLine(t)).join('\n') : 'no open topics');
  } else if (cmd === 'status') {
    const held = heldTopics(ctx.brainDir, ctx.thread);
    out(`thread ${ctx.thread || '-'}`);
    out(held.length ? held.map((t) => `holds ${topicLine(t)}`).join('\n') : 'holds no topic');
  } else if (cmd === 'copy') {
    if (!id) fail('usage: topic.mjs copy <id>');
    const copy = ensureCodeCopy(ctx, id);
    out(`code copy: ${copy.path} (branch ${copy.branch})${copy.created ? '' : ' (existing)'}`);
  } else {
    fail('usage: topic.mjs create|claim|main|release|list|status|copy');
  }
} catch (err) {
  fail(err.message);
}
