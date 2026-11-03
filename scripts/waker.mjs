// Work never stops (P-057, operator 2026-11-03): no message, question or event stops the work; it may only be deferred
// to a set time. A turn that ends waiting ("čakám", a question to the operator) needs a real waker armed by code:
// the thread timer (bin/timer.mjs, rung by the wake module through the closed turn's resume_at), a background task or
// agent (the harness re-invokes the thread), a harness scheduler (schedule_task, CronCreate, ScheduleWakeup), or mail
// sent with a pickup deadline. The Stop hook blocks a waiting end without one and, if the agent ends anyway, arms the
// timer itself, so no thread is left idle on a promise.
import path from 'node:path';
import { readThreadState, writeThreadState } from './config.mjs';
import { PLUGIN_ROOT } from './util.mjs';

export const TIMER_CMD = `node ${path.join(PLUGIN_ROOT, 'bin', 'timer.mjs')}`;

export const TIMER_MIN_MS = 60_000;
export const TIMER_MAX_MS = 24 * 3600_000;
/** Background work notifies the thread when done; it counts as a waker this long. */
export const BACKGROUND_WAKER_MS = 2 * 3600_000;
/** Timer the Stop hook arms itself when the agent ended waiting without one (doubles per repeat, up to the max). */
export const AUTO_TIMER_MS = 15 * 60_000;
export const AUTO_TIMER_MAX_MS = 2 * 3600_000;
/** Reply window after sending mail that needs an answer: the sender is rung then even if nobody replied. */
export const REPLY_WINDOW_MS = { blocker: 15 * 60_000, assist: 60 * 60_000 };

const L = '\\p{L}';
// "čakám", "počkám", "čakáme", "cakam", "čakať", "čaká na …", "waiting for", "I'll wait" (sk without diacritics too).
const WAIT_PATTERNS = [
  new RegExp(`(^|[^${L}])(po)?[čc]ak(ám|am|áme|ame|ať|at)(?![${L}])`, 'iu'),
  new RegExp(`(^|[^${L}])(po)?[čc]ak(á|a|ajú|aju|ú|u)\\s+na(?![${L}])`, 'iu'),
  new RegExp(`(^|[^${L}])po[čc]k(ám|am|áme|ame|ať|at)(?![${L}])`, 'iu'),
  /\b(waiting|wait|awaiting)\s+(for|on|until)\b/i,
  /\bI('ll| will| am|'m)\s+(wait|waiting)\b/i,
  // bob 2026-11-03: "Zostáva len čakanie na teba", "Potrebujem od teba, čo …" ended a turn waiting, unseen.
  new RegExp(`(^|[^${L}])(zost[áa]va|ost[áa]va|nasleduje)\\s+(len\\s+|iba\\s+|u[žz]\\s+)?[čc]akanie\\s+na(?![${L}])`, 'iu'),
  new RegExp(`(^|[^${L}])potrebujem\\s+od\\s+(teba|vás|vas)(?![${L}])`, 'iu'),
  new RegExp(`(^|[^${L}])bez\\s+tvojho\\s+pokynu(?![${L}])`, 'iu'),
];

const CONDITIONAL = new RegExp(`^\\s*([-*•]\\s*)?(\\*\\*)?(keď|ked|ak|kým|kym|pokiaľ|pokial|až|if|when|whenever|once)(?![${L}])`, 'iu');

