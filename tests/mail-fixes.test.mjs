// P-037, P-041, P-044: mail registration follows the holder in topics/<id>/holder.json; a failed registration is said
// (and repeated); the free point keeps its mailbox (status line, Stop block) and its triaged state; an outage is never
// shown as `mail: 0` or as "no new mail". Comms client: tests/fixtures/comms-stub.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, PLUGIN_ROOT } from './helpers.mjs';

const STUB = path.join(PLUGIN_ROOT, 'tests', 'fixtures', 'comms-stub.mjs');
const WAKE = 'you have mail in topic delta';
const msg = (id, topic, extra = {}) => ({ id, level: 'info', sender: 'bob', project: 'project', topic, text: `BODY-${id}`, created_at: '2026-11-01T10:00:00Z', ...extra });

function stubbed(state = {}) {
  const fx = setup();
  const stateFile = path.join(fx.root, 'stub-state.json');
  const logFile = path.join(fx.root, 'stub-log.jsonl');
  Object.assign(fx.env, { WORKFLOW_COMMS_CLIENT: STUB, STUB_COMMS_STATE: stateFile, STUB_COMMS_LOG: logFile });
  fx.stub = {
    set(s) { fs.writeFileSync(stateFile, JSON.stringify(s)); },
    calls(cmd) { return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((a) => !cmd || a[0] === cmd) : []; },
    reset() { fs.rmSync(logFile, { force: true }); },
    registrations() { return this.calls('register-topic').map((a) => a.join(' ')); },
  };
  fx.stub.set(state);
  const stateFile1 = path.join(fx.brain, 'local', 'threads', 'a1.json');
  fx.threadState = () => (fs.existsSync(stateFile1) ? JSON.parse(fs.readFileSync(stateFile1, 'utf8')) : {});
  fx.setThreadState = (patch) => { fs.mkdirSync(path.dirname(stateFile1), { recursive: true }); fs.writeFileSync(stateFile1, JSON.stringify({ ...fx.threadState(), ...patch })); };
  return fx;
}

/** Holder written into the brain and committed, as another thread would have left it. */
function setHolder(fx, id, holder) {
  fs.writeFileSync(path.join(fx.brain, 'topics', id, 'holder.json'), JSON.stringify(holder, null, 2) + '\n');
  fx.git(fx.brain, 'add', '-A');
  fx.git(fx.brain, 'commit', '-q', '--no-verify', '-m', `holder ${id} for test`);
}

test('register: only the thread in holder.json registers; a foreign holder and an unheld topic are refused (P-037)', () => {
  const fx = stubbed({ messages: [] });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'alpha', '--subject', 'Alpha']).status, 0);
    setHolder(fx, 'alpha', { thread: 'other', machine: 'm', mode: 'operator', since: '2026-11-01T10:00:00Z' });
    fx.stub.reset();
    let r = fx.run('comms.mjs', ['register', 'alpha']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /topic alpha is held by thread other/);
    assert.match(r.out, /topic\.mjs claim alpha \(P-037\)/);
    assert.equal(fx.stub.registrations().length, 0, 'no registration for a foreign holder');

    setHolder(fx, 'alpha', {});
    r = fx.run('comms.mjs', ['register', 'alpha']);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /topic alpha is not held: claim it first/);
    assert.equal(fx.stub.registrations().length, 0, 'no registration for an unheld topic');

    assert.equal(fx.run('topic.mjs', ['claim', 'alpha']).status, 0);
    fx.stub.reset();
    r = fx.run('comms.mjs', ['register', 'alpha']);
    assert.equal(r.status, 0, r.out);
    assert.ok(fx.stub.registrations().some((l) => /--topic alpha .*--holder a1\b/.test(l)), fx.stub.registrations().join('\n'));
  } finally { fx.cleanup(); }
});

test('register: bare register never registers a released (free-point) topic to this thread (P-044)', () => {
  const fx = stubbed({ messages: [msg('m1', 'beta')] });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'beta', '--subject', 'Beta']).status, 0);
    // The release sees one new message: the topic stays readable as free point of this thread.
    const rel = fx.run('topic.mjs', ['release', 'beta']);
    assert.equal(rel.status, 0, rel.out);
    assert.match(rel.out, /mail: 1 waiting for topic beta \(free point\)/);
    fx.stub.reset();
    const r = fx.run('comms.mjs', ['register']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /no held topic to register/);
    assert.equal(fx.stub.registrations().filter((l) => /--topic beta\b/.test(l)).length, 0, 'bare register leaves beta free');
  } finally { fx.cleanup(); }
});

