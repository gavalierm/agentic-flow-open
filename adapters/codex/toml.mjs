// Minimal TOML writer and reader for the subset the Codex adapter emits (P-017, P-034): scalars (string, number,
// boolean), nested tables, quoted keys. No arrays of tables, no dates. The reader exists for tests and the
// staleness check; it is not a general TOML parser.

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

function key(k) {
  return BARE_KEY.test(k) ? k : JSON.stringify(k);
}

function scalar(v) {
  if (typeof v === 'string') return JSON.stringify(v); // JSON escapes are valid TOML basic-string escapes
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(scalar).join(', ')}]`;
  throw new Error(`toml: unsupported value ${typeof v}`);
}

function isTable(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/** Object -> TOML text. Scalars of a table come before its sub-tables, so the output is unambiguous. */
export function toToml(obj, prefix = [], out = []) {
  const scalars = Object.entries(obj).filter(([, v]) => !isTable(v));
  const tables = Object.entries(obj).filter(([, v]) => isTable(v));
  if (prefix.length && (scalars.length || !tables.length)) out.push(`[${prefix.map(key).join('.')}]`);
  for (const [k, v] of scalars) out.push(`${key(k)} = ${scalar(v)}`);
  if (scalars.length || (prefix.length && !tables.length)) out.push('');
  for (const [k, v] of tables) toToml(v, [...prefix, k], out);
  return prefix.length ? out : out.join('\n').replace(/\n+$/, '') + '\n';
}

function parseKeyPath(text) {
  const keys = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      if (end === -1) throw new Error(`toml: unterminated quoted key in ${text}`);
      keys.push(text.slice(i + 1, end));
      i = end + 1;
    } else {
      let j = i;
      while (j < text.length && text[j] !== '.') j++;
      const k = text.slice(i, j).trim();
      if (!BARE_KEY.test(k)) throw new Error(`toml: invalid bare key "${k}"`);
      keys.push(k);
      i = j;
    }
    if (text[i] === '.') i++;
    else if (i < text.length) throw new Error(`toml: unexpected character in key ${text}`);
  }
  return keys;
}

function parseValue(raw) {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('"') && v.endsWith('"')) return JSON.parse(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(parseValue) : [];
  }
  throw new Error(`toml: unsupported value ${raw}`);
}

/** TOML text (subset above) -> object. Throws on anything outside the subset or on duplicate tables/keys. */
export function parseToml(text) {
  const root = {};
  let current = root;
  const seenTables = new Set();
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      if (!line.endsWith(']') || line.startsWith('[[')) throw new Error(`toml: unsupported table header ${line}`);
      const pathText = line.slice(1, -1).trim();
      if (seenTables.has(pathText)) throw new Error(`toml: duplicate table [${pathText}]`);
      seenTables.add(pathText);
      current = root;
      for (const k of parseKeyPath(pathText)) {
        if (!(k in current)) current[k] = {};
        else if (!isTable(current[k])) throw new Error(`toml: key ${k} is both value and table`);
        current = current[k];
      }
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) throw new Error(`toml: expected key = value, got ${line}`);
    const keys = parseKeyPath(line.slice(0, eq).trim());
    let target = current;
    for (const k of keys.slice(0, -1)) {
      if (!(k in target)) target[k] = {};
      target = target[k];
    }
    const last = keys[keys.length - 1];
    if (last in target) throw new Error(`toml: duplicate key ${last}`);
    target[last] = parseValue(line.slice(eq + 1));
  }
  return root;
}
