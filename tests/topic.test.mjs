// P-036, P-037, P-038, P-047: topics and holder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './helpers.mjs';

test('two clones claim the same topic at once: exactly one wins, loser sees the holder', async () => {
  const fx = setup({ second: true });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'race', '--subject', 'Race', '--no-claim']).status, 0);
    const [a, b] = await Promise.all([fx.runAsync('topic.mjs', ['claim', 'race']), fx.runAsyncB('topic.mjs', ['claim', 'race'])]);
    const winners = [a, b].filter((r) => r.status === 0);
    assert.equal(winners.length, 1, a.out + b.out);
    const loser = a.status === 0 ? b : a;
    assert.match(loser.out, /held by thread (a1|b2)/);
    const holder = JSON.parse(fx.git(fx.origin, 'show', 'main:topics/race/holder.json'));
    assert.ok(['a1', 'b2'].includes(holder.thread));
    assert.equal(holder.mode, 'operator');
  } finally { fx.cleanup(); }
});

test('takeover needs --force and --operator-approved; idle time never takes over', () => {
  const fx = setup({ second: true });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 't1', '--subject', 'T1']).status, 0);
    let r = fx.runB('topic.mjs', ['claim', 't1']);
    assert.equal(r.status, 1); assert.match(r.out, /held by thread a1/);
    // Pilot 2026-11-02: the refusal must not read as permission; a claim instruction is not a takeover instruction.
    assert.match(r.out, /not an instruction to take it over/); assert.match(r.out, /ask \(blocker/);
    r = fx.runB('topic.mjs', ['claim', 't1', '--force']);
    assert.equal(r.status, 1); assert.match(r.out, /operator-approved/);
    r = fx.runB('topic.mjs', ['claim', 't1', '--force', '--operator-approved']);
    assert.equal(r.status, 0, r.out);
    assert.equal(JSON.parse(fx.git(fx.origin, 'show', 'main:topics/t1/holder.json')).thread, 'b2');
    // original holder notices on next write
    r = fx.run('save.mjs', ['handover', 't1', '--task', 'x', '--next', 'y']);
    assert.equal(r.status, 1); assert.match(r.out, /held by thread b2/);
  } finally { fx.cleanup(); }
});

test('claim without a stable thread id and claim in a wake turn are refused; subject and id are validated', () => {
  const fx = setup();
  try {
    const env = { ...fx.env }; delete env.WORKFLOW_THREAD_ID;
    let r = fx.run('topic.mjs', ['create', 'noid', '--subject', 'x'], { env: { WORKFLOW_THREAD_ID: '' } });
    assert.equal(r.status, 1); assert.match(r.out, /stable thread id/);
    r = fx.run('topic.mjs', ['create', 'Bad_ID', '--subject', 'x']);
    assert.equal(r.status, 1); assert.match(r.out, /lowercase/);
    r = fx.run('topic.mjs', ['create', 'nosubj']);
    assert.equal(r.status, 1); assert.match(r.out, /subject/);
    assert.equal(fx.run('topic.mjs', ['create', 'w1', '--subject', 'W', '--no-claim']).status, 0);
    fs.mkdirSync(path.join(fx.brain, 'local', 'threads'), { recursive: true });
    fs.writeFileSync(path.join(fx.brain, 'local', 'threads', 'a1.json'), JSON.stringify({ thread: 'a1', turn_source: 'wake' }));
    r = fx.run('topic.mjs', ['claim', 'w1']);
    assert.equal(r.status, 1); assert.match(r.out, /P-047/);
  } finally { fx.cleanup(); }
});

test('code topic gets a separate clone next to the project on branch topic/<id>; list shows one line per topic', () => {
  const fx = setup();
  try {
    const r = fx.run('topic.mjs', ['create', 'feat', '--subject', 'Feature', '--kind', 'code']);
    assert.equal(r.status, 0, r.out);
    const copy = path.join(fx.root, 'project-topics', 'feat');
    assert.ok(fs.existsSync(path.join(copy, '.git')));
    assert.ok(fs.statSync(path.join(copy, '.git')).isDirectory(), 'separate clone, not a worktree');
    assert.equal(fx.git(copy, 'rev-parse', '--abbrev-ref', 'HEAD'), 'topic/feat');
    const list = fx.run('topic.mjs', ['list']);
    assert.equal(list.stdout.trim().split('\n').length, 1);
    assert.match(list.stdout, /^feat \(working, a1\)/);
  } finally { fx.cleanup(); }
});

test('holder changes its own mode with claim --mode; same mode is a no-op', () => {
  const fx = setup();
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'm1', '--subject', 'Mode']).status, 0);
    assert.equal(JSON.parse(fx.read('topics/m1/holder.json')).mode, 'operator');
    const r = fx.run('topic.mjs', ['claim', 'm1', '--mode', 'auto']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /topic m1 mode auto/);
    assert.equal(JSON.parse(fx.read('topics/m1/holder.json')).mode, 'auto');
    assert.match(fx.run('topic.mjs', ['claim', 'm1', '--mode', 'auto']).stdout, /already held/);
  } finally { fx.cleanup(); }
});

test('several threads on one brain clone create and claim topics at once: every write lands, no git lock error', async () => {
  const fx = setup();
  try {
    const ids = ['t1', 't2', 't3', 't4'];
    const res = await Promise.all(ids.map((id, i) => fx.runAsync('topic.mjs', ['create', id, '--subject', id, '--mode', 'auto'], { env: { WORKFLOW_THREAD_ID: `th${i}` } })));
    res.forEach((r, i) => assert.equal(r.status, 0, `${ids[i]}: ${r.stderr}`));
    for (const [i, id] of ids.entries()) {
      const h = JSON.parse(fx.read(`topics/${id}/holder.json`));
      assert.equal(h.thread, `th${i}`);
      assert.equal(h.mode, 'auto');
    }
    assert.equal(fx.git(fx.brain, 'status', '--porcelain', '--', 'topics'), '', 'nothing left uncommitted');
    const log = fx.git(fx.brain, 'log', '--format=%s');
    for (const id of ids) assert.match(log, new RegExp(`topic claim ${id} by`));
    assert.ok(!fs.existsSync(path.join(fx.brain, '.git', 'workflow-write.lock')));
  } finally { fx.cleanup(); }
});
