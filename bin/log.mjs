#!/usr/bin/env node
// log.mjs flush --session <id>      write buffered observations to brain logs (one commit per turn)
//         failures [--resolve <n>]  list unprocessed failures / remove line n (after error skill)
//         names <procedures|derivations>
import { parseArgs, fail } from '../scripts/util.mjs';
import { loadContext } from '../scripts/config.mjs';
import { flushBuffer, listFailures, existingNames } from '../scripts/logs.mjs';
import { brainWrite } from '../scripts/brain.mjs';

const args = parseArgs(process.argv.slice(2));
const [cmd, arg] = args._;
try {
  const ctx = loadContext({ project: args.project });
  if (cmd === 'flush') {
    const res = flushBuffer(ctx, args.session || 'manual');
    process.stdout.write(`${res.written ? 'flushed' : 'nothing to flush'}${res.sequences ? `; sequences ${res.sequences}` : ''}${res.failures ? `; failures ${res.failures}` : ''}\n`);
    for (const s of res.signals) process.stdout.write(`${s}\n`);
  } else if (cmd === 'failures') {
    const lines = listFailures(ctx.brainDir);
    if (args.resolve) {
      const n = Number(args.resolve);
      if (!lines[n - 1]) fail(`no failure line ${n}`);
      const keep = lines.filter((_, i) => i !== n - 1);
      brainWrite(ctx, { internal: true, ops: [{ path: 'logs/failures.log', content: keep.length ? keep.join('\n') + '\n' : '' }], message: `failure ${n} processed via error skill` });
      process.stdout.write(`resolved failure ${n}; remaining ${keep.length}\n`);
    } else {
      process.stdout.write(lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') + '\n' : 'no unprocessed failures\n');
    }
  } else if (cmd === 'names') {
    const log = arg === 'derivations' ? 'derivations.log' : 'procedures.log';
    const names = existingNames(ctx.brainDir, log);
    process.stdout.write(names.length ? names.map((n) => `${n.name} ${n.count}x`).join('\n') + '\n' : `no names in ${log}\n`);
  } else {
    fail('usage: log.mjs flush --session <id> | failures [--resolve n] | names procedures|derivations');
  }
} catch (err) {
  fail(err.message);
}
