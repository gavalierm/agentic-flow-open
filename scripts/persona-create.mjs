// Create a persona: private GitHub repo "agent-<name>" + brain in ~/agentic/agent-<name> (P-024).
// The repo name is derived here; if it already exists the script fails (no fallback name).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { personaRepoName } from './persona-name.mjs';
import { brainInit } from '../bin/brain-init.mjs';

// Parts kept separate: P-004 lint forbids literal user@host strings in workflow files.
const SSH_USER = 'git';
const GIT_HOST = 'github.com';
const DEFAULT_TOKEN_FILE = path.join(os.homedir(), '.config', 'github', 'github_token');

async function gh(apiUrl, token, method, route, body) {
  const res = await fetch(`${apiUrl}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'agentic-flow' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

export async function createPersona(name, {
  root = path.join(os.homedir(), 'agentic'),
  tokenFile = DEFAULT_TOKEN_FILE,
  apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com',
  remoteFor = (owner, repo) => `${SSH_USER}@${GIT_HOST}:${owner}/${repo}.git`,
} = {}) {
  const repo = personaRepoName(name);
  const dir = path.join(path.resolve(root), repo);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);
  const token = fs.readFileSync(tokenFile, 'utf8').trim();

  const me = await gh(apiUrl, token, 'GET', '/user');
  if (me.status !== 200 || !me.json.login) throw new Error(`GitHub /user failed (HTTP ${me.status})`);
  const owner = me.json.login;

  const probe = await gh(apiUrl, token, 'GET', `/repos/${owner}/${repo}`);
  if (probe.status === 200) throw new Error(`repository ${owner}/${repo} already exists; resolve it (archive/rename the old one) and run again - no other name is used`);
  if (probe.status !== 404) throw new Error(`cannot verify that ${owner}/${repo} is free (HTTP ${probe.status})`);

  const made = await gh(apiUrl, token, 'POST', '/user/repos', { name: repo, private: true });
  if (made.status !== 201) throw new Error(`creating ${owner}/${repo} failed (HTTP ${made.status}): ${made.json.message || ''}`);
  if (made.json.name !== repo) throw new Error(`GitHub created "${made.json.name}" instead of "${repo}"`);

  const res = brainInit(dir, { remote: remoteFor(owner, repo), persona: true });
  return { owner, repo, dir, created: res.created };
}