/** The waiting phrase of the reply ("čakám na …"), or null. Quoted and code text is left out (it is data, not a claim). */
export function waitingClaim(text) {
  if (typeof text !== 'string' || !text) return null;
  const quoted = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/[„"“][^„"“”\n]*[”"“]/g, ' ');
  // A conditional clause describes a case, not this reply's state (alice 2026-11-03: "Keď krok čaká na neskoršiu udalosť,
  // hook …" was blocked as waiting).
  const prose = quoted.split(/(?<=[,.;:!?\n])/).filter((c) => !CONDITIONAL.test(c)).join(' ');
  for (const re of WAIT_PATTERNS) {
    const m = re.exec(prose);
    if (m) {
      const at = m.index + (m[1] ? m[1].length : 0);
      return prose.slice(at, at + 60).split('\n')[0].trim();
    }
  }
  return null;
}

/** True when the reply leaves a question to the operator open: it ends with "?" or carries a "Pre teba" / "Blocker" block. */
export function operatorQuestion(text) {
  if (typeof text !== 'string' || !text) return null;
  const tail = text.replace(/[\s*_`)>\]]+$/, '');
  if (tail.endsWith('?')) {
    const body = tail.slice(0, -1);
    const cut = Math.max(body.lastIndexOf('\n'), body.lastIndexOf('. '), body.lastIndexOf('! '), body.lastIndexOf('? '));
    return `${body.slice(cut + 1).replace(/^[-*>#_`\s]+/, '').trim()}?`;
  }
  const m = /(^|\n)\s*[*_]*(Pre teba|Blocker)[*_:]*/i.exec(text);
  if (!m) return null;
  // P-056 override note: the agent already took an option and the operator may change it later; the work is not stopped
  // (alice 2026-11-03: the AskUserQuestion deny asks for this block, then Stop blocked it as an open question).
  return TAKEN.test(text.slice(m.index)) ? null : m[2];
}

const TAKEN = new RegExp(`(^|[^${L}])(vybral|vybrala|zvolil|zvolila|pokra[čc]ujem s|pou[žz]il som|pou[žz]ila som|išiel som|i[šs]la som|took|chose|went with|picked|proceeded with)(?![${L}])`, 'iu');

/** ms of "30m", "2h", "90s", "15" (minutes). Null when invalid. */
export function parseDelay(s) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(s|m|min|h)?\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'm').toLowerCase();
  return Math.round(n * (unit === 's' ? 1000 : unit === 'h' ? 3600_000 : 60_000));
}

/** Waker an agent armed with this tool call (PostToolUse input), or null. */
export function wakerFromTool(input, now = Date.now()) {
  const tool = String(input?.tool_name || '');
  const ti = input?.tool_input || {};
  const resp = input?.tool_response;
  const respText = typeof resp === 'string' ? resp : typeof resp?.stdout === 'string' ? resp.stdout : JSON.stringify(resp || {}).slice(0, 2000);
  const at = new Date(now).toISOString();
  const bg = (kind) => ({ kind, at, until: new Date(now + BACKGROUND_WAKER_MS).toISOString() });
  if ((tool === 'Bash' || tool === 'PowerShell') && ti.run_in_background === true) return bg('background');
  if ((tool === 'Agent' || tool === 'Task') && (ti.run_in_background === true || /async_launched|running in the background|run_in_background/i.test(respText))) return bg('agent');
  if (/(^|__)(schedule_task|t3_background_wait|delegate_task)$/.test(tool) || ['CronCreate', 'ScheduleWakeup', 'Monitor'].includes(tool)) return bg('scheduler');
  if ((tool === 'Bash' || tool === 'PowerShell') && /comms\.mjs\s+send\b/.test(String(ti.command || '')) && !/--reply-to/.test(String(ti.command || '')) && /(^|\n)sent \S+/.test(respText)) return bg('mail');
  return null;
}

/** Thread timer still ahead, or null. */
export function activeTimer(state, now = Date.now()) {
  const t = state?.timer;
  return t && Date.parse(t.at) > now ? t : null;
}

/** A waker for this turn: armed since the turn started, still running, or the thread timer ahead. */
export function validWaker(state, now = Date.now()) {
  const timer = activeTimer(state, now);
  if (timer) return { kind: 'timer', at: timer.at };
  const started = Date.parse(state?.turn_started_at || '') || 0;
  return (state?.wakers || []).find((w) => Date.parse(w.at) >= started || (w.until && Date.parse(w.until) > now)) || null;
}

export function recordWaker(brainDir, thread, waker) {
  if (!brainDir || !thread || !waker) return;
  const state = readThreadState(brainDir, thread);
  const now = Date.now();
  const keep = (state.wakers || []).filter((w) => w.until && Date.parse(w.until) > now).slice(-20);
  writeThreadState(brainDir, thread, { ...state, wakers: [...keep, waker] });
}

/** Set the thread timer: the wake module rings the thread at `at` with the step `then` (via the closed turn, P-057). */
export function setTimer(brainDir, thread, { delayMs, then, reason = null, auto = false, forId = null }, now = Date.now()) {
  const ms = Math.min(Math.max(delayMs, TIMER_MIN_MS), TIMER_MAX_MS);
  const state = readThreadState(brainDir, thread);
  const timer = { at: new Date(now + ms).toISOString(), then: String(then || '').slice(0, 300), set_at: new Date(now).toISOString(), ...(reason ? { reason } : {}), ...(auto ? { auto: true } : {}), ...(forId ? { for: forId } : {}) };
  writeThreadState(brainDir, thread, { ...state, timer, ...(auto ? {} : { auto_timer_n: 0 }) });
  return timer;
}

export function clearTimer(brainDir, thread) {
  const state = readThreadState(brainDir, thread);
  if (!state.timer) return false;
  const { timer, ...rest } = state;
  writeThreadState(brainDir, thread, rest);
  return true;
}

export const WAIT_REASON = (what) => `the reply ${what} but no waker is armed: work must never stop (P-057). Either continue the work now (decide with your recommended option and say it; the operator may override later), or arm a real timer before ending: ${TIMER_CMD} --in <minutes>m --then "<the step to do when it fires>" (or mail with a deadline, a background task, schedule_task). Writing "čakám" without a timer is forbidden`;
