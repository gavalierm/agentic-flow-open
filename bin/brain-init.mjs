#!/usr/bin/env node
// Create or attach a brain repository from templates/brain (P-024, P-018, P-040).
//   brain-init.mjs <path> [--attach] [--remote <url>] [--project <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT, copyDir, git, fail, parseArgs, exists } from '../scripts/util.mjs';
import { BRAIN_COMMIT_TAG, BRAIN_SCRIPT_ENV, brainScriptEnv } from '../scripts/config.mjs';

export function brainInit(target, { attach = false, remote = null, project = null } = {}) {
  const brainDir = path.resolve(target);
  const template = path.join(PLUGIN_ROOT, 'templates', 'brain');
  const env = brainScriptEnv();
  const created = [];
  const isRepo = exists(path.join(brainDir, '.git'));

  if (isRepo && !attach) throw new Error(`${brainDir} is already a git repository; use --attach to activate it`);
  if (!isRepo && attach) throw new Error(`${brainDir} is not a git repository; run without --attach to create it`);

  if (!isRepo) {
    if (exists(brainDir) && fs.readdirSync(brainDir).length) throw new Error(`${brainDir} exists and is not empty`);
    copyDir(template, brainDir, { filter: (p) => path.basename(p) !== 'README.md' || path.dirname(p) === template });
    const init = git(['init', '--quiet', '-b', 'main'], { cwd: brainDir });
    if (!init.ok) throw new Error(`git init failed: ${init.stderr}`);
    created.push('repository');
  } else {
    // Attach: an empty clone (remote HEAD pointed elsewhere) gets the main branch checked out first.
    if (!git(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: brainDir }).ok) {
      git(['fetch', '--quiet', 'origin'], { cwd: brainDir });
      if (git(['rev-parse', '--verify', '--quiet', 'origin/main'], { cwd: brainDir }).ok) {
        git(['checkout', '--quiet', '-B', 'main', 'origin/main'], { cwd: brainDir });
        created.push('checked out main');
      }
    }
    // Make sure template infrastructure exists without touching data.
    for (const rel of ['.githooks', '.gitattributes', '.gitignore']) {
      const src = path.join(template, rel);
      const dest = path.join(brainDir, rel);
      if (!exists(dest)) {
        if (fs.statSync(src).isDirectory()) copyDir(src, dest);
        else fs.copyFileSync(src, dest);
        created.push(rel);
      }
    }
    for (const dir of ['memory', 'decisions', 'rules', 'skills/operator', 'skills/agentic', 'topics/archive', 'exceptions', 'logs']) {
      fs.mkdirSync(path.join(brainDir, dir), { recursive: true });
    }
  }
  for (const hook of ['pre-commit', 'commit-msg']) {
    try { fs.chmodSync(path.join(brainDir, '.githooks', hook), 0o755); } catch { /* windows */ }
  }
  const hooks = git(['config', 'core.hooksPath', '.githooks'], { cwd: brainDir });
  if (!hooks.ok) throw new Error(`git config failed: ${hooks.stderr}`);
  fs.mkdirSync(path.join(brainDir, 'local', 'index'), { recursive: true });
  fs.mkdirSync(path.join(brainDir, 'local', 'threads'), { recursive: true });
  fs.mkdirSync(path.join(brainDir, 'local', 'log-buffer'), { recursive: true });
  fs.mkdirSync(path.join(brainDir, 'local', 'outbox'), { recursive: true });
  created.push('local/');

  if (!isRepo) {
    git(['add', '-A'], { cwd: brainDir, env });
    const commit = git(['commit', '--quiet', '-m', `${BRAIN_COMMIT_TAG} init brain from workflow template`], { cwd: brainDir, env });
    if (!commit.ok) throw new Error(`initial commit failed: ${commit.stderr || commit.stdout}`);
  }
  if (remote) {
    git(['remote', 'remove', 'origin'], { cwd: brainDir });
    const add = git(['remote', 'add', 'origin', remote], { cwd: brainDir });
    if (!add.ok) throw new Error(`remote add failed: ${add.stderr}`);
    const push = git(['push', '--quiet', '-u', 'origin', 'main'], { cwd: brainDir });
    if (!push.ok) created.push(`remote set, push failed: ${push.stderr.split('\n')[0]}`);
    else created.push('pushed to origin');
  }
  if (project) {
    const localDir = path.join(path.resolve(project), 'local');
    fs.mkdirSync(localDir, { recursive: true });
    created.push(`${path.resolve(project)}/local/`);
  }
  return { brainDir, created };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('brain-init.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const [target] = args._;
  if (!target) fail('usage: brain-init.mjs <path> [--attach] [--remote <url>] [--project <dir>]');
  try {
    const res = brainInit(target, { attach: !!args.attach, remote: args.remote || null, project: args.project || null });
    process.stdout.write(`brain ${args.attach ? 'attached' : 'created'}: ${res.brainDir}\n${res.created.map((c) => `- ${c}`).join('\n')}\n`);
  } catch (err) {
    fail(err.message);
  }
}
