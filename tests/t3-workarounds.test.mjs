// PLAN decision 35: T3 workarounds are registered and checked after every T3 upgrade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN_ROOT } from './helpers.mjs';
import { readRegistry, MARKER_RE, checkAll, checkProviderLog, checkUpstream, checkCliShow, newestThread, formatResults } from '../scripts/t3-workarounds.mjs';

const CODE_DIRS = ['hooks', 'scripts', 'bin', 'adapters'];
function codeFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) codeFiles(p, out); else if (p.endsWith('.mjs') && !p.endsWith('t3-workarounds.mjs')) out.push(p);
  }
  return out;
}

test('every T3-WORKAROUND marker in code is registered, every registered file carries its marker', () => {
  const reg = readRegistry();
  const ids = new Set(reg.map((w) => w.id));
  const marked = new Map();
  for (const f of CODE_DIRS.flatMap((d) => codeFiles(path.join(PLUGIN_ROOT, d)))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(MARKER_RE)) {
      assert.ok(ids.has(m[1]), `${path.relative(PLUGIN_ROOT, f)}: marker ${m[1]} not in docs/t3-workarounds.json`);
      marked.set(m[1], [...(marked.get(m[1]) || []), path.relative(PLUGIN_ROOT, f)]);
    }
  }
  for (const w of reg) {
    assert.ok(w.pilot && w.remove_when && w.depends_on.length, `${w.id}: pilot, remove_when and depends_on are required`);
    for (const f of w.files) assert.ok((marked.get(w.id) || []).includes(f), `${f} has no T3-WORKAROUND(${w.id}) marker`);
  }
});

function t3Home({ started = '2026-11-03T10:00:00.000Z', logs = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 't3w-'));
  fs.writeFileSync(path.join(home, 'server-runtime.json'), JSON.stringify({ serverVersion: '9.9.9', startedAt: started }));
  fs.mkdirSync(path.join(home, 'logs', 'provider'), { recursive: true });
  for (const [n, text] of Object.entries(logs)) fs.writeFileSync(path.join(home, 'logs', 'provider', n), text);
  return home;
}
const SID = '5e08b292-aa43-499d-83ee-c78700335958';
const open = (t, opts) => `[${t}] NTIVE: {"payload":{"type":"query.open","options":${JSON.stringify(opts)}}}\n`;

test('provider log: resumed query.open since T3 start must carry the cursor in the known format', () => {
  const since = '2026-11-03T10:00:00.000Z';
  let h = t3Home({ logs: { 'events.mcp-a.log': open('2026-11-03T09:00:00.000Z', { model: 'x', resume: SID }) } });
  assert.equal(checkProviderLog(h, since)[0], 'PENDING', 'lines before the T3 start do not count');
  h = t3Home({ logs: { 'events.mcp-a.log': open('2026-11-03T11:00:00.000Z', { model: 'x' }) } });
  assert.match(checkProviderLog(h, since).join(' '), /^PENDING .*none resumed/);
  h = t3Home({ logs: { 'events.mcp-a.log': open('2026-11-03T11:00:00.000Z', { model: 'x', resume: SID }) } });
  assert.deepEqual(checkProviderLog(h, since)[0], 'OK');
  h = t3Home({ logs: { 'events.mcp-a.log': open('2026-11-03T11:00:00.000Z', { model: 'x', resume: { id: SID } }) } });
  assert.match(checkProviderLog(h, since).join(' '), /^FAIL .*cursor format/);
  h = t3Home({ logs: { 'events.mcp-a.log': '[2026-11-03T11:00:00.000Z] {"payload":{"type":"session.start"}}\n' } });
  assert.match(checkProviderLog(h, since).join(' '), /^FAIL .*none with query.open/);
  fs.rmSync(path.join(h, 'logs'), { recursive: true });
  assert.match(checkProviderLog(h, since).join(' '), /^FAIL .*missing/);
});

test('upstream: a merged fix PR asks to remove the workaround; network errors are not failures', async () => {
  const up = { repo: 'o/r', fix_pr: 1 };
  const res = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 403, json: async () => body });
  assert.equal((await checkUpstream(up, res({ state: 'open', merged_at: null })))[0], 'OK');
  assert.equal((await checkUpstream(up, res({ state: 'closed', merged_at: '2026-12-01T00:00:00Z' })))[0], 'REMOVE');
  assert.equal((await checkUpstream(up, res({}, false)))[0], 'PENDING');
  assert.equal((await checkUpstream(up, async () => { throw new Error('offline'); }))[0], 'PENDING');
  assert.equal(await checkUpstream(null), null);
});

test('cli: t3 thread show --json must print the title; thread id from the newest provider log', () => {
  const ok = () => ({ status: 0, stdout: '{"thread":{"threadId":"mcp:x","title":"t"}}' });
  assert.equal(checkCliShow('t3', 'mcp:x', ok)[0], 'OK');
  assert.equal(checkCliShow('t3', 'mcp:x', () => ({ status: 0, stdout: '{"thread":{"name":"t"}}' }))[0], 'FAIL');
  assert.equal(checkCliShow('t3', 'mcp:x', () => ({ status: 2, stderr: 'unknown command' }))[0], 'FAIL');
  assert.equal(checkCliShow('t3', null, ok)[0], 'PENDING');
  const h = t3Home({ logs: { 'events.mcp-3c22248f-b132-4e46-8546-f99b101b4298.log': '', 'events.da00c313-71ac-4201-985f-9a3f72718f0f.log': '' } });
  fs.utimesSync(path.join(h, 'logs/provider/events.da00c313-71ac-4201-985f-9a3f72718f0f.log'), new Date(0), new Date(0));
  assert.equal(newestThread(h), 'mcp:3c22248f-b132-4e46-8546-f99b101b4298');
});

test('checkAll: every workaround gets its pilot step; FAIL makes the CLI exit 1', async () => {
  const h = t3Home({ logs: { 'events.mcp-a.log': open('2026-11-03T11:00:00.000Z', { model: 'x', resume: SID }) } });
  const r = await checkAll({ t3Home: h, upstream: false, run: () => ({ status: 0, stdout: '{"thread":{"title":"t"}}' }) });
  assert.equal(r.version, '9.9.9');
  for (const w of readRegistry()) assert.ok(r.results.some((x) => x.id === w.id && x.status === 'MANUAL'), w.id);
  assert.ok(!r.results.some((x) => x.status === 'FAIL'), formatResults(r));
  assert.match(formatResults(r), /^t3 9\.9\.9: \d+ ok, 0 fail/m);
  const fake = path.join(h, 'fake-t3');
  fs.writeFileSync(fake, '#!/bin/sh\necho nope >&2; exit 3\n', { mode: 0o755 });
  const cli = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'bin/t3-workarounds.mjs'), 'check', '--t3-home', h, '--t3', fake, '--no-upstream'], { encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /^FAIL t3-cli-title: .*nope/m);
});
