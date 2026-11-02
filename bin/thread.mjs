#!/usr/bin/env node
// Start the harness with a stable thread id (P-038).
//   thread.mjs [--id <id>] [--harness claude] [-- <harness args>]
//   thread.mjs --print-id
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const own = sep === -1 ? argv : argv.slice(0, sep);
const rest = sep === -1 ? [] : argv.slice(sep + 1);
const opt = (name) => { const i = own.indexOf(`--${name}`); return i === -1 ? null : own[i + 1] || true; };

const id = (typeof opt('id') === 'string' && opt('id')) || process.env.WORKFLOW_THREAD_ID || process.env.T3CODE_THREAD_ID || randomBytes(4).toString('hex');
if (opt('print-id')) {
  process.stdout.write(id + '\n');
  process.exit(0);
}
const harness = typeof opt('harness') === 'string' ? opt('harness') : 'claude';
process.stderr.write(`thread ${id}\n`);
const res = spawnSync(harness, rest, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, WORKFLOW_THREAD_ID: id } });
if (res.error) {
  process.stderr.write(`cannot start ${harness}: ${res.error.message}\n`);
  process.exit(1);
}
process.exit(res.status ?? 0);
