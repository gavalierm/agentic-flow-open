#!/usr/bin/env node
// Single writer CLI for brain (P-040).
//   brain.mjs write <path> --message "..." (--content "..." | --file <src> | --stdin)
//   brain.mjs remove <path> --message "..."
//   brain.mjs sync | status
//   brain.mjs resolve <file> --keep local|remote   settle a disagreement on one file (this machine's version or origin's)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readStdin, fail } from '../scripts/util.mjs';
import { loadContext } from '../scripts/config.mjs';
import { brainWrite, brainSync, unpushedCount, formatWriteResult, conflictText } from '../scripts/brain.mjs';

const args = parseArgs(process.argv.slice(2));
const [cmd, target] = args._;

try {
  const ctx = loadContext({ project: args.project });
  if (cmd === 'write') {
    if (!target) fail('usage: brain.mjs write <path> --message "..." --content "..."');
    let content = args.content;
    if (args.file) content = fs.readFileSync(args.file, 'utf8');
    if (args.stdin) content = readStdin();
    if (content === undefined || content === true) fail('content required (--content, --file or --stdin)');
    const res = brainWrite(ctx, { ops: [{ path: target, content: String(content) }], message: args.message, internal: !!args.internal && process.env.WORKFLOW_INTERNAL === '1' });
    process.stdout.write(formatWriteResult(res, [target]) + '\n');
  } else if (cmd === 'remove') {
    if (!target) fail('usage: brain.mjs remove <path> --message "..."');
    const res = brainWrite(ctx, { ops: [{ path: target, remove: true }], message: args.message });
    process.stdout.write(formatWriteResult(res, [target]) + '\n');
  } else if (cmd === 'sync' || cmd === 'resolve') {
    // Sides chosen for several files are kept until the sync goes through (one resolve per file, any order).
    const store = path.join(ctx.brainDir, 'local', 'resolutions.json');
    let resolutions = {};
    if (cmd === 'resolve') {
      if (!target || !['local', 'remote'].includes(args.keep)) fail('usage: brain.mjs resolve <file> --keep local|remote');
      try { resolutions = JSON.parse(fs.readFileSync(store, 'utf8')); } catch { resolutions = {}; }
      resolutions[target.replace(/^\.\//, '')] = args.keep;
    }
    const res = brainSync(ctx.brainDir, { resolutions });
    for (const n of res.notices || []) process.stdout.write(`${n}\n`);
    if (cmd === 'resolve') {
      if (res.conflict) { fs.mkdirSync(path.dirname(store), { recursive: true }); fs.writeFileSync(store, JSON.stringify(resolutions, null, 2) + '\n'); }
      else fs.rmSync(store, { force: true });
    }
    if (res.conflict) fail(`${conflictText(res.conflict)}${cmd === 'resolve' ? ` (chosen so far: ${Object.entries(resolutions).map(([f, k]) => `${f} ${k}`).join(', ')})` : ''}`);
    process.stdout.write(`${res.pushed ? 'pushed' : 'not pushed'}; unpushed: ${res.unpushed}${res.error ? ` (${res.error})` : ''}\n`);
  } else if (cmd === 'status') {
    process.stdout.write(`brain ${ctx.brainDir}\nunpushed: ${unpushedCount(ctx.brainDir)}\n`);
  } else {
    fail('usage: brain.mjs write|remove|sync|resolve|status');
  }
} catch (err) {
  fail(err.message);
}
