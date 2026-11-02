// P-021, P-023 e, P-041, P-044: status line with mail count from the comms client, mail line (ID and category) only at n > 0 and once
// per change, 60 s cache, outage reported once and no retry before 60 s. Needs agentic-comms next to the plugin (else skipped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, startComms, commsClient } from './helpers.mjs';

const skip = commsClient() ? false : 'agentic-comms not found next to the plugin (AGENTIC_COMMS_DIR)';

test('status line counts mail of the held topic, lists mail IDs once per change, counts live, reports an outage once', { skip }, async () => {
  const fx = setup();
  const comms = await startComms(fx, { senders: ['alice', 'bob'] });
  try {
    const state = () => JSON.parse(fs.readFileSync(path.join(fx.brain, 'local', 'threads', 'a1.json'), 'utf8'));
    assert.match(fx.run('comms.mjs', ['status']).stdout, /comms: enabled[\s\S]*service: ok/);

    // Claim registers the topic in the mail service with the holder.
    const create = fx.run('topic.mjs', ['create', 'alpha', '--subject', 'Alpha work']);
    assert.equal(create.status, 0, create.out);
    assert.equal(comms.topic('project', 'alpha')?.holder, 'a1');

    let r = fx.hook('user-prompt-submit.mjs', { prompt: 'ahoj' });
    assert.equal(r.context, 'thread a1 | topic alpha (working, mode operator) | mail: 0');

    // A message arrives; the next prompt sees it at once (pilot 2026-11-02: a cached 0 hid the mail of a bell turn).
    const sent = comms.cli(['send', '--project', 'project', '--topic', 'alpha', '--level', 'assist', '--text', 'fyi: schema changed'], 'bob');
    assert.equal(sent.code, 0, sent.out);
    r = fx.hook('user-prompt-submit.mjs', { prompt: 'ďalej' });
    const lines = r.context.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0], 'thread a1 | topic alpha (working, mode operator) | mail: 1');
    assert.match(lines[1], /^mail: 1 waiting: \S+ assist$/);
    assert.doesNotMatch(r.context, /schema changed/, 'never the text');
    assert.equal(state().mail_signaled, 1);

    // Same count: neither the line nor the instruction repeats (P-023 c, e).
    r = fx.hook('user-prompt-submit.mjs', { prompt: 'pokračuj' });
    assert.equal(r.context, '');

    // Blocker arrives: count changes, instruction again, blocker shown in the status line.
    assert.equal(comms.cli(['send', '--project', 'project', '--topic', 'alpha', '--level', 'blocker', '--text', 'cannot continue'], 'bob').code, 0);
    comms.expireCache(fx.brain);
    r = fx.hook('user-prompt-submit.mjs', { prompt: 'pokračuj' });
    assert.equal(r.context.split('\n')[0], 'thread a1 | topic alpha (working, mode operator) | mail: 2 (1 blocker)');
    assert.match(r.context.split('\n')[1], /^mail: 2 waiting: \S+ (assist|blocker), \S+ (assist|blocker)$/);

    // Session start carries the same line and the instruction as part of item 3.
    const boot = fx.hook('session-start.mjs', { source: 'resume' });
    assert.match(boot.context, /\nthread a1 \| topic alpha \(working, mode operator\) \| mail: 2 \(1 blocker\)\nmail: 2 waiting: \S+ (assist|blocker), \S+ (assist|blocker)/);

    // Wake turn: the wake line already lists the mail; nothing else is added.
    r = fx.hook('user-prompt-submit.mjs', { prompt: 'you have mail in topic alpha' });
    assert.equal(r.context.split('\n').length, 2);
    assert.match(r.context.split('\n')[1], /^turn started by a message \(wake\): mail: 2 waiting: .*; read a body with comms receive --id <id>; .*\(P-047\)$/);

    // Outage: last known count stays, "comms unavailable" once, no new attempt before 60 s, turn not slowed.
    await comms.stop();
    comms.expireCache(fx.brain);
    let t = Date.now();
    r = fx.hook('user-prompt-submit.mjs', { prompt: 'pokračuj' });
    assert.ok(Date.now() - t < 2500, 'hook within the 2 s budget');
    assert.equal(r.context.split('\n')[0], 'thread a1 | topic alpha (working, mode operator) | mail: 2 (1 blocker) (comms unavailable)');
    const cacheFile = path.join(fx.brain, 'local', 'comms', 'count-cache.json');
    const failedAt = Object.values(JSON.parse(fs.readFileSync(cacheFile, 'utf8')))[0].failed_at;
    assert.ok(failedAt);
    t = Date.now();
    r = fx.hook('user-prompt-submit.mjs', { prompt: 'pokračuj' });
    assert.ok(Date.now() - t < 1500);
    assert.equal(r.context, 'thread a1 | topic alpha (working, mode operator) | mail: 2 (1 blocker)', 'reported once, served from cache');
    assert.equal(Object.values(JSON.parse(fs.readFileSync(cacheFile, 'utf8')))[0].failed_at, failedAt, 'no retry before 60 s');
  } finally {
    await comms.stop();
    fx.cleanup();
  }
});
