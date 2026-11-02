// Single writer for the brain repository (P-040, P-037, P-025, P-013).
import fs from 'node:fs';
import path from 'node:path';
import { git, gitRetry, readJson, toPosix } from './util.mjs';
import { BRAIN_COMMIT_TAG, BRAIN_SCRIPT_ENV, brainScriptEnv, inSubagent } from './config.mjs';
import { checkBrainFile } from './brain-checks.mjs';

/**
 * Serializes brain mutations of all processes on this machine that share one brain clone (several threads of one
 * project, P-040): git index and HEAD are single-writer. Lock = directory in .git (atomic mkdir), reentrant within a
 * process, stale after LOCK_STALE_MS (crashed holder). Waits up to LOCK_WAIT_MS, then fails with a clear error.
 */
const LOCK_WAIT_MS = 60000;
const LOCK_STALE_MS = 120000;
const lockDepth = new Map();
const sleeper = new Int32Array(new SharedArrayBuffer(4));

export function brainLockPath(brainDir) {
  return path.join(brainDir, '.git', 'workflow-write.lock');
}

export function withBrainLock(brainDir, fn) {
  if (!brainDir || !fs.existsSync(path.join(brainDir, '.git'))) return fn();
  const lock = brainLockPath(brainDir);
  const depth = lockDepth.get(lock) || 0;
  if (depth > 0) {
    lockDepth.set(lock, depth + 1);
    try { return fn(); } finally { lockDepth.set(lock, lockDepth.get(lock) - 1); }
  }
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, 'owner'), `${process.pid} ${new Date().toISOString()}\n`);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
      if (age > LOCK_STALE_MS) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`brain is busy (another workflow script holds ${lock} for ${Math.round(age / 1000)} s); retry`);
      Atomics.wait(sleeper, 0, 0, 50 + Math.floor(Math.random() * 100));
    }
  }
  lockDepth.set(lock, 1);
  try {
    return fn();
  } finally {
    lockDepth.set(lock, 0);
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** Files that may change on both sides without being a disagreement (P-037, P-030). */
export const SYNC_EXCEPTIONS = [/^topics\/[^/]+\/holder\.json$/, /^logs\/[^/]+\.log$/];

export function currentBranch(brainDir) {
  const res = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: brainDir });
  return res.ok && res.stdout !== 'HEAD' ? res.stdout : 'main';
}

export function hasRemote(brainDir) {
  return git(['remote', 'get-url', 'origin'], { cwd: brainDir }).ok;
}

export function unpushedCount(brainDir) {
  const branch = currentBranch(brainDir);
  if (!hasRemote(brainDir)) return 0;
  const remoteRef = git(['rev-parse', '--verify', '--quiet', `origin/${branch}`], { cwd: brainDir });
  if (!remoteRef.ok) {
    const all = git(['rev-list', '--count', 'HEAD'], { cwd: brainDir });
    return all.ok ? Number(all.stdout) : 0;
  }
  const res = git(['rev-list', '--count', `origin/${branch}..HEAD`], { cwd: brainDir });
  return res.ok ? Number(res.stdout) : 0;
}

function isException(file) {
  return SYNC_EXCEPTIONS.some((re) => re.test(file));
}

/**
 * Fetch, detect disagreement, rebase, push (P-040 items 2-4).
 * Returns { pushed, unpushed, conflict: string[] | null, error: string | null, remoteAhead }.
 */
export function brainSync(brainDir, opts = {}) {
  return withBrainLock(brainDir, () => brainSyncUnlocked(brainDir, opts));
}

function brainSyncUnlocked(brainDir, { attempts = 3 } = {}) {
  const branch = currentBranch(brainDir);
  const result = { pushed: false, unpushed: 0, conflict: null, error: null, remoteAhead: false };
  if (!hasRemote(brainDir)) {
    result.error = 'no remote origin';
    return result;
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const fetch = gitRetry(['fetch', '--quiet', 'origin'], { cwd: brainDir });
    if (!fetch.ok) {
      result.error = `fetch failed: ${firstLine(fetch.stderr)}`;
      result.unpushed = unpushedCount(brainDir);
      return result;
    }
    const remoteRef = git(['rev-parse', '--verify', '--quiet', `origin/${branch}`], { cwd: brainDir });
    if (remoteRef.ok) {
      const base = git(['merge-base', 'HEAD', `origin/${branch}`], { cwd: brainDir }).stdout;
      const remoteHead = remoteRef.stdout;
      if (base !== remoteHead) {
        result.remoteAhead = true;
        const localChanged = git(['diff', '--name-only', base, 'HEAD'], { cwd: brainDir }).stdout.split('\n').filter(Boolean);
        const remoteChanged = git(['diff', '--name-only', base, remoteHead], { cwd: brainDir }).stdout.split('\n').filter(Boolean);
        const both = localChanged.filter((f) => remoteChanged.includes(f) && !isException(f));
        if (both.length) {
          result.conflict = both;
          result.unpushed = unpushedCount(brainDir);
          return result;
        }
        const rebase = gitRetry(['rebase', '--quiet', `origin/${branch}`], { cwd: brainDir, env: brainScriptEnv() });
        if (!rebase.ok) {
          const unmerged = git(['diff', '--name-only', '--diff-filter=U'], { cwd: brainDir }).stdout.split('\n').filter(Boolean);
          git(['rebase', '--abort'], { cwd: brainDir });
          result.conflict = unmerged.length ? unmerged : localChanged.filter((f) => remoteChanged.includes(f));
          result.unpushed = unpushedCount(brainDir);
          return result;
        }
      }
    }
    if (unpushedCount(brainDir) === 0 && remoteRef.ok) {
      result.pushed = true;
      return result;
    }
    const push = gitRetry(['push', '--quiet', '-u', 'origin', `HEAD:${branch}`], { cwd: brainDir });
    if (push.ok) {
      result.pushed = true;
      result.unpushed = 0;
      return result;
    }
    if (!/rejected|fetch first|non-fast-forward|failed to push/.test(push.stderr)) {
      result.error = `push failed: ${firstLine(push.stderr)}`;
      result.unpushed = unpushedCount(brainDir);
      return result;
    }
  }
  result.error = 'push rejected repeatedly';
  result.unpushed = unpushedCount(brainDir);
  return result;
}

