// Generated local indexes (P-039, P-010, P-022). Never committed: <brain>/local/index/.
import path from 'node:path';
import { writeText } from './util.mjs';
import { readMemory, readDecisions, readRules, readSkills, readTopics } from './records.mjs';

export function topicLine(t) {
  const holder = t.holder?.thread || '-';
  const next = t.next ? `, next: ${t.next}` : '';
  const state = t.state === 'paused' && t.paused_until ? `paused until ${t.paused_until.slice(0, 16)}Z` : t.state || 'working';
  return `${t.id} (${state}, ${holder}${next})`;
}

export function buildIndexes(brainDir, policy) {
  const limits = policy?.limits || {};
  const memory = readMemory(brainDir).map((r) => `- ${r.key}: ${r.description}`);
  const decisions = readDecisions(brainDir).map((r) => `- ${r.id || r.key}: ${r.title || r.description}${r.status && r.status !== 'valid' ? ` [${r.status}]` : ''}`);
  const topics = readTopics(brainDir).map((t) => `- ${topicLine(t)}`);
  const skills = readSkills(brainDir).map((r) => `- ${r.skillName} [${r.owner}]: ${r.description}`);
  const rules = readRules(brainDir).map((r) => `- ${r.path}: ${r.title || r.description}`);
  const text = {
    memory: memory.join('\n') + (memory.length ? '\n' : ''),
    decisions: decisions.join('\n') + (decisions.length ? '\n' : ''),
    topics: topics.join('\n') + (topics.length ? '\n' : ''),
    skills: skills.join('\n') + (skills.length ? '\n' : ''),
    rules: rules.join('\n') + (rules.length ? '\n' : ''),
  };
  const warnings = [];
  if (memory.length > (limits.memory_index_lines ?? 50)) warnings.push(`memory index ${memory.length} lines > ${limits.memory_index_lines} (run consolidate, P-010)`);
  if (decisions.length > (limits.decision_index_lines ?? 50)) warnings.push(`decision index ${decisions.length} lines > ${limits.decision_index_lines} (P-008, P-022)`);
  // The persona main topic (P-045) is permanent and outside the limit.
  const openTopics = readTopics(brainDir).filter((t) => t.kind !== 'main').length;
  if (openTopics > (limits.open_topics_lines ?? 10)) warnings.push(`open topics ${openTopics} > ${limits.open_topics_lines} (P-022)`);
  const skillsChars = skills.join('\n').length;
  if (skillsChars > (limits.skills_list_chars ?? 6000)) warnings.push(`brain skills list ${skillsChars} chars > ${limits.skills_list_chars} (run consolidate, P-003)`);
  const files = {};
  for (const [name, content] of Object.entries(text)) {
    const file = path.join(brainDir, 'local', 'index', `${name}.md`);
    writeText(file, content);
    files[name] = file;
  }
  return { text, files, warnings, counts: { memory: memory.length, decisions: decisions.length, topics: topics.length, skills: skills.length } };
}
