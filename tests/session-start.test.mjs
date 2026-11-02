// P-021, P-022, P-024, P-026, P-017: SessionStart hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, initProject, cleanEnv } from './helpers.mjs';
import { BOOT_MARKERS } from '../scripts/boot.mjs';

function headings(text) {
  return text.split('\n').filter((l) => l.startsWith('## '));
}

test('startup: items 1, 3-7 in order, nothing else, under 15 000 chars, version line present', () => {
  const fx = setup();
  try {
    const r = fx.hook('session-start.mjs', { source: 'startup' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(headings(r.context), BOOT_MARKERS);
    assert.ok(r.context.length <= 15000);
    assert.doesNotMatch(r.context, /limit: boot context/);
    assert.match(r.context, /\nthread a1 \| topic - \(none\) \| mail: 0\n/);
    assert.match(r.context, /\nworkflow [0-9a-f]{7,}/);
    assert.match(r.context, /### P-001/);
    assert.match(r.context, /Výnimky: žiadne/);
  } finally { fx.cleanup(); }
});

test('resume and clear keep the same thread id; compact adds the handover of the held topic', () => {
  const fx = setup();
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'work', '--subject', 'Work']).status, 0);
    assert.equal(fx.run('save.mjs', ['handover', 'work', '--task', 'Do the thing', '--done', 'step 1', '--next', 'step 2', '--files', 'src/app.js', '--questions', '']).status, 0);
    for (const source of ['resume', 'clear']) {
      const r = fx.hook('session-start.mjs', { source });
      assert.match(r.context, /thread a1 \| topic work \(working, mode operator\) \| mail: 0/, source);
      assert.doesNotMatch(r.context, /Handover \(primárny podklad/);
    }
    // T3 cannot resume a thread after /clear: the warning appears only for clear inside T3
    assert.match(fx.hook('session-start.mjs', { source: 'clear' }, { env: { T3CODE_THREAD_ID: 'a1' } }).context, /T3 \/clear: .*nové vlákno|T3 \/clear: .*novom vlákne/);
    assert.doesNotMatch(fx.hook('session-start.mjs', { source: 'clear' }).context, /T3 \/clear/);
    assert.doesNotMatch(fx.hook('session-start.mjs', { source: 'resume' }, { env: { T3CODE_THREAD_ID: 'a1' } }).context, /T3 \/clear/);
    const c = fx.hook('session-start.mjs', { source: 'compact' });
    assert.match(c.context, /Handover \(primárny podklad, P-026\):\n### Zadanie\nDo the thing/);
    assert.match(c.context, /open: work \(working, a1, next: step 2\)/);
    assert.deepEqual(headings(c.context), BOOT_MARKERS);
  } finally { fx.cleanup(); }
});

test('missing brain: one notice line proposing brain-init, nothing created', () => {
  const fx = setup();
  try {
    const lonely = path.join(fx.root, 'lonely');
    initProject(lonely, { brainRel: '../no-brain' });
    const r = fx.hook('session-start.mjs', { source: 'startup' }, { cwd: lonely });
    assert.deepEqual(headings(r.context), BOOT_MARKERS);
    assert.match(r.context, /brain not found at \.\.\/no-brain; propose: node <plugin>\/bin\/brain-init\.mjs \.\.\/no-brain/);
    assert.ok(!fs.existsSync(path.join(fx.root, 'no-brain')));
    assert.match(r.context, /thread a1 \| topic - \(none\) \| mail: 0/);
  } finally { fx.cleanup(); }
});

test('brain skills are copied into <project>/.claude/skills/ (no symlinks) and the folder is gitignored', () => {
  const fx = setup();
  try {
    const skill = path.join(fx.brain, 'skills', 'operator', 'release');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: release\ndescription: Použi pri release\n---\nkroky\n');
    fx.hook('session-start.mjs', { source: 'startup' });
    const copied = path.join(fx.project, '.claude', 'skills', 'release', 'SKILL.md');
    assert.ok(fs.existsSync(copied));
    assert.ok(!fs.lstatSync(path.join(fx.project, '.claude', 'skills', 'release')).isSymbolicLink());
    assert.match(fs.readFileSync(path.join(fx.project, '.gitignore'), 'utf8'), /^\.claude\/skills\/$/m);
    // removed in brain -> removed in project at next start
    fs.rmSync(skill, { recursive: true });
    fx.hook('session-start.mjs', { source: 'startup' });
    assert.ok(!fs.existsSync(copied));
  } finally { fx.cleanup(); }
});

test('oversized rules are reported at start and never trimmed', () => {
  const fx = setup();
  try {
    fs.writeFileSync(path.join(fx.brain, 'policy.json'), JSON.stringify({ limits: { rules_chars: 500, boot_context_chars: 1000 } }));
    const r = fx.hook('session-start.mjs', { source: 'startup' });
    assert.match(r.context, /limit: rules \d+ chars > 500/);
    assert.match(r.context, /limit: boot context \d+ chars > 1000; nothing was trimmed/);
    assert.match(r.context, /### P-047/);
  } finally { fx.cleanup(); }
});

test('P-050: first reply starts with the structured status block; free topics offered, held ones not', () => {
  const fx = setup();
  const block = (ctx) => (/MUST start with exactly the next \d+ lines[^\n]*\n([\s\S]*?)\n\(end of status block\)/.exec(ctx) || [])[1];
  try {
    const r = fx.hook('session-start.mjs', { source: 'startup' });
    assert.equal(r.json.systemMessage, undefined);
    assert.match(r.context, /first reply in this session MUST start with exactly the next \d+ lines, verbatim, before anything else \(no tags, no code fence\)/);
    assert.equal(block(r.context), 'Téma: žiadna\n\nDostupné témy:\n- žiadne\n\nAká bude téma?');
    // The question only for an unknown topic: a prompt that names the topic is claimed and answered with `Téma: <id>` (operator 2026-11-02).
    assert.match(r.context, /only for a topic that stays unknown[^\n]*start that reply instead with `Téma: <id>`/);
    assert.equal(fx.run('topic.mjs', ['create', 'work', '--subject', 'Work']).status, 0);
    const held = fx.hook('session-start.mjs', { source: 'startup' }).context;
    assert.equal(block(held), 'Téma: work');
    assert.doesNotMatch(held, /stays unknown/, 'held topic: no question, no alternative');
    const other = fx.hook('session-start.mjs', { source: 'startup' }, { env: { WORKFLOW_THREAD_ID: 'b2' } });
    assert.match(block(other.context), /- žiadne/, 'topic held by another thread is not offered');
    assert.equal(fx.run('topic.mjs', ['release', 'work']).status, 0);
    const freed = fx.hook('session-start.mjs', { source: 'startup' }, { env: { WORKFLOW_THREAD_ID: 'b2' } });
    assert.equal(block(freed.context), 'Téma: žiadna\n\nDostupné témy:\n- work – Work\n\nAká bude téma?');
    assert.doesNotMatch(fx.hook('user-prompt-submit.mjs', { prompt: 'hi' }).context, /status block/, 'only at start');
  } finally { fx.cleanup(); }
});

test('session start exports WORKFLOW_PROJECT_DIR into CLAUDE_ENV_FILE once, so scripts work from any cwd', () => {
  const fx = setup();
  try {
    const envFile = path.join(fx.root, 'claude-env.sh');
    fx.hook('session-start.mjs', { source: 'startup' }, { env: { CLAUDE_ENV_FILE: envFile } });
    fx.hook('session-start.mjs', { source: 'clear' }, { env: { CLAUDE_ENV_FILE: envFile } });
    const lines = fs.readFileSync(envFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^export WORKFLOW_PROJECT_DIR="/);
    const dir = JSON.parse(lines[0].slice('export WORKFLOW_PROJECT_DIR='.length));
    const r = fx.run('topic.mjs', ['list'], { cwd: fx.root, env: { WORKFLOW_PROJECT_DIR: dir } });
    assert.equal(r.status, 0, r.stderr);
  } finally { fx.cleanup(); }
});
