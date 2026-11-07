// alice 2026-11-02: done --topic closes the topic in the mail service (new mail 410, waiting mail bounces to the sender);
// a thread that also holds main is not archived; archived topics from before are closed at the next session start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, startComms, commsClient } from './helpers.mjs';

const skip = commsClient() ? false : 'agentic-comms not found next to the plugin (AGENTIC_COMMS_DIR)';

test('done --topic closes the topic in the mail: waiting mail bounces, new mail is refused at once with the closing time', { skip }, async () => {
  const fx = setup({ second: true });
  const comms = await startComms(fx, { senders: ['alice', 'bob'], brains: [[fx.project, fx.brain, 'alice'], [fx.projectB, fx.brainB, 'bob']] });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'gamma', '--subject', 'Gamma']).status, 0);
    assert.equal(fx.runB('topic.mjs', ['create', 'beta', '--subject', 'Beta']).status, 0);
    const send = fx.runB('comms.mjs', ['send', '--level', 'assist', '--to', 'project/gamma', '--text', 'units?']);
    assert.equal(send.status, 0, send.out);
    const id = /sent (\S+) \(assist\)/.exec(send.stdout)?.[1];
    // The closing thread also holds main: the topic is closed, the thread is not archived (P-045).
    const main = path.join(fx.brain, 'topics', 'main');
    fs.mkdirSync(main, { recursive: true });
    fs.writeFileSync(path.join(main, 'topic.json'), JSON.stringify({ id: 'main', subject: 'Main', kind: 'main', state: 'working' }) + '\n');
    fs.writeFileSync(path.join(main, 'holder.json'), JSON.stringify({ thread: 'a1', mode: 'operator' }) + '\n');
    fx.git(fx.brain, 'add', '-A'); fx.git(fx.brain, 'commit', '-q', '--no-verify', '-m', 'main held by a1 (test)');
    const fin = fx.run('done.mjs', ['--topic', '--topic-id', 'gamma', '--verified', 'done'], { env: { T3CODE_THREAD_ID: 'a1' } });
    assert.equal(fin.status, 0, fin.out);
    assert.match(fin.stdout, /mail: topic gamma closed in the mail service/);
    assert.match(fin.stdout, /holds the persona main topic, so it stays open: do not archive it/);
    assert.doesNotMatch(fin.stdout, /t3_thread_organize/);
    assert.equal(comms.topic('project', 'gamma').state, 'closed');
    assert.equal(comms.topic('project', 'gamma').holder, null);
    assert.equal(JSON.parse(comms.cli(['message', '--id', id]).out).outcome, 'undelivered');
    const late = fx.runB('comms.mjs', ['send', '--level', 'blocker', '--to', 'project/gamma', '--text', 'still?']);
    assert.notEqual(late.status, 0, late.out);
    assert.match(late.out, /uzavretá/);

    // A topic archived before the mail knew `close`: the next session start closes it once.
    assert.equal(fx.run('topic.mjs', ['create', 'delta', '--subject', 'Delta']).status, 0);
    const arch = path.join(fx.brain, 'topics', 'archive', 'delta');
    fs.mkdirSync(path.dirname(arch), { recursive: true });
    fs.renameSync(path.join(fx.brain, 'topics', 'delta'), arch);
    assert.equal(comms.topic('project', 'delta').state ?? 'open', 'open');
    fx.hook('session-start.mjs', { source: 'startup' });
    assert.equal(comms.topic('project', 'delta').state, 'closed');
    assert.ok(JSON.parse(fs.readFileSync(path.join(fx.brain, 'local', 'comms-closed.json'), 'utf8')).includes('delta'));
  } finally {
    await comms.stop();
    fx.cleanup();
  }
});
