// flow-public#5: a T3 thread id with ':' (mcp:launch:…) is not a valid Windows file name; the state file name is encoded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { threadStateFile, readThreadState, writeThreadState } from '../scripts/config.mjs';

test('thread state: id with characters Windows forbids gets an encoded file name; UUID and legacy raw-name state still read', () => {
  const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'tstate-'));
  const dir = path.join(brain, 'local', 'threads');
  fs.mkdirSync(dir, { recursive: true });
  const uuid = '3f2b9c1e-8a4d-4f6e-9b2a-1c3d5e7f9a0b';
  assert.equal(path.basename(threadStateFile(brain, uuid)), `${uuid}.json`);

  const mcp = 'mcp:launch:a7dc373e';
  writeThreadState(brain, mcp, { turn_source: 'wake' });
  const names = fs.readdirSync(dir);
  assert.deepEqual(names, ['mcp%3Alaunch%3Aa7dc373e.json']);
  for (const n of names) assert.doesNotMatch(n, /[<>:"/\\|?*]/);
  assert.equal(readThreadState(brain, mcp).turn_source, 'wake');
  assert.equal(path.basename(threadStateFile(brain, 'a*b?c')), 'a%2Ab%3Fc.json');

  // state written by v0.9.14 and older under the raw id (Linux, macOS) is still read, and the next write uses the encoded name
  if (process.platform !== 'win32') {
    const old = 'thread:delegated-task:x1';
    fs.writeFileSync(path.join(dir, `${old}.json`), JSON.stringify({ thread: old, turn_source: 'wake', timer: { at: 'T' } }));
    assert.equal(readThreadState(brain, old).timer.at, 'T');
    writeThreadState(brain, old, { ...readThreadState(brain, old), turn_source: 'operator' });
    const moved = JSON.parse(fs.readFileSync(path.join(dir, 'thread%3Adelegated-task%3Ax1.json'), 'utf8'));
    assert.equal(moved.timer.at, 'T');
    assert.equal(readThreadState(brain, old).turn_source, 'operator');
  }
  fs.rmSync(brain, { recursive: true, force: true });
});
