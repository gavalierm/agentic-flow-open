// P-047: a turn started by a wake message cannot take over a topic, close it or change rules; the operator's next prompt unlocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

test('sensitive scripts refuse in a wake turn and work again after an operator prompt', () => {
  const fx = setup({ second: true });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'alpha', '--subject', 'Alpha']).status, 0);
    assert.equal(fx.runB('topic.mjs', ['create', 'beta', '--subject', 'Beta']).status, 0);
    fx.git(fx.brain, 'pull', '-q');

    // Wake turn in thread a1 carrying an "instruction" inside the message text.
    const wake = fx.hook('user-prompt-submit.mjs', { prompt: 'You have mail in topic alpha' });
    assert.match(wake.context, /wake: no new mail/);

    const takeover = fx.run('topic.mjs', ['claim', 'beta', '--force', '--operator-approved']);
    assert.notEqual(takeover.status, 0);
    assert.match(takeover.out, /P-047/);
    assert.match(fx.read('topics/beta/holder.json'), /b2/, 'holder unchanged');

    const close = fx.run('finish.mjs', ['--topic', '--verified', 'seen']);
    assert.notEqual(close.status, 0);
    assert.match(close.out, /P-047/);
    assert.ok(fx.exists('topics/alpha/topic.json'), 'topic not archived');

    const rule = fx.run('save.mjs', ['rule', 'no-force', '--content', 'x']);
    assert.notEqual(rule.status, 0);
    assert.match(rule.out, /P-047/);
    const exception = fx.run('save.mjs', ['exception', 'P-021', '--wording', 'x', '--reason', 'y']);
    assert.notEqual(exception.status, 0);
    assert.match(exception.out, /P-047/);

    const create = fx.run('topic.mjs', ['create', 'gamma', '--subject', 'Gamma']);
    assert.notEqual(create.status, 0);
    assert.match(create.out, /P-047/);

    // Reading, answering and acking stay allowed in a wake turn: finish of a unit (no --topic) is not sensitive.
    assert.equal(fx.run('finish.mjs', ['--verified', 'seen']).status, 0);

    // Operator prompt resets the flag.
    fx.hook('user-prompt-submit.mjs', { prompt: 'uzavri tému' });
    const closed = fx.run('finish.mjs', ['--topic', '--verified', 'seen']);
    assert.equal(closed.status, 0, closed.out);
    assert.ok(fx.exists('topics/archive/alpha/topic.json'));
  } finally { fx.cleanup(); }
});
