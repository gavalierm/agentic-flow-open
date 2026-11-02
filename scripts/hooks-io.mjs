// Translation of Claude Code hook stdin/stdout (P-017). Logic lives elsewhere; this file only shapes JSON.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin } from './util.mjs';

export function readHookInput() {
  const raw = readStdin();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
  } catch {
    return false;
  }
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function contextOutput(event, text, extra = {}) {
  const out = { ...extra };
  if (text && text.trim()) out.hookSpecificOutput = { hookEventName: event, additionalContext: text.replace(/\s+$/, '') };
  return out;
}

export function permissionOutput(decision, reason, additionalContext = null) {
  const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason };
  if (additionalContext) hookSpecificOutput.additionalContext = additionalContext;
  return { hookSpecificOutput };
}

/** Enforce the P-023 line limit for mid-session hooks: report instead of trimming silently. */
export function enforceLines(text, max) {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  if (lines.length <= max) return { text: lines.join('\n'), exceeded: false };
  return { text: lines.slice(0, max).join('\n'), exceeded: true, dropped: lines.length - max };
}
