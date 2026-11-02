// P-040, P-037, P-025: brain writer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, memoryRecord } from './helpers.mjs';

test('write commits with the script tag and pushes to origin', () => {
  const fx = setup();
  try {
    const r = fx.run('brain.mjs', ['write', 'memory/operator-operator.md', '--message', 'test write', '--content', memoryRecord('operator-operator', 'name: X')]);
    assert.equal(r.status, 0, r.out);
    assert.match(fx.git(fx.brain, 'log', '-1', '--format=%s'), /^\[brain-script\] test write$/);
    assert.match(fx.git(fx.origin, 'log', '-1', '--format=%s'), /^\[brain-script\] test write$/);
    assert.doesNotMatch(r.stdout, /unpushed/);
  } finally { fx.cleanup(); }
});

test('same file changed on both sides is a disagreement: not merged, reported', () => {
  const fx = setup({ second: true });
  try {
    assert.equal(fx.run('brain.mjs', ['write', 'memory/service-x.md', '--message', 'a', '--content', memoryRecord('service-x', 'from A')]).status, 0);
    const r = fx.runB('brain.mjs', ['write', 'memory/service-x.md', '--message', 'b', '--content', memoryRecord('service-x', 'from B')]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /conflict: memory\/service-x\.md/);
    assert.match(r.stdout, /unpushed: 1/);
    assert.match(fx.git(fx.origin, 'show', 'main:memory/service-x.md'), /from A/);
  } finally { fx.cleanup(); }
});

test('logs/*.log changed on both sides merge by union', () => {
  const fx = setup({ second: true });
  try {
    assert.equal(fx.run('brain.mjs', ['write', 'logs/sequences.log', '--message', 'a', '--content', '2026-01-01 git-fetch+npm-test s1\n']).status, 0);
    const r = fx.runB('brain.mjs', ['write', 'logs/sequences.log', '--message', 'b', '--content', '2026-01-02 npm-test+git-push s2\n']);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.stdout, /conflict/);
    const merged = fx.git(fx.origin, 'show', 'main:logs/sequences.log');
    assert.match(merged, /git-fetch\+npm-test/);
    assert.match(merged, /npm-test\+git-push/);
  } finally { fx.cleanup(); }
});

test('write into a topic by a thread that is not the holder is refused', () => {
  const fx = setup({ second: true });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 't1', '--subject', 'Test topic']).status, 0);
    const r = fx.runB('brain.mjs', ['write', 'topics/t1/handover.md', '--message', 'x', '--content', '## Zadanie\nx\n## Hotové\n-\n## Ďalší krok\n-\n## Súbory\n-\n## Otvorené otázky\n-\n']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /held by thread a1/);
  } finally { fx.cleanup(); }
});

test('write in a subagent is refused', () => {
  const fx = setup();
  try {
    const r = fx.run('brain.mjs', ['write', 'memory/operator-operator.md', '--message', 'x', '--content', memoryRecord('operator-operator')], { env: { WORKFLOW_AGENT_ID: 'sub1' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /subagent/);
  } finally { fx.cleanup(); }
});

test('record with a diacritic key or a file in local/ is refused', () => {
  const fx = setup();
  try {
    const r = fx.run('brain.mjs', ['write', 'memory/sluzba-x.md', '--message', 'x', '--content', '---\nkey: služba-x\norigin: operator\n---\nx\n']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /diacritics/);
    const r2 = fx.run('brain.mjs', ['write', 'local/index/memory.md', '--message', 'x', '--content', 'x']);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /local\//);
  } finally { fx.cleanup(); }
});

test('git in brain runs with the root of the running plugin, so brain hooks check with the same channel (P-048)', async () => {
  const { brainScriptEnv, BRAIN_SCRIPT_ENV } = await import('../scripts/config.mjs');
  const { PLUGIN_ROOT } = await import('../scripts/util.mjs');
  assert.deepEqual(brainScriptEnv(), { [BRAIN_SCRIPT_ENV]: '1', WORKFLOW_PLUGIN_ROOT: PLUGIN_ROOT });
});
