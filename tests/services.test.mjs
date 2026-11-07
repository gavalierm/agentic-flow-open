import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { install, latestTag } from '../scripts/services.mjs';

const g = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-inst-'));
  const src = path.join(root, 'domain', 'demo');
  fs.mkdirSync(src, { recursive: true });
  g(src, 'init', '-q', '-b', 'main');
  g(src, 'config', 'user.email', 't@t'); g(src, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(src, 'a.txt'), '1');
  g(src, 'add', '-A'); g(src, 'commit', '-qm', 'one'); g(src, 'tag', 'v0.1.0');
  fs.writeFileSync(path.join(src, 'a.txt'), '2');
  g(src, 'commit', '-qam', 'two'); g(src, 'tag', 'v0.10.0');
  return { root, src, env: { WORKFLOW_SERVICES_DIR: path.join(root, 'services') } };
}

test('services install: clone at the latest tag, switch tag, refuse local changes', () => {
  const { root, src, env } = repo();
  assert.equal(latestTag(src), 'v0.10.0');
  const r = install(src, undefined, env);
  assert.equal(r.dir, path.join(root, 'services', 'demo'));
  assert.equal(fs.readFileSync(path.join(r.dir, 'a.txt'), 'utf8'), '2');
  install(src, 'v0.1.0', env);
  assert.equal(fs.readFileSync(path.join(r.dir, 'a.txt'), 'utf8'), '1');
  fs.writeFileSync(path.join(r.dir, 'a.txt'), 'edited');
  assert.throws(() => install(src, 'v0.10.0', env), /local changes/);
  assert.throws(() => install(src, 'v9.9.9', env), /tag v9.9.9/);
});
