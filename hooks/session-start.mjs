#!/usr/bin/env node
// SessionStart (startup, resume, clear, compact): boot sequence P-021 items 1, 3-7. Output class: boot context, limit 15 000 chars.
import fs from 'node:fs';
import { readHookInput, emit, contextOutput, isMain } from '../scripts/hooks-io.mjs';
import { loadContext } from '../scripts/config.mjs';
import { buildBootContext } from '../scripts/boot.mjs';
import { readThreadState, writeThreadState } from '../scripts/config.mjs';
import { installedWorkflow } from '../scripts/update-notice.mjs';
import { handleT3Session } from '../scripts/t3-clear.mjs';
import { brainPull, brainPullNote } from '../scripts/brain.mjs';
import { pinClone } from '../scripts/update.mjs';
import { PLUGIN_ROOT } from '../scripts/util.mjs';

export const HOOK_META = { event: 'SessionStart', class: 'boot', limit: '15000 chars', principles: ['P-021', 'P-022', 'P-024', 'P-026', 'P-038', 'P-050'] };

export function run(input) {
  let ctx;
  try {
    ctx = loadContext({ project: input.cwd && !process.env.CLAUDE_PROJECT_DIR ? input.cwd : undefined, requireBrain: false });
  } catch (err) {
    return contextOutput('SessionStart', `## Workflow\nworkflow: cannot load context (${err.message})`);
  }
  exportProjectDir(ctx.projectDir);
  // Several machines on one brain (P-040): pull first, so rules, indexes and holders of the boot are current.
  const pull = pullBrain(ctx);
  if (pull?.pulled) {
    try { ctx = loadContext({ project: ctx.projectDir, requireBrain: false }); } catch { /* keep the context loaded before the pull */ }
  }
  const notes = [brainPullNote(pull), pinWorkflow(ctx), t3Session(ctx, input)].filter(Boolean);
  const boot = buildBootContext(ctx, { source: input.source || 'startup', t3Note: notes.length ? notes.join('\n') : null });
  // P-021: the revision this session loaded; the prompt and tool hooks announce a later update once.
  if (ctx.brainDir && ctx.thread) {
    try { const w = installedWorkflow(); writeThreadState(ctx.brainDir, ctx.thread, { ...readThreadState(ctx.brainDir, ctx.thread), plugin_sha: w.sha, plugin_version: w.version }); } catch { /* state is best effort */ }
  }
  return contextOutput('SessionStart', boot.text);
}

export function pullBrain(ctx) {
  if (!ctx.brainDir) return null;
  try { return brainPull(ctx.brainDir); } catch (err) { return { pulled: 0, behind: 0, reason: null, error: err.message }; }
}

/**
 * Brain policy `workflow_version` (P-040): this machine runs the release the brain is pinned to. Only a clean release
 * install is switched; this session's hooks were already loaded, so the switch takes full effect in the next session.
 */
export function pinWorkflow(ctx, root = PLUGIN_ROOT) {
  const want = ctx.policy?.workflow_version;
  if (!want) return null;
  let r;
  try { r = pinClone(root, want); } catch (err) { r = { status: 'failed', reason: err.message }; }
  if (r.status === 'updated') return `workflow switched ${r.from} -> ${r.to} per brain policy workflow_version; this session started on ${r.from}: hooks and skills load fully in the next session (tell the operator) (P-040)`;
  if (r.status === 'failed' || (r.status === 'skipped' && !r.dev)) return `workflow not switched to ${r.to || want} (brain policy workflow_version): ${r.reason}`;
  return null;
}

/** T3-WORKAROUND(t3-clear-cursor) T3 /clear workaround (t3code#24152): record T3's resume cursor, redirect it to the new session on clear. */
export function t3Session(ctx, input) {
  if (!process.env.T3CODE_THREAD_ID || !ctx.brainDir || !ctx.thread) return null;
  try {
    const state = readThreadState(ctx.brainDir, ctx.thread);
    const r = handleT3Session(input, state, { thread: process.env.T3CODE_THREAD_ID, logDir: process.env.WORKFLOW_T3_PROVIDER_LOGS || undefined });
    if (r.state !== state) writeThreadState(ctx.brainDir, ctx.thread, r.state);
    return r.note;
  } catch (err) {
    return `T3 /clear: workaround failed (${err.message})`;
  }
}

/**
 * Workflow scripts run by the agent from Bash resolve the project from WORKFLOW_PROJECT_DIR, so they work from any cwd
 * (the agent often runs them from the skill directory or /root). Claude Code sources CLAUDE_ENV_FILE before each Bash command.
 */
export function exportProjectDir(projectDir, envFile = process.env.CLAUDE_ENV_FILE) {
  if (!envFile || !projectDir) return false;
  try {
    const line = `export WORKFLOW_PROJECT_DIR=${JSON.stringify(projectDir)}\n`;
    const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    if (!current.includes(line)) fs.appendFileSync(envFile, line);
    return true;
  } catch {
    return false;
  }
}

if (isMain(import.meta.url)) {
  try {
    emit(run(readHookInput()));
  } catch (err) {
    emit(contextOutput('SessionStart', `## Workflow\nworkflow: session-start failed (${err.message})`));
  }
}
