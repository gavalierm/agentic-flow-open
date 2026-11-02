// Resolution of project, brain, policy and thread identity (P-024, P-017, P-038, P-047).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_ROOT, readJson, writeJson, gitToplevel, git, isInside } from './util.mjs';

export const WORKFLOW_CONFIG = '.workflow.json';
export const LOCAL_CONFIG = path.join('local', 'workflow.json');
export const PLUGIN_NAME = 'workflow';
export const PLUGIN_KEY = 'workflow@skills-dir';
// P-048 channels: stable = clone in ~/.claude/skills/workflow (skills-dir plugin, pinned release tag);
// dev = clone on branch dev loaded through CLAUDE_CODE_PLUGIN_DIRS (inline plugin). The project picks one
// in its committed .claude/settings.json; the other id is set to false so it never shadows or doubles.
export const PLUGIN_KEY_DEV = 'workflow@inline';
export const CHANNELS = ['stable', 'dev'];
export function enabledPluginsFor(channel) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel ${channel}; use ${CHANNELS.join(' or ')}`);
  return channel === 'dev' ? { [PLUGIN_KEY]: false, [PLUGIN_KEY_DEV]: true } : { [PLUGIN_KEY]: true, [PLUGIN_KEY_DEV]: false };
}
/** Channel of existing project settings, or null. */
export function channelOf(settings) {
  return settings?.enabledPlugins?.[PLUGIN_KEY_DEV] === true ? 'dev' : settings?.enabledPlugins?.[PLUGIN_KEY] === true ? 'stable' : null;
}
// P-024: a persona is a project whose repository is its brain (`"brain": "."`).
export const PERSONA_BRAIN = '.';
// Template entries of a brain; in a persona they are protected like `<brain>/**` (P-013, P-024).
export const BRAIN_ENTRIES = ['memory/**', 'decisions/**', 'rules/**', 'skills/**', 'topics/**', 'exceptions/**', 'logs/**', 'policy.json', '.githooks/**', '.gitattributes', '.gitignore', '.workflow.json', 'README.md'];
// P-052: work files of the agent; P-018: operator's local files. Writable in a persona.
export const SCRATCH_DIR = 'scratch';
export const PERSONA_WRITABLE = [SCRATCH_DIR, 'local'];

/** Main checkout of the repository containing dir (never a worktree), P-024 persona. */
export function mainCheckout(dir) {
  const r = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir });
  if (!r.ok) return path.resolve(dir);
  const common = r.stdout.trim();
  return path.basename(common) === '.git' ? path.dirname(common) : path.resolve(dir);
}

/** Brain deny patterns for harness settings: `<brain>/x` -> `<brainRel>/x`; in a persona the template entries (P-024). */
export function expandBrainPath(p, brainRel) {
  if (!p.startsWith('<brain>')) return [p];
  if (brainRel === PERSONA_BRAIN) return p === '<brain>/**' ? [...BRAIN_ENTRIES] : [p.slice('<brain>/'.length)];
  return [`${brainRel}${p.slice('<brain>'.length)}`];
}

/** True when abs lies in a directory a persona agent may write directly (scratch/, local/). */
export function personaWritable(ctx, abs) {
  return !!ctx.brainInfo?.persona && PERSONA_WRITABLE.some((d) => isInside(path.join(ctx.projectDir, d), abs));
}

export const BRAIN_COMMIT_TAG = '[brain-script]';
export const BRAIN_SCRIPT_ENV = 'WORKFLOW_BRAIN_SCRIPT';
/** Env for git in brain: script tag plus the root of the running plugin, so the brain hooks check with the same version (stable or dev). */
export function brainScriptEnv() {
  return { [BRAIN_SCRIPT_ENV]: '1', WORKFLOW_PLUGIN_ROOT: PLUGIN_ROOT };
}

/** Project root: explicit, CLAUDE_PROJECT_DIR, git toplevel of cwd, or cwd. */
export function resolveProject(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.WORKFLOW_PROJECT_DIR) return path.resolve(process.env.WORKFLOW_PROJECT_DIR);
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  return gitToplevel(process.cwd()) || process.cwd();
}

/** Read .workflow.json and local/workflow.json. Returns { brainRel, brain, source } or null when config is missing. */
export function resolveBrain(projectDir) {
  const localFile = path.join(projectDir, LOCAL_CONFIG);
  const mainFile = path.join(projectDir, WORKFLOW_CONFIG);
  let cfg = null;
  let source = null;
  if (fs.existsSync(localFile)) {
    cfg = readJson(localFile, {});
    source = LOCAL_CONFIG;
  }
  if (!cfg || typeof cfg.brain !== 'string') {
    if (fs.existsSync(mainFile)) {
      cfg = readJson(mainFile, {});
      source = WORKFLOW_CONFIG;
    }
  }
  if (!cfg || typeof cfg.brain !== 'string') return null;
  if (path.isAbsolute(cfg.brain) || /^[A-Za-z]:[\\/]/.test(cfg.brain)) {
    return { error: `absolute brain path is not allowed in ${source} (P-024)`, brainRel: cfg.brain, source };
  }
  if (cfg.brain.replace(/\/+$/, '') === PERSONA_BRAIN) return { brainRel: PERSONA_BRAIN, brain: mainCheckout(projectDir), source, persona: true };
  return { brainRel: cfg.brain, brain: path.resolve(projectDir, cfg.brain), source };
}

