// Persona repository naming rule: the repo of a persona is always "agent-<name>" (operator 2026-11-02).
// Enforced in code, not in prose: there is no fallback name when the repo already exists.
export const PERSONA_PREFIX = 'agent-';
export const PERSONA_NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const PERSONA_REPO_RE = /^agent-[a-z][a-z0-9-]{1,30}$/;

// Short persona name ("bob") -> repository name ("agent-bob"). Throws on anything else.
export function personaRepoName(name) {
  if (typeof name !== 'string' || !PERSONA_NAME_RE.test(name)) {
    throw new Error(`invalid persona name "${name}": use lowercase letters, digits and "-", starting with a letter (2-31 chars)`);
  }
  if (name.startsWith(PERSONA_PREFIX)) {
    throw new Error(`persona name "${name}" already has the "${PERSONA_PREFIX}" prefix; pass the short name (the repository is "${PERSONA_PREFIX}${name}" derived by the script)`);
  }
  return `${PERSONA_PREFIX}${name}`;
}

// Repo basename of a git remote URL or path ("host:owner/agent-bob.git" -> "agent-bob").
export function remoteRepoName(remote) {
  const last = String(remote).replace(/\/+$/, '').split(/[/:]/).pop() || '';
  return last.replace(/\.git$/, '');
}

export function assertPersonaRemote(remote) {
  const repo = remoteRepoName(remote);
  if (!PERSONA_REPO_RE.test(repo)) {
    throw new Error(`persona repository must be named "${PERSONA_PREFIX}<name>", got "${repo}"`);
  }
  return repo;
}
