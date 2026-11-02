// P-036: the thread title follows the thread's topic. The hook cannot rename a thread itself (T3 renames only through its
// agent tool), so it reads the title (`thread_title.command`, default `t3 thread show --json <thread>`) once per change of the
// topic and gives the agent one line. Skipped: persona main threads (they hold `main`), titles the operator changed by hand
// (title differs from the one the workflow asked for and from the one it saw before), bell turns, a harness outside T3.
import { spawnSync } from 'node:child_process';

export const TITLE_TIMEOUT_MS = 3000;

/** Current thread title via the configured command; null when unavailable. */
export function readThreadTitle(ctx, run = spawnSync) {
  const cmd = String(ctx.policy?.thread_title?.command || '').trim().split(/\s+/).filter(Boolean);
  if (!cmd.length || !ctx.thread) return null;
  const r = run(cmd[0], [...cmd.slice(1), ctx.thread], { encoding: 'utf8', timeout: TITLE_TIMEOUT_MS });
  if (r.error || r.status !== 0) return null;
  try {
    const d = JSON.parse(r.stdout);
    const t = d?.thread?.title ?? d?.title;
    return typeof t === 'string' ? t : null;
  } catch { return null; }
}

/**
 * Decide about the title for this turn. `state` is the thread state; returns { line, patch } (patch merged into the state)
 * or null when nothing is to be done.
 */
export function threadTitleSignal(ctx, held, state, { read = readThreadTitle, env = process.env } = {}) {
  // Only inside T3 (it sets T3CODE_THREAD_ID); elsewhere there is no title to follow.
  if (!env.T3CODE_THREAD_ID || !ctx.policy?.thread_title?.command || !ctx.thread || !state) return null;
  if (!held.length || held.some((t) => t.id === 'main')) return null;
  const topic = held[0].id;
  if (state.title_topic === topic) return null;
  const current = read(ctx);
  if (current == null) return { line: null, patch: { title_topic: topic } };
  const target = topic;
  if (current === target) return { line: null, patch: { title_topic: topic, auto_title: target } };
  const known = [state.auto_title, state.title_prev].filter((t) => typeof t === 'string');
  if (known.length && !known.includes(current)) return { line: null, patch: { title_topic: topic, title_manual: current } };
  return {
    line: `thread title: rename this thread to "${target}" (tool t3_thread_update, action rename), P-036`,
    patch: { title_topic: topic, auto_title: target, title_prev: current },
  };
}
