// Workflow update during a session (P-021, operator 2026-11-03: running threads did not know an update came).
// SessionStart records the installed revision in the thread state; the prompt and tool hooks compare it with the
// installed one and announce a change once (hooks and skill files already run the new version). Tokens (operator
// 2026-11-03): the line names only the skills the update changed, and the rules come again only when their text changed.
import path from 'node:path';
import { PLUGIN_ROOT, shortSha, readJson, git } from './util.mjs';

export function installedWorkflow() {
  return { sha: shortSha(PLUGIN_ROOT), version: readJson(path.join(PLUGIN_ROOT, 'package.json'), {})?.version || null };
}

export const UPDATE_LINE = (from, to, skills = []) => `workflow updated during this session: ${from} -> ${to}. Hooks and skill files already run the new version; changed rules follow in full, unchanged rules stay valid; ${skills.length ? `changed skills: ${skills.join(', ')}: read one again before following it from memory` : 'no skill changed'} (P-021)`;

/** Skills whose files differ between two installed revisions; null when git cannot tell (then every skill may be stale). */
export function changedSkills(from, to, root = PLUGIN_ROOT) {
  const r = git(['diff', '--name-only', from, to, '--', 'skills'], { cwd: root });
  if (r.status !== 0) return null;
  return [...new Set(String(r.stdout || '').split('\n').map((l) => l.match(/^skills\/([^/]+)\//)?.[1]).filter(Boolean))].sort();
}

/** { line?, patch } for the thread state, or null when nothing changed. `installed` is injectable for tests. */
export function updateNotice(state, installed = installedWorkflow(), skillsOf = changedSkills) {
  if (!installed.sha) return null;
  const patch = { plugin_sha: installed.sha, plugin_version: installed.version };
  if (!state?.plugin_sha) return { patch };
  if (state.plugin_sha === installed.sha) return null;
  const label = (v, s) => (v ? `v${v} (${s})` : s);
  const skills = skillsOf(state.plugin_sha, installed.sha);
  return { line: UPDATE_LINE(label(state.plugin_version, state.plugin_sha), label(installed.version, installed.sha), skills ?? ['all (diff unavailable)']), patch };
}
