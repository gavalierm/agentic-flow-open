#!/usr/bin/env node
// Support script for skill error (P-003, P-028, P-030): list unprocessed failures, check for an existing skill, mark a failure processed.
//   error.mjs list [--agent <id>]
//   error.mjs check <tool-or-work>      -> existing brain skill to extend, or "none"
//   error.mjs resolve <n>               -> remove failure line n after the lesson was saved
import { parseArgs, fail } from '../scripts/util.mjs';
import { loadContext } from '../scripts/config.mjs';
import { listFailures } from '../scripts/logs.mjs';
import { find, formatMatches } from '../scripts/find.mjs';
import { readSkills } from '../scripts/records.mjs';
import { tokens } from '../scripts/keys.mjs';
import { brainWrite } from '../scripts/brain.mjs';
import { heldTopics } from '../scripts/topic.mjs';

// P-003 step 5: every error goes to the workflow maintainer, or the lesson stays in one brain.
const REPORT_LINE = 'then report the error to the workflow maintainer: comms send --to maintainer/workflow-dev --level assist: what happened, cause, what you saved (P-003)';

const args = parseArgs(process.argv.slice(2));
const [cmd, arg] = args._;
const out = (s) => process.stdout.write(s + '\n');

try {
  const ctx = loadContext({ project: args.project });
  if (cmd === 'list') {
    let lines = listFailures(ctx.brainDir);
    if (args.agent) lines = lines.filter((l) => l.split(' ')[1] === args.agent);
    out(lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : 'no unprocessed failures');
    if (lines.length) out('after saving the lesson (save skill ... --origin error): error.mjs resolve <n>');
  } else if (cmd === 'check') {
    if (!arg) fail('usage: error.mjs check <tool-or-work>');
    const exact = find(ctx.brainDir, arg).filter((m) => m.kind === 'skill');
    const want = new Set(tokens(args._.slice(1).join(' ')));
    const fuzzy = readSkills(ctx.brainDir).filter((s) => tokens(`${s.skillName} ${s.description}`).some((t) => want.has(t))).map((s) => ({ path: s.path, description: `${s.skillName} [${s.owner}]: ${s.description}` }));
    const hits = exact.length ? exact : fuzzy;
    out(hits.length ? `existing skill(s) for "${arg}" (extend, do not create):\n${formatMatches(hits)}` : `none: create a new skill with save skill <name> --origin error --description "Použi, keď ..."`);
    // The maintainer's own thread does not mail itself: it fixes the error in workflow-dev directly (error skill, step 5).
    const maintainer = ctx.brainDir && ctx.thread && heldTopics(ctx.brainDir, ctx.thread).some((t) => t.id === 'workflow-dev');
    out(maintainer ? 'this thread holds workflow-dev: do not mail the report to yourself; fix the error here (skill fix) (P-003)' : REPORT_LINE);
  } else if (cmd === 'resolve') {
    const n = Number(arg);
    const lines = listFailures(ctx.brainDir);
    if (!n || !lines[n - 1]) fail(`no failure line ${arg}`);
    const keep = lines.filter((_, i) => i !== n - 1);
    brainWrite(ctx, { internal: true, ops: [{ path: 'logs/failures.log', content: keep.length ? keep.join('\n') + '\n' : '' }], message: `error: failure ${n} processed` });
    out(`failure ${n} processed; remaining ${keep.length}`);
  } else {
    fail('usage: error.mjs list | check <tool> | resolve <n>');
  }
} catch (err) {
  fail(err.message);
}