function firstLine(s) {
  return String(s || '').split('\n')[0];
}

export function readHolder(brainDir, topicId) {
  return readJson(path.join(brainDir, 'topics', topicId, 'holder.json'), {}) || {};
}

export function topicOfPath(rel) {
  const m = /^topics\/([^/]+)\/(.+)$/.exec(rel);
  if (!m || m[1] === 'archive') return null;
  return m[1];
}

/** Holder check for writes into topics/<id>/ (P-037, P-040 item 5). */
export function checkHolder(brainDir, rel, thread) {
  const topic = topicOfPath(rel);
  if (!topic) return null;
  if (!thread) return `write into topics/${topic}/ requires a stable thread id (P-038)`;
  const holder = readHolder(brainDir, topic);
  if (!holder.thread) return `topic ${topic} has no holder; claim it first (P-037)`;
  if (holder.thread !== thread) return `topic ${topic} held by thread ${holder.thread}; this thread (${thread}) is not the holder (P-037)`;
  return null;
}

/** Holder decisions need the latest remote state (P-037): fetch first, then read holder.json. */
export function syncAndCheckHolder(brainDir, rel, thread) {
  if (topicOfPath(rel) && hasRemote(brainDir)) brainSync(brainDir);
  return checkHolder(brainDir, rel, thread);
}

/**
 * Write files into brain and commit with the script tag; then sync.
 * ops: [{ path, content }, { path, remove: true }, { from, to }]
 * Returns { committed, sha, sync, unpushed, warnings }.
 */
export function brainWrite(ctx, opts) {
  return withBrainLock(ctx.brainDir, () => brainWriteUnlocked(ctx, opts));
}

function brainWriteUnlocked(ctx, { ops, message, internal = false, sync = true, agentId = null }) {
  const { brainDir, thread, policy } = ctx;
  if (!brainDir) throw new Error('brain unavailable');
  if (agentId || inSubagent()) throw new Error('brain write refused in subagent; return the result to the main agent (P-025)');
  if (!message || !String(message).trim()) throw new Error('commit message required');
  const errors = [];
  const touched = [];
  const rels = ops.flatMap((op) => (op.from ? [op.from, op.to] : [op.path])).map((t) => toPosix(t).replace(/^\.\//, ''));
  if (!internal && rels.some((r) => topicOfPath(r)) && hasRemote(brainDir)) brainSync(brainDir);
  for (const op of ops) {
    const targets = op.from ? [op.from, op.to] : [op.path];
    for (const t of targets) {
      const rel = toPosix(t).replace(/^\.\//, '');
      if (rel.split('/').includes('..') || path.isAbsolute(rel)) errors.push(`${rel}: path must be relative inside brain`);
      if (!internal) {
        const holderError = checkHolder(brainDir, rel, thread);
        if (holderError) errors.push(holderError);
      }
      errors.push(...checkBrainFile(rel, op.remove || op.from === t ? null : op.content ?? null, { policy }));
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));

  for (const op of ops) {
    if (op.from) {
      const from = path.join(brainDir, op.from);
      const to = path.join(brainDir, op.to);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      touched.push(op.from, op.to);
    } else if (op.remove) {
      fs.rmSync(path.join(brainDir, op.path), { recursive: true, force: true });
      touched.push(op.path);
    } else {
      const file = path.join(brainDir, op.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, op.content);
      touched.push(op.path);
    }
  }
  const env = brainScriptEnv();
  const add = gitRetry(['add', '-A', '--', ...touched], { cwd: brainDir, env });
  if (!add.ok) throw new Error(`git add failed: ${firstLine(add.stderr)}`);
  const staged = git(['diff', '--cached', '--quiet'], { cwd: brainDir });
  const result = { committed: false, sha: null, sync: null, unpushed: unpushedCount(brainDir), warnings: [] };
  if (!staged.ok) {
    const commit = gitRetry(['commit', '--quiet', '-m', `${BRAIN_COMMIT_TAG} ${message}`], { cwd: brainDir, env });
    if (!commit.ok) throw new Error(`commit failed: ${firstLine(commit.stderr || commit.stdout)}`);
    result.committed = true;
    result.sha = git(['rev-parse', '--short', 'HEAD'], { cwd: brainDir }).stdout;
  }
  if (sync) {
    result.sync = brainSync(brainDir);
    result.unpushed = result.sync.unpushed ?? unpushedCount(brainDir);
    if (result.sync.conflict) result.warnings.push(`conflict: ${result.sync.conflict.join(', ')} (changed on both sides; not merged, P-040)`);
    else if (result.sync.error && result.sync.error !== 'no remote origin') result.warnings.push(`unpushed: ${result.unpushed} (${result.sync.error})`);
  } else {
    result.unpushed = unpushedCount(brainDir);
  }
  return result;
}

export function formatWriteResult(res, paths) {
  const lines = [];
  lines.push(`${res.committed ? 'written' : 'unchanged'}: ${paths.join(', ')}${res.sha ? ` (${res.sha})` : ''}`);
  if (res.unpushed > 0) lines.push(`unpushed: ${res.unpushed}`);
  lines.push(...res.warnings);
  return lines.join('\n');
}
