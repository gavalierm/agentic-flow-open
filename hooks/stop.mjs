#!/usr/bin/env node
// Stop: closes the turn record for keepalive (P-043, with the turn's opened_at); one brain write per turn for buffered logs
// (P-030); signals are queued for the next prompt (P-023 c), each skill proposal once per thread. A missing reply is found by the message TTL in the mail service (P-042, P-046), not here.
// Picked assist (P-042, 2026-11-02): an assist message this thread picked up (`comms receive`) and has not answered (`send --reply-to`)
// is one queued line at the stop, not a block: the answer is due, the turn may still end.
// Continuation (P-026): a held work topic whose handover has a next step blocks the stop once: do the step now; stop only
// with a blocker question to the operator (P-059) or a verified waker (P-057). A written next step is work, not a closure.
// Check-in (P-059): a turn whose reply ends with a permission question ("Mám to zadať pracovníkovi?", "Should I start?")
// is blocked once: do the step if it is in the assignment; ask again only as a blocker and name which one.
// Never stop (P-057, operator 2026-11-03): a reply that says it waits ("čakám") or leaves a question to the operator
// needs a waker armed by code (thread timer, background task, scheduler, mail with a deadline). Without one the stop is
// blocked once; ending anyway arms the thread timer here (15 min, doubling up to 2 h), so the thread is rung again.
// This applies in bell turns too: a message never stops the work. The timer goes with the closed turn (resume_at).
// Mistake (P-003, operator 2026-11-03): a reply that says something happened by mistake ("omylom", "by mistake") names an
// error; the stop is blocked once, also in bell turns: handle it with workflow:error (fix, skill or rule, report).
import { readHookInput, emit, isMain } from '../scripts/hooks-io.mjs';
import { loadContext, readThreadState, writeThreadState } from '../scripts/config.mjs';
import { flushBuffer, proposalKey } from '../scripts/logs.mjs';
import { unpushedCount, brainSync } from '../scripts/brain.mjs';
import { recordTurn, isMainTopic } from '../scripts/comms.mjs';
import { heldTopics } from '../scripts/topic.mjs';
import { waitingClaim, operatorQuestion, validWaker, activeTimer, setTimer, WAIT_REASON, AUTO_TIMER_MS, AUTO_TIMER_MAX_MS } from '../scripts/waker.mjs';

export const HOOK_META = { event: 'Stop', class: 'c', limit: '2 lines (queued to next prompt); 1 block reason', principles: ['P-003', 'P-026', 'P-030', 'P-040', 'P-042', 'P-043', 'P-059', 'P-057'] };

export const AUTO_TIMER_THEN = 'the last turn ended waiting without a timer: continue the work now; decide with your recommended option (P-057)';

export const NEXT_STEP_REASON = (topic, next) => `handover of topic ${topic} has a next step: "${next}". Do it now in this turn. Stop only if it needs the operator (ask as a blocker, P-059) or waits for an event with a verified waker (P-057); then end without a new message to the operator (no waker, ID, run time or commit: operational data is not for the operator, P-060). A next step in the handover is not a reason to end the turn, P-026`;

export const CHECK_IN_REASON = (q) => `the reply ends with a check-in question: "${q}". A question whether to start, continue or do a step of the assignment is forbidden (P-059): if the step is within the assignment, the held topic and your authority, do it now in this turn. Ask only as a blocker (input only the operator has; step beyond the assignment or authority, P-002/P-018/P-024; a rule requires consent; a choice of operator priority) and then say which blocker it is`;

// Words that admit a mistake (sk, cs, en). `\b` is ASCII-only, so letter boundaries use \p{L}.
const MISTAKE = /(?<!\p{L})(omylom|omylem|nedopatrením|nechtiac|by mistake|accidentally|mistakenly|inadvertently|unintentionally)(?!\p{L})/iu;

