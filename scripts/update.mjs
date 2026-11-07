// Update of an installed workflow clone to the newest release tag (skill check). Only a release install is switched:
// HEAD exactly on a tag `v*`, clean working tree. A dev clone (branch) or a dirty one is left alone and said so.
import { git } from './util.mjs';

const semver = (t) => (/^v(\d+)\.(\d+)\.(\d+)$/.exec(t) || []).slice(1).map(Number);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

/** Release install on a clean tree: { tag } or a skipped result (a development or dirty clone is never switched). */
function releaseInstall(root) {
  if (git(['symbolic-ref', '-q', 'HEAD'], { cwd: root }).ok) return { status: 'skipped', dev: true, reason: 'the clone is on a branch (development clone)' };
  const cur = git(['describe', '--tags', '--exact-match', '--match', 'v*'], { cwd: root });
  if (!cur.ok || !semver(cur.stdout).length) return { status: 'skipped', reason: 'not a release install (HEAD is not on a release tag)' };
  if (git(['status', '--porcelain'], { cwd: root }).stdout) return { status: 'skipped', from: cur.stdout, reason: 'local changes in the clone' };
  return { tag: cur.stdout };
}

/** First release that reads `workflow_version`: an older one would ignore every later change of the pin. */
export const PIN_MIN = 'v0.9.11';

/** Brain policy `workflow_version` (P-040): every machine of the brain runs that release, newer or older (from PIN_MIN). */
export function pinClone(root, version, { min = PIN_MIN } = {}) {
  const want = /^v/.test(String(version)) ? String(version) : `v${version}`;
  if (!semver(want).length) return { status: 'failed', to: want, reason: `workflow_version "${version}" is not a release tag vX.Y.Z` };
  if (newer(min, want)) return { status: 'failed', to: want, reason: `${want} predates workflow_version (first in ${min}): that release would not follow a later change of the pin; pin ${min} or newer` };
  const inst = releaseInstall(root);
  if (!inst.tag) return { ...inst, to: want };
  if (inst.tag === want) return { status: 'current', from: inst.tag, to: want };
  const has = () => git(['rev-parse', '--verify', '--quiet', `refs/tags/${want}`], { cwd: root }).ok;
  if (!has()) {
    const fetch = git(['fetch', '--tags', '--quiet', 'origin'], { cwd: root });
    if (!fetch.ok) return { status: 'failed', from: inst.tag, to: want, reason: `git fetch: ${fetch.stderr.split('\n')[0]}` };
    if (!has()) return { status: 'failed', from: inst.tag, to: want, reason: `release ${want} does not exist` };
  }
  const co = git(['checkout', '--quiet', want], { cwd: root });
  if (!co.ok) return { status: 'failed', from: inst.tag, to: want, reason: `git checkout: ${co.stderr.split('\n')[0]}` };
  return { status: 'updated', from: inst.tag, to: want };
}

/** -> { status: 'updated'|'current'|'skipped'|'failed', from, to, reason } */
export function updateClone(root) {
  const inst = releaseInstall(root);
  if (!inst.tag) { const { dev, ...r } = inst; return r; }
  const cur = { stdout: inst.tag };
  const fetch = git(['fetch', '--tags', '--quiet', 'origin'], { cwd: root });
  if (!fetch.ok) return { status: 'failed', from: cur.stdout, reason: `git fetch: ${fetch.stderr.split('\n')[0]}` };
  const tags = git(['tag', '-l', 'v*'], { cwd: root }).stdout.split('\n').filter((t) => semver(t).length);
  const best = tags.reduce((b, t) => (newer(t, b) ? t : b), cur.stdout);
  if (best === cur.stdout) return { status: 'current', from: cur.stdout, to: best };
  const co = git(['checkout', '--quiet', best], { cwd: root });
  if (!co.ok) return { status: 'failed', from: cur.stdout, to: best, reason: `git checkout: ${co.stderr.split('\n')[0]}` };
  return { status: 'updated', from: cur.stdout, to: best };
}
