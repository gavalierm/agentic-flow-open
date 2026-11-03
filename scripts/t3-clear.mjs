// T3-WORKAROUND(t3-clear-cursor) T3 /clear workaround (pingdotgg/t3code#24152): after /clear the Claude SDK starts a new session, but T3 keeps resuming
// the session it opened first (its resume cursor). Once the query closes (idle, restart, interrupt), the thread falls back
// to the pre-clear conversation, or fails with "No conversation found" when the old transcript does not exist.
// Fix on our side: the transcript T3 resumes, <cursor>.jsonl, becomes a symlink to the newest session's transcript.
// Claude Code follows the link on --resume and appends to the new transcript (checked 2026-11-03).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** query.open event of T3's provider log that resumes a session; group 1 is the session id (T3 internal format). */
export const RESUME_RE = /"type":"query\.open","options":\{[^\n]*?"resume":"([0-9a-f-]{36})"/g;

const SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Last session id T3 resumed for this thread, from its provider log (fallback when the cursor was not recorded). */
export function cursorFromProviderLog(thread, logDir = path.join(os.homedir(), '.t3', 'userdata', 'logs', 'provider')) {
  if (!thread) return null;
  const names = [...new Set([thread.replace(/:/g, '-'), thread.replace(/^[a-z]+:/, '')])].map((n) => path.join(logDir, `events.${n}.log`));
  for (const file of names) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const all = [...text.matchAll(RESUME_RE)];
    if (all.length) return all[all.length - 1][1];
  }
  return null;
}

/**
 * SessionStart in a T3 thread. startup: the new session is T3's cursor; resume: keep the recorded cursor (record it once).
 * clear: point <cursor>.jsonl at the new session's transcript (the real old file is kept as <cursor>.jsonl.pre-clear-<ts>).
 * Returns { state, note } where state is the updated thread state and note a one-line result for the boot context (or null).
 */
export function handleT3Session(input, state, { thread, logDir, now = new Date() } = {}) {
  const source = input.source || 'startup';
  const sid = input.session_id;
  if (!SID.test(sid || '')) return { state, note: null };
  if (source === 'startup') return { state: { ...state, t3_cursor: sid }, note: null };
  if (source === 'resume') return { state: state.t3_cursor ? state : { ...state, t3_cursor: sid }, note: null };
  if (source !== 'clear') return { state, note: null };
  const cursor = SID.test(state.t3_cursor || '') ? state.t3_cursor : cursorFromProviderLog(thread, logDir);
  if (!cursor) return { state, note: 'T3 /clear: neznámy kurzor T3 (session, ktorú T3 obnovuje); po zatvorení query sa vlákno vráti pred /clear.' };
  if (cursor === sid || path.basename(input.transcript_path || '') !== `${sid}.jsonl`) return { state: { ...state, t3_cursor: cursor }, note: null };
  const dir = path.dirname(input.transcript_path);
  const link = path.join(dir, `${cursor}.jsonl`);
  const target = `${sid}.jsonl`;
  try {
    let st = null;
    try { st = fs.lstatSync(link); } catch { /* no transcript yet: T3 would fail with No conversation found */ }
    if (st?.isSymbolicLink()) fs.unlinkSync(link);
    else if (st) fs.renameSync(link, `${link}.pre-clear-${now.toISOString().replace(/[:.]/g, '-')}`);
    fs.symlinkSync(target, link);
  } catch (err) {
    return { state: { ...state, t3_cursor: cursor }, note: `T3 /clear: presmerovanie ${cursor}.jsonl zlyhalo (${err.message}); po zatvorení query sa vlákno vráti pred /clear.` };
  }
  return { state: { ...state, t3_cursor: cursor, t3_cleared_to: sid, t3_cleared_at: now.toISOString() }, note: `T3 /clear: kurzor T3 ${cursor.slice(0, 8)} presmerovaný na novú session ${sid.slice(0, 8)}; vlákno pokračuje aj po obnovení query.` };
}
