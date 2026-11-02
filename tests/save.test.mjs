// P-013, P-007, P-031, P-009, P-008, P-032, P-035: save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './helpers.mjs';
import { parseFrontmatter } from '../scripts/frontmatter.mjs';

test('memory: fixed format with key/origin; same subject overwrites; similar key refused unless --new', () => {
  const fx = setup();
  try {
    let r = fx.run('save.mjs', ['memory', 'operator', 'operator', '--content', 'name: Anna', '--aliases', 'me']);
    assert.equal(r.status, 0, r.out);
    let rec = parseFrontmatter(fx.read('memory/operator-operator.md'));
    assert.equal(rec.data.key, 'operator-operator'); assert.equal(rec.data.origin, 'operator'); assert.deepEqual(rec.data.aliases, ['me']);
    assert.equal(rec.body.trim(), 'name: Anna');
    r = fx.run('save.mjs', ['memory', 'operator', 'operator', '--content', 'name: Beta']);
    assert.equal(r.status, 0, r.out);
    rec = parseFrontmatter(fx.read('memory/operator-operator.md'));
    assert.equal(rec.body.trim(), 'name: Beta');
    assert.deepEqual(rec.data.aliases, ['me'], 'aliases kept');
    assert.equal(fs.readdirSync(path.join(fx.brain, 'memory')).filter((f) => f.endsWith('.md')).length, 1, 'one record per subject');
    // alias hit -> overwrite the same file
    assert.equal(fx.run('save.mjs', ['memory', 'operator', 'me', '--content', 'name: Gamma']).status, 0);
    assert.equal(fs.readdirSync(path.join(fx.brain, 'memory')).filter((f) => f.endsWith('.md')).length, 1);
    // similar key
    assert.equal(fx.run('save.mjs', ['memory', 'service', 'x service', '--content', 'tokens', '--aliases', 'xs']).status, 0);
    r = fx.run('save.mjs', ['memory', 'service', 'x-service-staging', '--content', 'staging']);
    assert.equal(r.status, 1); assert.match(r.stderr, /similar key exists.*service-x-service/);
    r = fx.run('save.mjs', ['memory', 'service', 'x-service-staging', '--content', 'staging', '--new']);
    assert.equal(r.status, 0, r.out);
    // derived needs sources; diacritics normalized in key
    r = fx.run('save.mjs', ['memory', 'service', 'Pošta', '--content', 'x', '--origin', 'derived']);
    assert.equal(r.status, 1); assert.match(r.stderr, /sources/);
    r = fx.run('save.mjs', ['memory', 'service', 'Pošta', '--content', 'x', '--origin', 'derived', '--sources', 'README.md']);
    assert.equal(r.status, 0, r.out);
    assert.ok(fx.exists('memory/service-posta.md'));
    assert.match(fx.read('memory/service-posta.md'), /fingerprint: [0-9a-f]{12}/);
    assert.match(fx.git(fx.brain, 'log', '-1', '--format=%s'), /^\[brain-script\] save memory service-posta/);
  } finally { fx.cleanup(); }
});

test('decision gets a sequential ID, needs relates_to, supersedes marks the old one', () => {
  const fx = setup();
  try {
    let r = fx.run('save.mjs', ['decision', 'Library A', '--what', 'A', '--alternatives', 'B', '--reason', 'B lacks X']);
    assert.equal(r.status, 1); assert.match(r.stderr, /relates-to/);
    r = fx.run('save.mjs', ['decision', 'Library A', '--what', 'A', '--alternatives', 'B', '--reason', 'B lacks X', '--relates-to', 'src/app.js']);
    assert.equal(r.status, 0, r.out); assert.match(r.stdout, /decision D-0001/);
    r = fx.run('save.mjs', ['decision', 'Library C', '--what', 'C', '--reason', 'faster', '--relates-to', 'src/app.js', '--supersedes', 'D-0001']);
    assert.equal(r.status, 0, r.out); assert.match(r.stdout, /D-0002/);
    const old = parseFrontmatter(fx.read('decisions/d-0001-library-a.md'));
    assert.equal(old.data.status, 'superseded-by D-0002');
    assert.match(fx.run('find.mjs', ['--relates-to', 'src/app.js']).stdout, /d-0002-library-c/);
  } finally { fx.cleanup(); }
});

