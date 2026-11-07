// Claude Code's built-in privacy check asks the operator when a shell or web call holds the account email next to a
// network word; the workflow tells the agent first, once per identical call (2026-11-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './helpers.mjs';
import { accountEmailCall } from '../hooks/pre-tool-use.mjs';

const MAIL = 'owner@example.test';

test('account email next to a network word is flagged like the built-in check', () => {
  assert.equal(accountEmailCall('Bash', { command: `printf 'To: ${MAIL}' | ssh -T r@x` }, MAIL), true);
  assert.equal(accountEmailCall('Bash', { command: `cat > a.py <<'EOF'\nH="http://127.0.0.1"\nTO="Owner@Example.test"\nEOF` }, MAIL), true);
  assert.equal(accountEmailCall('WebFetch', { url: `https://x.test/?m=owner%40example.test` }, MAIL), true);
  assert.equal(accountEmailCall('Bash', { command: `sed -i 's/${MAIL}/x/' a.txt` }, MAIL), false, 'no network word');
  assert.equal(accountEmailCall('Bash', { command: 'ssh r@x uptime' }, MAIL), false, 'no email');
  assert.equal(accountEmailCall('Write', { file_path: 'a.py', content: `H="https://x"\n${MAIL}` }, MAIL), false, 'Write is not checked');
  assert.equal(accountEmailCall('Bash', { command: `ssh r@x ${MAIL}` }, ''), false, 'no signed-in email');
});

test('hook denies the first call and lets the same call through on retry', () => {
  const fx = setup();
  try {
    const cfg = path.join(fx.root, 'cfg');
    fs.mkdirSync(cfg);
    fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: MAIL } }));
    const call = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `curl -d 'to=${MAIL}' http://127.0.0.1:9/x` } };
    const first = fx.hook('pre-tool-use.mjs', call, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(first.json.hookSpecificOutput?.permissionDecision, 'deny', first.stderr);
    assert.match(first.json.hookSpecificOutput.permissionDecisionReason, /account email/);
    const again = fx.hook('pre-tool-use.mjs', call, { env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.doesNotMatch(JSON.stringify(again.json), /account email/);
  } finally { fx.cleanup(); }
});
