// P-036: the thread title follows the topic; main threads, titles changed by hand and harnesses outside T3 are left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadTitleSignal, readThreadTitle } from '../scripts/thread-title.mjs';

const ctx = { thread: 't1', policy: { thread_title: { command: 't3 thread show --json' } } };
const env = { T3CODE_THREAD_ID: 't1' };
const held = (...ids) => ids.map((id) => ({ id }));
const reader = (title) => { const calls = []; return { calls, read: (c) => { calls.push(c.thread); return title; } }; };

test('topic change: one rename line, then nothing until the topic changes again', () => {
  const r = reader('Udajne mame tuto sluzbu...');
  const out = threadTitleSignal(ctx, held('beszel'), {}, { read: r.read, env });
  assert.equal(out.line, 'thread title: rename this thread to "beszel" (tool t3_thread_update, action rename), P-036');
  assert.deepEqual(out.patch, { title_topic: 'beszel', auto_title: 'beszel', title_prev: 'Udajne mame tuto sluzbu...' });
  assert.equal(threadTitleSignal(ctx, held('beszel'), out.patch, { read: r.read, env }), null, 'synced: no T3 call');
  assert.equal(r.calls.length, 1);
  // Next topic, title still the one the workflow asked for: rename again.
  const next = threadTitleSignal(ctx, held('dns'), out.patch, { read: reader('beszel').read, env });
  assert.match(next.line, /rename this thread to "dns"/);
  // The agent did not rename (title unchanged): still not manual.
  assert.match(threadTitleSignal(ctx, held('x'), out.patch, { read: reader('Udajne mame tuto sluzbu...').read, env }).line, /"x"/);
});

test('title changed by hand, main threads, outside T3, title already right, T3 unavailable', () => {
  const st = { title_topic: 'beszel', auto_title: 'beszel', title_prev: 'old' };
  assert.deepEqual(threadTitleSignal(ctx, held('dns'), st, { read: reader('Môj názov').read, env }), { line: null, patch: { title_topic: 'dns', title_manual: 'Môj názov' } });
  const r = reader('x');
  assert.equal(threadTitleSignal(ctx, held('main'), {}, { read: r.read, env }), null);
  assert.equal(threadTitleSignal(ctx, held('work', 'main'), {}, { read: r.read, env }), null, 'persona main thread with a work topic');
  assert.equal(threadTitleSignal(ctx, held('work'), {}, { read: r.read, env: {} }), null, 'outside T3');
  assert.equal(threadTitleSignal(ctx, [], {}, { read: r.read, env }), null);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(threadTitleSignal(ctx, held('work'), {}, { read: reader('work').read, env }), { line: null, patch: { title_topic: 'work', auto_title: 'work' } });
  assert.deepEqual(threadTitleSignal(ctx, held('work'), {}, { read: () => null, env }), { line: null, patch: { title_topic: 'work' } });
});

test('two held work topics: no rename (alphabetical first is arbitrary); one left again: rename to it', () => {
  // alice 2026-11-03: the thread held workflow-dev and carol-v2 and was told to rename to carol-v2.
  const r = reader('workflow-dev');
  const st = { title_topic: 'workflow-dev', auto_title: 'workflow-dev' };
  assert.equal(threadTitleSignal(ctx, held('carol-v2', 'workflow-dev'), st, { read: r.read, env }), null);
  assert.equal(r.calls.length, 0);
  assert.equal(threadTitleSignal(ctx, held('workflow-dev'), st, { read: r.read, env }), null, 'title already follows the remaining topic');
  assert.match(threadTitleSignal(ctx, held('carol-v2'), st, { read: r.read, env }).line, /rename this thread to "carol-v2"/);
});

test('readThreadTitle: thread id appended to the command, JSON title, failure → null', () => {
  let argv;
  const ok = (cmd, args) => { argv = [cmd, ...args]; return { status: 0, stdout: JSON.stringify({ thread: { title: 'T' } }) }; };
  assert.equal(readThreadTitle(ctx, ok), 'T');
  assert.deepEqual(argv, ['t3', 'thread', 'show', '--json', 't1']);
  assert.equal(readThreadTitle(ctx, () => ({ status: 1, stdout: '' })), null);
  assert.equal(readThreadTitle(ctx, () => ({ error: new Error('ENOENT') })), null);
  assert.equal(readThreadTitle(ctx, () => ({ status: 0, stdout: 'not json' })), null);
});