test('skill: new agentic skill carries origin; second save extends it; operator skill is not edited; workflow name refused', () => {
  const fx = setup();
  try {
    let r = fx.run('save.mjs', ['skill', 'x-api', '--description', 'Použi, keď voláš X API', '--content', 'hlavička X\nnie bez hlavičky, lebo 401', '--origin', 'error']);
    assert.equal(r.status, 0, r.out);
    const s = parseFrontmatter(fx.read('skills/agentic/x-api/SKILL.md'));
    assert.equal(s.data.origin, 'error'); assert.equal(s.data.name, 'x-api');
    r = fx.run('save.mjs', ['skill', 'x-api', '--content', 'timeout 10 s', '--origin', 'error']);
    assert.equal(r.status, 0, r.out); assert.match(r.stdout, /extended existing skill/);
    assert.match(fx.read('skills/agentic/x-api/SKILL.md'), /## Doplnenie .*\ntimeout 10 s/);
    assert.equal(fs.readdirSync(path.join(fx.brain, 'skills', 'agentic')).filter((d) => d !== '.gitkeep').length, 1);
    fs.mkdirSync(path.join(fx.brain, 'skills', 'operator', 'release'), { recursive: true });
    fs.writeFileSync(path.join(fx.brain, 'skills', 'operator', 'release', 'SKILL.md'), '---\nname: release\ndescription: x\n---\nx\n');
    r = fx.run('save.mjs', ['skill', 'release', '--content', 'y', '--origin', 'error']);
    assert.equal(r.status, 1); assert.match(r.stderr, /belongs to the operator/);
    r = fx.run('save.mjs', ['skill', 'save', '--description', 'x', '--content', 'y']);
    assert.equal(r.status, 1); assert.match(r.stderr, /workflow skill name/);
  } finally { fx.cleanup(); }
});

test('exception: immutable refused, written per layer; rule saved; handover only by holder and within 15 lines', () => {
  const fx = setup();
  try {
    let r = fx.run('save.mjs', ['exception', 'P-001', '--wording', 'x', '--reason', 'y']);
    assert.equal(r.status, 1); assert.match(r.stderr, /immutable/);
    r = fx.run('save.mjs', ['exception', 'P-034', '--wording', 'bash allowed here', '--reason', 'legacy', '--layer', 'machine', '--machine', 'Box One']);
    assert.equal(r.status, 0, r.out);
    assert.match(fx.read('exceptions/machine-box-one.md'), /### P-034\nZnenie: bash allowed here\nDôvod: legacy/);
    r = fx.run('save.mjs', ['rule', 'tests', '--content', 'Každá zmena v src/ MUSÍ mať test.']);
    assert.equal(r.status, 0, r.out); assert.match(fx.read('rules/tests.md'), /key: rule-tests/);
    // Overlapping rules: move the boundary into one rule, never a rule with precedence over another (operator 2026-11-02).
    r = fx.run('save.mjs', ['rule', 'override', '--content', 'Diery oprav hneď. Má prednosť pred sensitive-approval.']);
    assert.notEqual(r.status, 0); assert.match(r.out, /move the boundary into one rule/);
    // P-022: a rule that pushes the assembled rules over the limit tells the agent to condense them itself.
    r = fx.run('save.mjs', ['rule', 'long', '--content', 'x'.repeat(11000)]);
    assert.equal(r.status, 0, r.out); assert.match(r.stdout, /limit: rules \d+ chars > 10000: condense your project rules after the current unit of work \(skill workflow:consolidate; mandated by the workflow, not out of scope, P-002\)/);
    const rep = fx.run('consolidate.mjs', ['report']);
    assert.match(rep.stdout, /^rules: \d+ chars, \d+ lines; project rules .*: long 11\d\d\d, tests \d+$/m, rep.out);
    assert.equal(fx.run('save.mjs', ['rule', 'long', '--remove', '--reason', 'test']).status, 0);
    r = fx.run('save.mjs', ['rule', 'tests', '--remove']);
    assert.equal(r.status, 1); assert.match(r.stderr, /needs --reason/);
    // P-007: steps or commands are a procedure; save refuses them as a rule and points to a skill (Bob 2026-11-02).
    r = fx.run('save.mjs', ['rule', 'deploy', '--content', 'Služby drž aktuálne:\n1. stiahni vydanie\n2. reštartuj službu']);
    assert.equal(r.status, 1); assert.match(r.stderr, /reads as a procedure \(2 step lines\).*save\.mjs skill/);
    r = fx.run('save.mjs', ['rule', 'deploy', '--content', 'Po vydaní spusti `git pull --ff-only` v klone.']);
    assert.equal(r.status, 1); assert.match(r.stderr, /reads as a procedure \(command `git pull/);
    assert.ok(!fx.exists('rules/deploy.md'));
    r = fx.run('save.mjs', ['rule', 'gate', '--content', 'Zmenu služby MUSÍŠ nasadiť cez skill `aktualizacia-sluzieb`; do `~/.claude/` NESMIEŠ zapisovať.']);
    assert.equal(r.status, 0, r.out); assert.match(r.stdout, /rule check \(P-007\).*is a skill/);
    r = fx.run('save.mjs', ['rule', 'nope', '--remove', '--reason', 'x']);
    assert.equal(r.status, 1); assert.match(r.stderr, /does not exist/);
    r = fx.run('save.mjs', ['rule', 'tests', '--remove', '--reason', 'superseded by P-058']);
    assert.equal(r.status, 0, r.out); assert.equal(fx.exists('rules/tests.md'), false);
    assert.equal(fx.run('topic.mjs', ['create', 'w', '--subject', 'W']).status, 0);
    r = fx.run('save.mjs', ['handover', 'w', '--task', 'Task', '--done', 'a; b', '--next', 'c', '--files', 'f1; f2', '--questions', 'q1']);
    assert.equal(r.status, 0, r.out);
    assert.match(fx.read('topics/w/handover.md'), /## Hotové\n- a\n- b\n## Ďalší krok\nc/);
    r = fx.run('save.mjs', ['handover', 'w', '--task', 'Task', '--done', Array.from({ length: 12 }, (_, i) => `d${i}`).join('; '), '--next', 'c']);
    assert.equal(r.status, 1); assert.match(r.stderr, /limit 15/);
    r = fx.run('save.mjs', ['handover', 'w', '--task', 'T', '--next', 'c'], { env: { WORKFLOW_THREAD_ID: 'zz' } });
    assert.equal(r.status, 1); assert.match(r.stderr, /held by thread a1/);
  } finally { fx.cleanup(); }
});

test('skill --script: the script is stored next to SKILL.md in one brain commit; bad names refused', () => {
  const fx = setup();
  try {
    const src = path.join(fx.root, 'release.mjs');
    fs.writeFileSync(src, '#!/usr/bin/env node\nconsole.log("ok");\n');
    let r = fx.run('save.mjs', ['skill', 'release-x', '--description', 'Použi, keď vydávaš', '--content', 'node <skill>/release.mjs', '--origin', 'routine', '--script', src]);
    assert.equal(r.status, 0, r.out);
    assert.equal(fx.read('skills/agentic/release-x/release.mjs'), fs.readFileSync(src, 'utf8'));
    assert.match(r.out, /script runs as: node \/.+\/\.claude\/skills\/release-x\/release\.mjs/);
    fs.writeFileSync(src, '#!/usr/bin/env node\nconsole.log("v2");\n');
    r = fx.run('save.mjs', ['skill', 'release-x', '--content', 'v2', '--origin', 'routine', '--script', src]);
    assert.equal(r.status, 0, r.out);
    assert.match(fx.read('skills/agentic/release-x/release.mjs'), /v2/);
    const bad = path.join(fx.root, 'Bad Name.py');
    fs.writeFileSync(bad, 'x');
    r = fx.run('save.mjs', ['skill', 'release-x', '--content', 'y', '--origin', 'routine', '--script', bad]);
    assert.equal(r.status, 1); assert.match(r.stderr, /--script/);
  } finally { fx.cleanup(); }
});

test('skill --replace: the body is replaced by the corrected steps; without it the content is appended', () => {
  const fx = setup();
  try {
    let r = fx.run('save.mjs', ['skill', 'fix-x', '--description', 'Použi, keď opravuješ', '--content', 'old step', '--origin', 'error']);
    assert.equal(r.status, 0, r.out);
    r = fx.run('save.mjs', ['skill', 'fix-x', '--content', 'extra', '--origin', 'error']);
    assert.match(fx.read('skills/agentic/fix-x/SKILL.md'), /old step[\s\S]*## Doplnenie [\d-]+\nextra/);
    // the whole skill sent as an addition is refused instead of duplicated under "## Doplnenie"
    r = fx.run('save.mjs', ['skill', 'fix-x', '--content', 'old step\nextra\nnew step', '--origin', 'error']);
    assert.equal(r.status, 1); assert.match(r.stderr, /repeats the body.*--replace/);
    assert.equal(fx.read('skills/agentic/fix-x/SKILL.md').match(/old step/g).length, 1);
    r = fx.run('save.mjs', ['skill', 'fix-x', '--content', 'new step', '--origin', 'error', '--replace']);
    assert.equal(r.status, 0, r.out);
    const text = fx.read('skills/agentic/fix-x/SKILL.md');
    assert.match(text, /\nnew step\n$/);
    assert.doesNotMatch(text, /old step|Doplnenie/);
    assert.match(text, /description: Použi, keď opravuješ|description: "Použi, keď opravuješ"/);
    // --sed: in-place edit of the body; description and origin kept; no match changes nothing (Bob 2026-11-02).
    r = fx.run('save.mjs', ['skill', 'fix-x', '--sed', 's/new (step)/fixed $1\\nsecond/']);
    assert.equal(r.status, 0, r.out); assert.match(r.stdout, /edited existing skill fix-x/);
    const edited = fx.read('skills/agentic/fix-x/SKILL.md');
    assert.match(edited, /\nfixed step\nsecond\n$/);
    assert.match(edited, /origin: error/); assert.match(edited, /Použi, keď opravuješ/);
    r = fx.run('save.mjs', ['skill', 'fix-x', '--sed', 's/absent/x/']);
    assert.equal(r.status, 1); assert.match(r.stderr, /pattern not found/);
    r = fx.run('save.mjs', ['skill', 'fix-x', '--sed', 's|fixed|a\\|b|', '--replace']);
    assert.equal(r.status, 1); assert.match(r.stderr, /do not combine/);
    assert.equal(fx.run('save.mjs', ['skill', 'fix-x', '--sed', 's|fixed|a\\|b|']).status, 0);
    assert.match(fx.read('skills/agentic/fix-x/SKILL.md'), /\na\|b step\n/);
    r = fx.run('save.mjs', ['skill', 'nope-x', '--sed', 's/a/b/']);
    assert.equal(r.status, 1); assert.match(r.stderr, /does not exist/);
  } finally { fx.cleanup(); }
});
