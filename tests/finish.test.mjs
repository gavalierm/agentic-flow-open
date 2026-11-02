// P-005, P-006, P-011, P-020, P-036: finish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setup } from './helpers.mjs';

test('unit of work: verification required, logs written, handover free, repeats proposed, log lines cleared by save skill', () => {
  const fx = setup();
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'd1', '--subject', 'Discussion']).status, 0);
    assert.equal(fx.run('save.mjs', ['handover', 'd1', '--task', 'T', '--done', 'x', '--next', 'y']).status, 0);
    let r = fx.run('finish.mjs', ['--procedures', 'deploy-web-docker']);
    assert.equal(r.status, 1); assert.match(r.stderr, /verified/);
    for (let i = 0; i < 3; i++) {
      r = fx.run('finish.mjs', ['--verified', 'saw output', '--procedures', 'deploy-web-docker', '--derivations', 'deploy-flow']);
      assert.equal(r.status, 0, r.out);
    }
    assert.match(r.stdout, /procedure deploy-web-docker 3x: propose a skill/);
    assert.match(r.stdout, /derivation deploy-flow 3x: save the conclusion/);
    assert.equal(fx.read('logs/procedures.log').trim().split('\n').length, 3);
    assert.match(fx.read('topics/d1/handover.md'), /\(voľná\)/);
    assert.equal(JSON.parse(fx.read('topics/d1/topic.json')).state, 'free');
    assert.match(fx.run('finish.mjs', ['--list']).stdout, /procedures: deploy-web-docker 3x/);
    // rejected proposal is not proposed again
    assert.equal(fx.run('save.mjs', ['decision', 'skill pre deploy-web-docker zamietnutý', '--what', 'no skill', '--reason', 'rare', '--relates-to', 'deploy-web-docker']).status, 0);
    r = fx.run('finish.mjs', ['--verified', 'x', '--procedures', 'deploy-web-docker']);
    assert.match(r.stdout, /rejected earlier, no new proposal/);
    // approval: save skill removes the log lines
    r = fx.run('save.mjs', ['skill', 'deploy-web', '--description', 'Použi pri nasadení webu', '--content', 'kroky', '--origin', 'routine', '--from-procedure', 'deploy-web-docker']);
    assert.equal(r.status, 0, r.out);
    assert.equal(fx.read('logs/procedures.log').trim(), '');
    // without a held topic: no hint to claim one (bob 2026-11-01 claimed main just to finish)
    assert.equal(fx.run('topic.mjs', ['release', 'd1']).status, 0);
    // a unit done in a thread without a topic is finished, not bounced back (operator 2026-11-02)
    r = fx.run('finish.mjs', ['--verified', 'x', '--procedures', 'deploy-web-docker']);
    assert.equal(r.status, 0, r.out); assert.match(r.stdout, /unit finished: this thread held no topic/);
    assert.match(fx.read('logs/procedures.log'), /deploy-web-docker/);
    // empty thread (after /clear): finish closes it without --verified
    r = fx.run('finish.mjs', []);
    assert.equal(r.status, 0, r.out); assert.match(r.stdout, /thread closed: no topic and no recorded work/);
    r = fx.run('finish.mjs', ['--verified', 'x', '--topic']);
    assert.equal(r.status, 1); assert.match(r.stderr, /nothing to finish with --topic\. Do not claim a topic/);
  } finally { fx.cleanup(); }
});

test('finish --topic merges the code copy into the main branch, archives the topic, removes the copy', () => {
  const fx = setup();
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'feat', '--subject', 'Feature', '--kind', 'code']).status, 0);
    const copy = path.join(fx.root, 'project-topics', 'feat');
    fs.writeFileSync(path.join(copy, 'feature.txt'), 'feature\n');
    for (const args of [['config', 'user.name', 't'], ['config', 'user.email', 't@t'], ['add', '-A'], ['commit', '-q', '-m', 'feat']]) spawnSync('git', args, { cwd: copy });
    // main moves on in parallel; no conflict
    fs.writeFileSync(path.join(fx.project, 'other.txt'), 'other\n');
    fx.git(fx.project, 'add', '-A'); fx.git(fx.project, 'commit', '-q', '-m', 'other');
    let r = fx.run('finish.mjs', ['--topic']);
    assert.equal(r.status, 1); assert.match(r.stderr, /verified/);
    r = fx.run('finish.mjs', ['--topic', '--verified', 'feature.txt present']);
    assert.equal(r.status, 0, r.out);
    assert.ok(fs.existsSync(path.join(fx.project, 'feature.txt')));
    assert.ok(fs.existsSync(path.join(fx.project, 'other.txt')));
    assert.match(fx.git(fx.project, 'log', '-1', '--format=%s'), /Merge topic\/feat/);
    assert.ok(!fs.existsSync(copy));
    assert.ok(!fx.exists('topics/feat'));
    assert.ok(fx.exists('topics/archive/feat/topic.json'));
    assert.equal(JSON.parse(fx.read('topics/archive/feat/topic.json')).state, 'closed');
    assert.equal(fx.run('topic.mjs', ['list']).stdout.trim(), 'no open topics');
    assert.ok(fx.git(fx.origin, 'ls-tree', '-r', '--name-only', 'main').includes('topics/archive/feat/topic.json'));
  } finally { fx.cleanup(); }
});

test('finish --topic in T3 tells the agent to archive its thread (P-036), outside T3 not', () => {
  const fx = setup();
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'd2', '--subject', 'D2']).status, 0);
    let r = fx.run('finish.mjs', ['--topic', '--verified', 'x'], { env: { T3CODE_THREAD_ID: 'a1' } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /archive this thread \(tool t3_thread_organize, action archive/);
    assert.equal(fx.run('topic.mjs', ['create', 'd3', '--subject', 'D3']).status, 0);
    r = fx.run('finish.mjs', ['--topic', '--verified', 'x']);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.stdout, /t3_thread_organize/);
  } finally { fx.cleanup(); }
});

test('finish --topic is refused in a wake turn and for a non-holder', () => {
  const fx = setup({ second: true });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'd', '--subject', 'D']).status, 0);
    let r = fx.runB('finish.mjs', ['--topic', '--topic-id', 'd', '--verified', 'x']);
    assert.equal(r.status, 1); assert.match(r.stderr, /held by a1/);
    fs.mkdirSync(path.join(fx.brain, 'local', 'threads'), { recursive: true });
    fs.writeFileSync(path.join(fx.brain, 'local', 'threads', 'a1.json'), JSON.stringify({ turn_source: 'wake' }));
    r = fx.run('finish.mjs', ['--topic', '--verified', 'x']);
    assert.equal(r.status, 1); assert.match(r.stderr, /P-047/);
    assert.ok(fx.exists('topics/d/topic.json'));
  } finally { fx.cleanup(); }
});
