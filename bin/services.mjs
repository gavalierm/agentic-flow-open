#!/usr/bin/env node
// Installed releases in ~/services (D-0003): the only way they change.
//   services.mjs install <repo dir> [<tag>]   -> ~/services/<repo>/ checked out at the tag (default: latest v* tag)
import { install } from '../scripts/services.mjs';

const [cmd, repo, tag] = process.argv.slice(2);
if (cmd !== 'install' || !repo) {
  console.error('usage: services.mjs install <repo dir> [<tag>]');
  process.exit(2);
}
try {
  const r = install(repo, tag);
  console.log(`installed ${r.name} ${r.tag} in ${r.dir}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
