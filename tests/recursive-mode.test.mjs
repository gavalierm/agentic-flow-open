import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recursiveModeChange } from '../hooks/pre-tool-use.mjs';

test('recursive chown/chmod asks, also inside sudo bash -c; absolute scratch paths pass (2026-11-03)', () => {
  const s = '/p/scratch';
  assert.ok(recursiveModeChange(`sudo bash -c 'sed -i s/a/b/ .git/config\nchown -R u:u .'`, '/srv/x', s));
  assert.ok(recursiveModeChange('chmod -R 755 ~/agenti', '/srv/x', s));
  assert.ok(recursiveModeChange('sudo chown --recursive u:u /srv/u', '/', s));
  assert.ok(recursiveModeChange('cd /p/scratch && chown -R u .', '/', s));
  assert.equal(recursiveModeChange('chown u:u /srv/u/.git/config', '/', s), null, 'one file is not recursive');
  assert.equal(recursiveModeChange('chmod -R u+w /p/scratch/clone', '/', s), null);
  assert.equal(recursiveModeChange('grep -R chown src', '/', s), null);
});
