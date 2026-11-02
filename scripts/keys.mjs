// Key normalization (P-031, P-049): lowercase, no diacritics, hyphens.

export const KEY_TYPES = ['operator', 'project', 'service', 'tool', 'person', 'environment'];

export function normalizeKey(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function hasDiacritics(text) {
  return /[^\x00-\x7F]/.test(String(text));
}

export function isValidId(id) {
  return /^[a-z0-9][a-z0-9-]*$/.test(String(id));
}

export function makeKey(type, name) {
  if (!KEY_TYPES.includes(type)) throw new Error(`unknown key type "${type}" (allowed: ${KEY_TYPES.join(', ')})`);
  const n = normalizeKey(name);
  if (!n) throw new Error('empty name');
  return `${type}-${n}`;
}

export function tokens(text) {
  return normalizeKey(text).split('-').filter((t) => t.length > 1);
}