/** The sentence of the reply that admits a mistake, or null. */
export function mistakeClaim(text) {
  if (typeof text !== 'string') return null;
  // A quoted word is a mention, not an admission (alice 2026-11-03: the reply describing this hook was blocked).
  const plain = text.replace(/„[^“\n]*“|"[^"\n]*"|`[^`\n]*`/g, (q) => ' '.repeat(q.length));
  const m = MISTAKE.exec(plain);
  if (!m) return null;
  const from = Math.max(text.lastIndexOf('\n', m.index), ...['. ', '! ', '? '].map((d) => text.lastIndexOf(d, m.index))) + 1;
  const ends = ['. ', '! ', '? ', '\n'].map((d) => text.indexOf(d, m.index)).filter((i) => i >= 0);
  const to = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(from, to).replace(/[*_`]/g, '').trim().slice(0, 160);
}

export const MISTAKE_REASON = (sentence) => `the reply says something happened by mistake: "${sentence}". A mistake is an error (P-003): handle it now with skill workflow:error (fix the result, clean up what it left, save a skill or rule so it does not repeat, report it to the workflow maintainer); then say what you saved. Do not ask the operator whether to do it (P-059)`;

// Permission / check-in openers (sk, en), matched on the reply's last sentence only. `\b` is ASCII-only in JS
// ("Začať" ends in a non-word char), so word ends are spelled out.
const W = '(?=[\\s,.?!]|$)';
const opener = (words) => new RegExp(`^(a\\s+)?(${words})${W}`, 'i');
const CHECK_IN = [
  opener('mám|máme|môžem|môžeme|smiem|mal by som|mám ísť'),
  opener('chceš|chcete|želáš si|želáte si'),
  opener('pokračovať|začať|spustiť|pustiť sa|urobiť|zadať|opraviť|vydať|nasadiť|ísť na to'),
  opener('pokračujem|začnem|spustím|pustím sa|urobím|zadám|opravím'),
  /^(should|shall|can|may) (i|we)\b/i, /^(do|would) you (want|like) me to\b/i, /^want me to\b/i, /^(proceed|continue|go ahead)\b/i,
];

/** The reply's closing check-in question, or null. Only a question that ends the reply counts (the operator must answer it). */
export function checkInQuestion(text) {
  if (typeof text !== 'string') return null;
  const tail = text.replace(/[\s*_`]+$/, '');
  if (!tail.endsWith('?')) return null;
  // Last sentence: after the last sentence end or line break before the final '?'.
  const body = tail.slice(0, -1);
  const cut = Math.max(body.lastIndexOf('\n'), ...['. ', '! ', '? ', ': '].map((d) => { const i = body.lastIndexOf(d); return i < 0 ? -1 : i + 1; }));
  const q = (body.slice(cut + 1).replace(/^[-*>#_`\s]+/, '').trim() + '?');
  return CHECK_IN.some((re) => re.test(q)) ? q : null;
}

export const PICKED_ASSIST_LINE = (list) => `picked assist unanswered: ${list.map((w) => w.id).join(', ')}; answer each with comms send --reply-to <id>; answered another way (one reply for several, a new message): comms settle --id <id>; else say why it waits (P-042)`;

export function run(input) {
  const ctx = loadContext({ requireBrain: false });
  // Turn record for keepalive (P-043); an outage never fails the hook.
  // `opened_at` of this turn's record (from the prompt hook) keeps a late Stop from closing a newer turn.
  let held = [];
  let work = null;
  let closeTurn = () => {};
  // The reply waits for the operator or asks them: the handover step is the operator's move, not a continuation; only a
  // timer (resume_at) rings the thread (bob 2026-11-03: rung 76 s after a question, before the operator could read it).
  const toOperator = !!(waitingClaim(input.last_assistant_message) || operatorQuestion(input.last_assistant_message));
  if (ctx.thread) {
    try { held = ctx.brainDir ? heldTopics(ctx.brainDir, ctx.thread) : []; } catch { held = []; }
    const openedAt = ctx.brainDir ? readThreadState(ctx.brainDir, ctx.thread).turn_opened_at ?? null : null;
    // P-026: the next step travels with the closed turn; wake (code, not the agent) rings the thread to continue it.
    work = held.find((t) => !isMainTopic(t) && t.next);
    closeTurn = () => {
      const timer = ctx.brainDir ? activeTimer(readThreadState(ctx.brainDir, ctx.thread)) : null;
      recordTurn(ctx, 'closed', held, { openedAt, next: timer?.then || (toOperator ? null : work?.next) || null, resumeAt: timer?.at || null });
    };
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
    // P-057: waiting or an open question needs a waker; also in bell turns (a message never stops the work).
    const msg = input.last_assistant_message;
    const mistake = input.stop_hook_active ? null : mistakeClaim(msg);
    const waits = waitingClaim(msg);
    const asks = waits ? null : operatorQuestion(msg);
    const waiting = (waits || asks) && !validWaker(readThreadState(ctx.brainDir, ctx.thread)) ? (waits ? `says it waits ("${waits}")` : `ends with an open question to the operator ("${String(asks).slice(0, 80)}")`) : null;
    if (waiting && !input.stop_hook_active) {
      const q = state.turn_source !== 'wake' && checkInQuestion(msg);
      return end({ decision: 'block', reason: [mistake && MISTAKE_REASON(mistake), q && CHECK_IN_REASON(q), WAIT_REASON(waiting)].filter(Boolean).join('\n') });
    }
    if (waiting) {
      // Ended waiting anyway: code arms the timer, so the thread is rung again (never an idle promise).
      const st = readThreadState(ctx.brainDir, ctx.thread);
      const n = Number(st.auto_timer_n || 0);
      setTimer(ctx.brainDir, ctx.thread, { delayMs: Math.min(AUTO_TIMER_MS * 2 ** n, AUTO_TIMER_MAX_MS), then: AUTO_TIMER_THEN, auto: true });
      writeThreadState(ctx.brainDir, ctx.thread, { ...readThreadState(ctx.brainDir, ctx.thread), auto_timer_n: n + 1 });
    }
    // P-026 continuation and check-in: once per turn (stop_hook_active); a bell turn does not block on them (its job is that
    // one message, P-047). A mistake blocks in every turn (P-003).
    if (!input.stop_hook_active) {
      const bell = state.turn_source === 'wake';
      const q = !bell && checkInQuestion(msg);
      // The same next step blocks once per thread: a step that waits for a later event (a daily report) would otherwise make
      // every turn end with a second, operational message (alice 2026-11-03: the report scrolled away under waker notes).
      const nextKey = work ? `${work.id}\n${work.next}` : null;
      const nextStep = !bell && !toOperator && work && state.next_step_blocked !== nextKey;
      const reasons = [mistake && MISTAKE_REASON(mistake), q && CHECK_IN_REASON(q), nextStep && NEXT_STEP_REASON(work.id, work.next)].filter(Boolean);
      if (nextStep) writeThreadState(ctx.brainDir, ctx.thread, { ...readThreadState(ctx.brainDir, ctx.thread), next_step_blocked: nextKey });
      if (reasons.length) return end({ decision: 'block', reason: reasons.join('\n') });
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
