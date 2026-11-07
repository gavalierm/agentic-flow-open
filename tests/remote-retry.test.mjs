// Flaky ssh auth: brain fetch/push retries transient remote failures and reports a diagnosis on final failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitRemote, remoteDiagnosis } from '../scripts/util.mjs';

function fixture(failures) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-retry-'));
  const sh = (args, cwd = dir) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  sh(['init', '--quiet', '--bare', 'origin.git']);
  sh(['init', '--quiet', '-b', 'main', 'work']);
  const work = path.join(dir, 'work');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], work);
  sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'a'], work);
  sh(['remote', 'add', 'origin', `ssh://git@fake${path.join(dir, 'origin.git')}`], work);
  const counter = path.join(dir, 'count');
  fs.writeFileSync(counter, '0');
  const wrapper = path.join(dir, 'fake-ssh');
  fs.writeFileSync(wrapper, `#!/bin/sh\nn=$(cat '${counter}'); echo $((n+1)) > '${counter}'\nif [ "$n" -lt ${failures} ]; then echo "git@fake: Permission denied (publickey)." >&2; exit 255; fi\nshift\nexec sh -c "$*"\n`, { mode: 0o755 });
  const env = { GIT_SSH_COMMAND: wrapper, GIT_SSH_VARIANT: 'simple' };
  return { dir, work, env, tries: () => Number(fs.readFileSync(counter, 'utf8')), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('push passes after transient publickey failures', () => {
  const fx = fixture(2);
  try {
    const res = gitRemote(['push', '--quiet', 'origin', 'HEAD:main'], { cwd: fx.work, env: fx.env }, [10, 10, 10]);
    assert.equal(res.ok, true, res.stderr);
    assert.equal(fx.tries(), 3);
  } finally { fx.cleanup(); }
});

test('persistent failure stops after the retries and gets a diagnosis', () => {
  const fx = fixture(99);
  try {
    const res = gitRemote(['push', '--quiet', 'origin', 'HEAD:main'], { cwd: fx.work, env: fx.env }, [10, 10]);
    assert.equal(res.ok, false);
    assert.equal(fx.tries(), 3);
    const d = remoteDiagnosis(res.stderr, { HOME: fx.dir });
    assert.match(d, /HOME set, ssh config missing, default keys 0, agent socket unset/);
    assert.equal(remoteDiagnosis('! [rejected] main -> main (fetch first)'), '');
  } finally { fx.cleanup(); }
});
