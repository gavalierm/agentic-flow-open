#!/usr/bin/env node
// Create a persona repo + brain. Repo name is always agent-<name>; fails if it exists.
//   persona-create.mjs <name> [--root <dir>] [--token-file <file>]
import { fail, parseArgs } from '../scripts/util.mjs';
import { createPersona } from '../scripts/persona-create.mjs';

const args = parseArgs(process.argv.slice(2));
const [name] = args._;
if (!name) fail('usage: persona-create.mjs <name> [--root <dir>] [--token-file <file>]  (short name, e.g. "bob" -> repo agent-bob)');
try {
  const opts = {};
  if (args.root) opts.root = args.root;
  if (args['token-file']) opts.tokenFile = args['token-file'];
  const res = await createPersona(name, opts);
  process.stdout.write(`persona created: ${res.owner}/${res.repo} -> ${res.dir}\n${res.created.map((c) => `- ${c}`).join('\n')}\n`);
} catch (err) {
  fail(err.message);
}
