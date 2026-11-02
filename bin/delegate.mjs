#!/usr/bin/env node
// Support script for skill delegate (P-027, P-028): bundle brain skills whose trigger matches the task, and check a worker result.
//   delegate.mjs prepare --task "..."             -> task block with bundled skills (paste into the Agent prompt)
//   delegate.mjs check (--file <result> | --stdin) -> verifies "Failures" section and the size limit
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, fail, readStdin, readText } from '../scripts/util.mjs';
import { loadContext } from '../scripts/config.mjs';
import { readSkills } from '../scripts/records.mjs';
import { tokens } from '../scripts/keys.mjs';
const toPosixPath = (p) => String(p).replace(/\\/g, '/');

const args = parseArgs(process.argv.slice(2));
const [cmd] = args._;
const out = (s) => process.stdout.write(s + '\n');

export function selectSkills(skills, task) {
  const want = new Set(tokens(task).filter((t) => t.length > 3));
  return skills.filter((s) => tokens(`${s.skillName} ${s.description} ${s.aliases.join(' ')}`).some((t) => want.has(t)));
}

export function checkResult(text, limit) {
  const errors = [];
  if (!/(^|\n)\s*(#+\s*|\*\*)?failures\b/i.test(text)) errors.push('missing "Failures" section (P-028)');
  if (text.length > limit) errors.push(`result ${text.length} chars > ${limit} (P-027)`);
  return errors;
}

if (process.argv[1]?.endsWith('delegate.mjs')) try {
  const ctx = loadContext({ project: args.project, requireBrain: cmd === 'prepare' });
  if (cmd === 'prepare') {
    if (!args.task) fail('usage: delegate.mjs prepare --task "..."');
    const selected = selectSkills(readSkills(ctx.brainDir), args.task);
    const limit = ctx.policy.limits.worker_result_chars;
    const parts = [];
    parts.push('## Zadanie', String(args.task).trim(), '');
    parts.push('## Pravidlá výsledku', `- Vráť záver so zdrojmi, najviac ${limit} znakov; nie surový obsah.`, '- Nezapisuj do brain, nedrž tému, nekomunikuj s operátorom; výsledok vráť rodičovi (P-025).', '- Kód meň iba v kópii témy, ak ju zadanie uvádza.', `- Pracovné súbory (pokusy, klon, medzivýsledky) iba do ${toPosixPath(path.join(ctx.projectDir, 'scratch'))}/, nikdy /tmp ani ~ (P-052).`, '- Výsledok MUSÍ končiť časťou "Failures: čo zlyhalo a čo nakoniec fungovalo" (alebo "Failures: none").', '');
    if (selected.length) {
      parts.push('## Pribalené skilly');
      for (const s of selected) parts.push(`### ${s.skillName} (${s.path})`, readText(path.join(ctx.brainDir, s.path), '').trim(), '');
    } else {
      parts.push('## Pribalené skilly', '(žiadny skill brain nezodpovedá zadaniu)', '');
    }
    out(parts.join('\n'));
    process.stderr.write(`bundled skills: ${selected.length ? selected.map((s) => s.skillName).join(', ') : 'none'}\n`);
  } else if (cmd === 'check') {
    const text = args.file ? fs.readFileSync(args.file, 'utf8') : readStdin();
    const errors = checkResult(text, ctx.policy.limits.worker_result_chars);
    if (errors.length) fail(`worker result rejected:\n- ${errors.join('\n- ')}`, 2);
    out(`worker result ok (${text.length} chars); process its Failures via workflow:error`);
  } else {
    fail('usage: delegate.mjs prepare --task "..." | check --file <result>');
  }
} catch (err) {
  fail(err.message);
}
