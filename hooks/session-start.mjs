#!/usr/bin/env node
// SessionStart (startup, resume, clear, compact): boot sequence P-021 items 1, 3-7. Output class: boot context, limit 15 000 chars.
import fs from 'node:fs';
import { readHookInput, emit, contextOutput, isMain } from '../scripts/hooks-io.mjs';
import { loadContext } from '../scripts/config.mjs';
import { buildBootContext } from '../scripts/boot.mjs';

export const HOOK_META = { event: 'SessionStart', class: 'boot', limit: '15000 chars', principles: ['P-021', 'P-022', 'P-024', 'P-026', 'P-038', 'P-050'] };

export function run(input) {
  let ctx;
  try {
    ctx = loadContext({ project: input.cwd && !process.env.CLAUDE_PROJECT_DIR ? input.cwd : undefined, requireBrain: false });
  } catch (err) {
    return contextOutput('SessionStart', `## Workflow\nworkflow: cannot load context (${err.message})`);
  }
  exportProjectDir(ctx.projectDir);
  const boot = buildBootContext(ctx, { source: input.source || 'startup' });
  return contextOutput('SessionStart', boot.text);
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