/** Ensure <project>/.workflow.json exists with a relative brain path (P-024). Returns { brainInfo, written }. */
export function ensureWorkflowConfig(projectDir, brainRelArg = null) {
  let brainInfo = resolveBrain(projectDir);
  let written = false;
  if (!brainInfo || brainInfo.error || brainRelArg) {
    const rel = (brainRelArg || brainInfo?.brainRel || `../${path.basename(projectDir)}-brain`).replace(/\\/g, '/');
    if (path.isAbsolute(rel) || /^[A-Za-z]:\//.test(rel)) throw new Error('brain path must be relative to the project root (P-024)');
    // Other keys (comms) are kept; only brain is set.
    const current = readJson(path.join(projectDir, WORKFLOW_CONFIG), {});
    writeJson(path.join(projectDir, WORKFLOW_CONFIG), { ...(current && typeof current === 'object' ? current : {}), brain: rel });
    written = true;
    brainInfo = resolveBrain(projectDir);
  }
  return { brainInfo, written };
}

/** Merged workflow configuration: .workflow.json with local/workflow.json on top (shallow). Never throws. */
export function readWorkflowConfig(projectDir) {
  const main = readJson(path.join(projectDir, WORKFLOW_CONFIG), {});
  const local = readJson(path.join(projectDir, LOCAL_CONFIG), {});
  const cfg = { ...(main && typeof main === 'object' ? main : {}), ...(local && typeof local === 'object' ? local : {}) };
  return cfg;
}

export function brainExists(brainDir) {
  return !!brainDir && fs.existsSync(path.join(brainDir, 'topics')) && fs.existsSync(path.join(brainDir, '.git'));
}

export function loadPolicy(brainDir) {
  const base = readJson(path.join(PLUGIN_ROOT, 'policy', 'policy.json'));
  if (brainDir) {
    const extra = readJson(path.join(brainDir, 'policy.json'), {});
    return deepMerge(base, extra);
  }
  return base;
}

function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object' || !a || !b) return b ?? a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? deepMerge(a[k], v) : v;
  return out;
}

/** Stable thread identity (P-038). */
export function threadId() {
  return process.env.WORKFLOW_THREAD_ID || process.env.T3CODE_THREAD_ID || null;
}

/** Subagent detection for scripts started from the model's shell (P-025). Hooks pass agent_id explicitly. */
export function inSubagent() {
  return !!(process.env.WORKFLOW_AGENT_ID || process.env.CLAUDE_AGENT_ID);
}

export function machineName() {
  return os.hostname();
}

/** Thread state file in <brain>/local/threads/<id>.json (P-047 turn source, pending signals). */
export function threadStateFile(brainDir, id) {
  return path.join(brainDir, 'local', 'threads', `${id}.json`);
}

export function readThreadState(brainDir, id) {
  if (!brainDir || !id) return { thread: id, turn_source: 'operator', pending_signals: [] };
  const state = readJson(threadStateFile(brainDir, id), null) || {};
  return { thread: id, turn_source: 'operator', pending_signals: [], ...state };
}

export function writeThreadState(brainDir, id, state) {
  if (!brainDir || !id) return;
  writeJson(threadStateFile(brainDir, id), { ...state, thread: id, updated: new Date().toISOString() });
}

export function isWakeTurn(brainDir, id) {
  return readThreadState(brainDir, id).turn_source === 'wake';
}

/** Full context for scripts: project, brain, policy, thread. */
export function loadContext({ project, requireBrain = true } = {}) {
  const projectDir = resolveProject(project);
  const brainInfo = resolveBrain(projectDir);
  const brainDir = brainInfo && !brainInfo.error ? brainInfo.brain : null;
  const ok = brainExists(brainDir);
  if (requireBrain && !ok) {
    const reason = !brainInfo
      ? `missing ${WORKFLOW_CONFIG} in ${projectDir}`
      : brainInfo.error || `brain not found at ${brainInfo.brainRel}`;
    throw new Error(`brain unavailable: ${reason}`);
  }
  return {
    projectDir,
    projectName: path.basename(projectDir),
    brainDir: ok ? brainDir : null,
    brainInfo,
    persona: !!brainInfo?.persona,
    config: readWorkflowConfig(projectDir),
    policy: loadPolicy(ok ? brainDir : null),
    thread: threadId(),
    pluginRoot: PLUGIN_ROOT,
  };
}

export function pluginInstallDir() {
  return process.env.WORKFLOW_PLUGIN_ROOT || path.join(os.homedir(), '.claude', 'skills', PLUGIN_NAME);
}
