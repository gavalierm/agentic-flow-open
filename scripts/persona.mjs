// Persona = project whose repository is its brain (P-024). Generated files are committed through the brain script (P-040).
import fs from 'node:fs';
import path from 'node:path';
import { brainWrite } from './brain.mjs';

/** Commit generated files of a persona through the brain script; returns one note line. */
export function commitPersonaFiles({ brainDir, policy, files }) {
  const ops = files
    .filter((rel) => fs.existsSync(path.join(brainDir, rel)))
    .map((rel) => ({ path: rel, content: fs.readFileSync(path.join(brainDir, rel), 'utf8') }));
  try {
    const res = brainWrite({ brainDir, thread: null, policy }, { ops, message: 'adapter: generated files of the persona', internal: true });
    return res.committed ? `persona: generated files committed (${res.sha})${res.warnings.length ? `; ${res.warnings.join('; ')}` : ''}` : 'persona: generated files unchanged';
  } catch (err) {
    return `persona: commit of generated files failed: ${err.message.split('\n')[0]}`;
  }
}