test('claim --force registers the takeover with --takeover; a release clears the holder with --release (P-037)', () => {
  const fx = stubbed({ messages: [] });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'gamma', '--subject', 'Gamma']).status, 0);
    setHolder(fx, 'gamma', { thread: 'other', machine: 'm', mode: 'operator', since: '2026-11-01T10:00:00Z' });
    fx.stub.reset();
    const takeover = fx.run('topic.mjs', ['claim', 'gamma', '--force', '--operator-approved']);
    assert.equal(takeover.status, 0, takeover.out);
    assert.ok(fx.stub.registrations().some((l) => /--topic gamma .*--holder a1 .*--takeover\b/.test(l)), fx.stub.registrations().join('\n'));
    fx.stub.reset();
    const rel = fx.run('topic.mjs', ['release', 'gamma']);
    assert.equal(rel.status, 0, rel.out);
    assert.ok(fx.stub.registrations().some((l) => /--topic gamma .*--release\b/.test(l) && !/--holder /.test(l)), fx.stub.registrations().join('\n'));
  } finally { fx.cleanup(); }
});

test('wake turn during an outage says mail is unavailable, not "no new mail"; the status line shows mail ?, not 0 (P-041)', () => {
  const fx = stubbed({ messages: [] });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'delta', '--subject', 'Delta']).status, 0);
    fx.stub.set({ messages: [], down: true });
    const wake = fx.hook('user-prompt-submit.mjs', { prompt: WAKE });
    const lines = wake.context.split('\n');
    assert.match(lines[0], /\| mail: \?/, wake.context);
    assert.doesNotMatch(wake.context, /mail: 0/);
    assert.equal(lines[1], 'wake: mail unavailable (comms unavailable): run comms receive when it is back, or end the turn', wake.context);
    assert.doesNotMatch(wake.context, /no new mail/);
  } finally { fx.cleanup(); }
});

test('no thread and no held topic: the status line says mail is not checked, not mail 0 (P-041)', () => {
  const fx = stubbed({ messages: [] });
  try {
    const r = fx.hook('user-prompt-submit.mjs', { prompt: 'ahoj' }, { env: { WORKFLOW_THREAD_ID: '' } });
    assert.match(r.context, /\| mail: \? \(no thread or held topic: not checked\)$/m, r.context);
    assert.doesNotMatch(r.context, /mail: 0/);
  } finally { fx.cleanup(); }
});

test('registration failure is printed; a repeated claim or release registers again (already is not a short-circuit) (P-041)', () => {
  const fx = stubbed({ messages: [], register_fail: true });
  try {
    const created = fx.run('topic.mjs', ['create', 'epsilon', '--subject', 'Epsilon']);
    assert.equal(created.status, 0, created.out);
    assert.match(created.out, /comms: topic not registered/);
    fx.stub.set({ messages: [], register_fail: true });
    const rel = fx.run('topic.mjs', ['release', 'epsilon']);
    assert.equal(rel.status, 0, rel.out);
    assert.match(rel.out, /comms: topic not registered as free \(comms unavailable\)/);

    // The service is back: a repeated claim (holder is this thread) and a repeated release (already free) both register.
    fx.stub.set({ messages: [] });
    fx.stub.reset();
    assert.equal(fx.run('topic.mjs', ['claim', 'epsilon']).status, 0);
    assert.equal(fx.stub.registrations().filter((l) => /--topic epsilon .*--holder a1/.test(l)).length, 1);
    const again = fx.run('topic.mjs', ['release', 'epsilon']);
    assert.equal(again.status, 0, again.out);
    assert.doesNotMatch(again.out, /not registered/);
    assert.equal(fx.stub.registrations().filter((l) => /--topic epsilon .*--release/.test(l)).length, 1, 'release is registered after the failed one');
  } finally { fx.cleanup(); }
});

test('brain push failure before registration: the claim says mail registration was not done (P-041)', () => {
  const fx = stubbed({ messages: [] });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'zeta', '--subject', 'Zeta', '--no-claim']).status, 0);
    const away = `${fx.origin}.away`;
    fs.renameSync(fx.origin, away);
    try {
      fx.stub.reset();
      const r = fx.run('topic.mjs', ['claim', 'zeta']);
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /mail registration not done/);
      assert.equal(fx.stub.registrations().length, 0, 'no registration before the push');
    } finally { fs.renameSync(away, fx.origin); }
  } finally { fx.cleanup(); }
});

test('free point during an outage: "mail: unknown (comms unavailable)" is said and the topic is still recorded (P-041, P-044)', () => {
  const fx = stubbed({ messages: [] });
  try {
    assert.equal(fx.run('topic.mjs', ['create', 'eta', '--subject', 'Eta']).status, 0);
    fx.stub.set({ messages: [], down: true });
    const rel = fx.run('topic.mjs', ['release', 'eta']);
    assert.equal(rel.status, 0, rel.out);
    assert.match(rel.out, /mail: unknown \(comms unavailable\) for topic eta \(free point\)/);
    assert.ok((fx.threadState().free_point || []).includes('eta'), 'free point recorded during the outage');
  } finally { fx.cleanup(); }
});
