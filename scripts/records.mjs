// Reading brain records (memory, decisions, rules, skills, topics) into a uniform shape (P-031, P-039).
import fs from 'node:fs';
import path from 'node:path';
import { listFiles, readJson, readText, relPosix } from './util.mjs';
import { parseFrontmatter, asList } from './frontmatter.mjs';
import { normalizeKey } from './keys.mjs';
import { handoverNextStep } from './brain-checks.mjs';

function summary(data, body) {
  const s = data.summary || data.description || data.title;
  if (s) return String(s);
  const line = String(body || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  return line || '';
}

function record(brainDir, file, kind) {
  const text = readText(file, '');
  const { data, body } = parseFrontmatter(text);
  const rel = relPosix(brainDir, file);
  const name = data.name || data.title || path.basename(path.dirname(file) === path.join(brainDir, 'memory') ? file : file, '.md');
  return {
    path: rel,
    kind,
    key: String(data.key || (kind === 'skill' ? data.name || path.basename(path.dirname(file)) : path.basename(file, '.md'))),
    type: data.type || null,
    name: String(name),
    aliases: asList(data.aliases).map(String),
    relates_to: asList(data.relates_to).map(String),
    origin: data.origin || null,
    status: data.status || null,
    id: data.id || null,
    title: data.title || null,
    description: summary(data, body).slice(0, 160),
    data,
    body,
  };
}

export function readMemory(brainDir) {
  return listFiles(path.join(brainDir, 'memory'), (f) => f.endsWith('.md')).map((f) => record(brainDir, f, 'memory'));
}

export function readDecisions(brainDir) {
  return listFiles(path.join(brainDir, 'decisions'), (f) => f.endsWith('.md')).map((f) => record(brainDir, f, 'decision'));
}

export function readRules(brainDir) {
  return listFiles(path.join(brainDir, 'rules'), (f) => f.endsWith('.md')).map((f) => record(brainDir, f, 'rule'));
}

export function readSkills(brainDir) {
  const out = [];
  for (const owner of ['operator', 'agentic']) {
    const dir = path.join(brainDir, 'skills', owner);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const r = record(brainDir, file, 'skill');
      r.owner = owner;
      r.skillName = String(r.data.name || entry.name);
      r.key = r.skillName;
      out.push(r);
    }
  }
  return out;
}

export function readTopics(brainDir, { archived = false } = {}) {
  const dir = archived ? path.join(brainDir, 'topics', 'archive') : path.join(brainDir, 'topics');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || (!archived && entry.name === 'archive')) continue;
    const tdir = path.join(dir, entry.name);
    const topic = readJson(path.join(tdir, 'topic.json'), null);
    if (!topic) continue;
    const holder = readJson(path.join(tdir, 'holder.json'), {}) || {};
    const handover = readText(path.join(tdir, 'handover.md'), '');
    out.push({ id: entry.name, ...topic, holder, next: handoverNextStep(handover), handover });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function allRecords(brainDir) {
  return [...readMemory(brainDir), ...readDecisions(brainDir), ...readRules(brainDir), ...readSkills(brainDir)];
}

export function nextDecisionId(brainDir) {
  let max = 0;
  for (const d of readDecisions(brainDir)) {
    const m = /^D-(\d+)$/.exec(String(d.id || d.key || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `D-${String(max + 1).padStart(4, '0')}`;
}

export function normalizedNames(r) {
  return new Set([r.key, r.name, r.title, ...r.aliases].filter(Boolean).map((v) => normalizeKey(v)));
}
