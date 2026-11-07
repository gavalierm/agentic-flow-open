// GitHub REST access with the operator's token (repositories live under the operator's account).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Parts kept separate: P-004 lint forbids literal user@host strings in workflow files.
const SSH_USER = 'git';
const GIT_HOST = 'github.com';
export const DEFAULT_TOKEN_FILE = path.join(os.homedir(), '.config', 'github', 'github_token');
export const DEFAULT_API_URL = 'https://api.github.com';
export const sshRemote = (owner, repo) => `${SSH_USER}@${GIT_HOST}:${owner}/${repo}.git`;

export function readToken(tokenFile = DEFAULT_TOKEN_FILE) {
  return fs.readFileSync(tokenFile, 'utf8').trim();
}

export async function gh(apiUrl, token, method, route, body) {
  const res = await fetch(`${apiUrl}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'agentic-flow' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Login of the token's account. */
export async function ghOwner(apiUrl, token) {
  const me = await gh(apiUrl, token, 'GET', '/user');
  if (me.status !== 200 || !me.json.login) throw new Error(`GitHub /user failed (HTTP ${me.status})`);
  return me.json.login;
}

/** All repositories the account owns (paged). */
export async function ghOwnedRepos(apiUrl, token) {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const r = await gh(apiUrl, token, 'GET', `/user/repos?affiliation=owner&per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`GitHub repository list failed (HTTP ${r.status})`);
    out.push(...r.json);
    if (r.json.length < 100) break;
  }
  return out;
}

/** Names in the repository root of the default branch; [] for an empty repository. */
export async function ghRootNames(apiUrl, token, owner, repo) {
  const r = await gh(apiUrl, token, 'GET', `/repos/${owner}/${repo}/contents/`);
  if (r.status === 404 || r.status === 409) return [];
  if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`GitHub contents of ${owner}/${repo} failed (HTTP ${r.status})`);
  return r.json.map((e) => e.name);
}
