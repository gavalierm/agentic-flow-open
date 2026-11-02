// Update of an installed workflow clone to the newest release tag (skill check). Only a release install is switched:
// HEAD exactly on a tag `v*`, clean working tree. A dev clone (branch) or a dirty one is left alone and said so.
import { git } from './util.mjs';

const semver = (t) => (/^v(\d+)\.(\d+)\.(\d+)$/.exec(t) || []).slice(1).map(Number);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

/** -> { status: 'updated'|'current'|'skipped'|'failed', from, to, reason } */
export function updateClone(root) {
  if (git(['symbolic-ref', '-q', 'HEAD'], { cwd: root }).ok) return { status: 'skipped', reason: 'the clone is on a branch (development clone)' };
  const cur = git(['describe', '--tags', '--exact-match', '--match', 'v*'], { cwd: root });
  if (!cur.ok || !semver(cur.stdout).length) return { status: 'skipped', reason: 'not a release install (HEAD is not on a release tag)' };
  if (git(['status', '--porcelain'], { cwd: root }).stdout) return { status: 'skipped', from: cur.stdout, reason: 'local changes in the clone' };
  const fetch = git(['fetch', '--tags', '--quiet', 'origin'], { cwd: root });
  if (!fetch.ok) return { status: 'failed', from: cur.stdout, reason: `git fetch: ${fetch.stderr.split('\n')[0]}` };
  const tags = git(['tag', '-l', 'v*'], { cwd: root }).stdout.split('\n').filter((t) => semver(t).length);
  const best = tags.reduce((b, t) => (newer(t, b) ? t : b), cur.stdout);
  if (best === cur.stdout) return { status: 'current', from: cur.stdout, to: best };
  const co = git(['checkout', '--quiet', best], { cwd: root });
  if (!co.ok) return { status: 'failed', from: cur.stdout, to: best, reason: `git checkout: ${co.stderr.split('\n')[0]}` };
  return { status: 'updated', from: cur.stdout, to: best };
}
