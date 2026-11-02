#!/usr/bin/env node
// Stop: closes the turn record for keepalive (P-043, with the turn's opened_at); one brain write per turn for buffered logs
// (P-030); signals are queued for the next prompt (P-023 c), each skill proposal once per thread. A missing reply is found by the message TTL in the mail service (P-042, P-046), not here.
// Picked assist (P-042, 2026-11-02): an assist message this thread picked up (`comms receive`) and has not answered (`send --reply-to`)
// is one queued line at the stop, not a block: the answer is due, the turn may still end.
// Continuation (P-026): a held work topic whose handover has a next step blocks the stop once: do the step now; stop only
// with a blocker question to the operator (P-059) or a verified waker (P-057). A written next step is work, not a closure.
import { readHookInput, emit, isMain } from '../scripts/hooks-io.mjs';
import { loadContext, readThreadState, writeThreadState } from '../scripts/config.mjs';
import { flushBuffer, proposalKey } from '../scripts/logs.mjs';
import { unpushedCount, brainSync } from '../scripts/brain.mjs';
import { recordTurn, isMainTopic } from '../scripts/comms.mjs';
import { heldTopics } from '../scripts/topic.mjs';

export const HOOK_META = { event: 'Stop', class: 'c', limit: '2 lines (queued to next prompt); 1 block reason', principles: ['P-026', 'P-030', 'P-040', 'P-042', 'P-043'] };

export const NEXT_STEP_REASON = (topic, next) => `handover of topic ${topic} has a next step: "${next}". Do it now in this turn. Stop only if it needs the operator (ask as a blocker, P-059) or waits for an event with a verified waker (P-057); then say which. A next step in the handover is not a reason to end the turn, P-026`;

export const PICKED_ASSIST_LINE = (list) => `picked assist unanswered: ${list.map((w) => w.id).join(', ')}; answer each with comms send --reply-to <id> or say why it waits (P-042)`;

export function run(input) {
  const ctx = loadContext({ requireBrain: false });
  // Turn record for keepalive (P-043); an outage never fails the hook.
  // `opened_at` of this turn's record (from the prompt hook) keeps a late Stop from closing a newer turn.
  let held = [];
  let work = null;
  let closeTurn = () => {};
  if (ctx.thread) {
    try { held = ctx.brainDir ? heldTopics(ctx.brainDir, ctx.thread) : []; } catch { held = []; }
    const openedAt = ctx.brainDir ? readThreadState(ctx.brainDir, ctx.thread).turn_opened_at ?? null : null;
    // P-026: the next step travels with the closed turn; wake (code, not the agent) rings the thread to continue it.
    work = held.find((t) => !isMainTopic(t) && t.next);
    closeTurn = () => recordTurn(ctx, 'closed', held, { openedAt, next: work?.next || null });
  }
  // The turn is closed only when the stop really ends it: a blocked stop keeps the agent working, so the record stays open
  // (wake dedupes against open turns and does not ring a running thread, P-043).
  const end = (out) => { if (!out.decision) closeTurn(); return out; };
  if (!ctx.brainDir) return end({});
  const signals = [];
  try {
    const res = flushBuffer(ctx, input.session_id);
    signals.push(...res.signals);
  } catch (err) {
    signals.push(`logs not written: ${err.message.split('\n')[0]}`);
  }
  let unpushed = unpushedCount(ctx.brainDir);
  if (unpushed > 0) {
    const sync = brainSync(ctx.brainDir);
    unpushed = sync.unpushed ?? unpushedCount(ctx.brainDir);
    if (sync.conflict) signals.push(`conflict: ${sync.conflict.join(', ')} (brain not merged, P-040)`);
    else if (unpushed > 0) signals.push(`unpushed: ${unpushed}`);
  }
  if (ctx.thread) {
    const state = readThreadState(ctx.brainDir, ctx.thread);
    const picked = Array.isArray(state.picked_assist) ? state.picked_assist : [];
    // Once per queued line: a stop that finds the same reminder still waiting does not queue it again.
    if (picked.length && !(state.pending_signals || []).some((sig) => sig.startsWith('picked assist unanswered'))) signals.push(PICKED_ASSIST_LINE(picked));
    // P-030: each proposal (sequence -> skill) once per thread, not at every Stop that sees the count again.
    const proposed = Array.isArray(state.proposed) ? state.proposed : [];
    const added = [];
    const fresh = signals.filter((sig) => {
      const key = proposalKey(sig);
      if (!key) return true;
      if (proposed.includes(key) || added.includes(key)) return false;
      added.push(key);
      return true;
    });
    if (fresh.length) {
      const pending = [...(state.pending_signals || []), ...fresh].slice(-(ctx.policy.limits?.hook_signal_lines ?? 2));
      writeThreadState(ctx.brainDir, ctx.thread, { ...state, pending_signals: pending, proposed: [...proposed, ...added].slice(-200) });
    }
    // P-026 continuation: once per turn (stop_hook_active); a bell turn does not block (its job is that one message, P-047).
    if (!input.stop_hook_active && state.turn_source !== 'wake') {
      if (work) return end({ decision: 'block', reason: NEXT_STEP_REASON(work.id, work.next) });
    }
  }
  return end({});
}

if (isMain(import.meta.url)) {
  let out = {};
  try {
    out = run(readHookInput()) || {};
  } catch (err) {
    process.stderr.write(`stop: ${err.message}\n`);
  }
  emit(out);
}
