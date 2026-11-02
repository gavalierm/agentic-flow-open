#!/usr/bin/env node
// Single writer CLI for brain (P-040).
//   brain.mjs write <path> --message "..." (--content "..." | --file <src> | --stdin)
//   brain.mjs remove <path> --message "..."
//   brain.mjs sync | status
import fs from 'node:fs';
import { parseArgs, readStdin, fail } from '../scripts/util.mjs';
import { loadContext } from '../scripts/config.mjs';
import { brainWrite, brainSync, unpushedCount, formatWriteResult } from '../scripts/brain.mjs';

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
  } else if (cmd === 'sync') {
    const res = brainSync(ctx.brainDir);
    if (res.conflict) fail(`conflict: ${res.conflict.join(', ')} (not merged, P-040)`);
    process.stdout.write(`${res.pushed ? 'pushed' : 'not pushed'}; unpushed: ${res.unpushed}${res.error ? ` (${res.error})` : ''}\n`);
  } else if (cmd === 'status') {
    process.stdout.write(`brain ${ctx.brainDir}\nunpushed: ${unpushedCount(ctx.brainDir)}\n`);
  } else {
    fail('usage: brain.mjs write|remove|sync|status');
  }
} catch (err) {
  fail(err.message);
}
