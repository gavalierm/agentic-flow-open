// P-030, P-028: sequences, failures, rotation, signal via Stop -> next prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './helpers.mjs';
import { normalizeCommand, sequencesFrom, rotateLines } from '../scripts/logs.mjs';
import { loadPolicy } from '../scripts/config.mjs';

const policy = loadPolicy(null);

test('normalization: program + first subcommand, compound commands split, read-only commands skipped', () => {
  assert.deepEqual(normalizeCommand('git fetch origin && git rebase -i origin/main && npm test -- --watch', policy), ['git fetch', 'git rebase', 'npm test']);
  assert.deepEqual(normalizeCommand('NODE_ENV=test node bin/x.mjs --flag | head -3', policy), ['node x.mjs', 'head']);
  // Workflow's own scripts never count toward a skill proposal (pilot: `node .../comms.mjs send` + `ack` flagged 5x).
  assert.deepEqual(normalizeCommand('node /root/.claude/skills/workflow/bin/comms.mjs send --level info && node /root/.claude/skills/workflow/bin/comms.mjs ack --id 1', policy), []);
  assert.deepEqual(normalizeCommand('node ${CLAUDE_PLUGIN_ROOT}/bin/topic.mjs claim a', policy), []);
  assert.deepEqual(normalizeCommand('node a.mjs && node b.mjs', policy), ['node a.mjs', 'node b.mjs'], 'different scripts are different procedures');
  assert.deepEqual(normalizeCommand('cd /tmp; ls -la; cat a.txt', policy), ['cd', 'ls', 'cat']);
  assert.deepEqual(sequencesFrom(['a', 'b', 'c'], { min: 2, max: 5 }), ['a+b', 'b+c', 'a+b+c']);
  const old = `${new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10)} x s`;
  const fresh = `${new Date().toISOString().slice(0, 10)} y s`;
  assert.deepEqual(rotateLines([old, fresh], 30), [fresh]);
});

test('third occurrence of a sequence signals once on the next prompt; read-only commands are not counted; failures logged with agent id', () => {
  const fx = setup();
  try {
    const bash = (command, session, extra = {}) => fx.hook('post-tool-use.mjs', { session_id: session, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: 'ok', stderr: '' }, ...extra });
    for (const s of ['s1', 's2', 's3']) {
      bash('git status', s);
      bash('git fetch origin && git rebase origin/main', s);
      bash('npm test', s);
      bash('cat README.md', s);
      const stop = fx.hook('stop.mjs', { session_id: s, stop_hook_active: false });
      assert.deepEqual(stop.json, {}, 'Stop never prolongs the turn');
    }
    const log = fx.read('logs/sequences.log');
    assert.equal(log.split('\n').filter((l) => l.includes(' git-fetch+git-rebase+npm-test ')).length, 3);
    assert.doesNotMatch(log, /git-status|cat/);
    const prompt = fx.hook('user-prompt-submit.mjs', { prompt: 'ďalej' });
    assert.equal(prompt.context.split('\n').length, 2);
    assert.match(prompt.context.split('\n')[1], /sequence git-fetch\+git-rebase\+npm-test 3x/);
    assert.equal(fx.hook('user-prompt-submit.mjs', { prompt: 'ďalej' }).context.split('\n').length, 1, 'signal once');
    assert.match(fx.git(fx.brain, 'log', '--format=%s', '-1', '--', 'logs/sequences.log'), /^\[brain-script\] logs flush s3$/);
    // failures from a subagent
    fx.hook('post-tool-use.mjs', { session_id: 's4', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'curl -H x https://api.example' }, error: 'Exit code 22\n401 Unauthorized', agent_id: 'sub9' });
    fx.hook('stop.mjs', { session_id: 's4' });
    assert.match(fx.read('logs/failures.log'), /sub9 s4 curl -H x .* :: Exit code 22/);
    assert.match(fx.run('error.mjs', ['list']).stdout, /1\. .*sub9/);
    assert.equal(fx.run('error.mjs', ['resolve', '1']).status, 0);
    assert.equal(fx.read('logs/failures.log').trim(), '');
    // P-003 step 5: every error is reported to the workflow maintainer
    assert.match(fx.run('error.mjs', ['check', 'curl']).stdout, /report the error to the workflow maintainer: comms send --to maintainer\/workflow-dev/);
    // the maintainer's own thread is not told to mail itself
    assert.equal(fx.run('topic.mjs', ['create', 'workflow-dev', '--subject', 'Workflow']).status, 0);
    assert.match(fx.run('error.mjs', ['check', 'curl']).stdout, /this thread holds workflow-dev: do not mail the report to yourself/);
  } finally { fx.cleanup(); }
});

test('rotation: sequences older than 30 days are dropped; failures older than 7 days raise a signal', () => {
  const fx = setup();
  try {
    const old = new Date(Date.now() - 31 * 864e5).toISOString();
    assert.equal(fx.run('brain.mjs', ['write', 'logs/sequences.log', '--message', 'seed', '--content', `${old.slice(0, 10)} a+b s0\n`]).status, 0);
    assert.equal(fx.run('brain.mjs', ['write', 'logs/failures.log', '--message', 'seed', '--content', `${new Date(Date.now() - 8 * 864e5).toISOString()} main s0 curl :: 500\n`]).status, 0);
    fx.hook('post-tool-use.mjs', { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm ci && npm test' }, tool_response: { stdout: '' } });
    fx.hook('stop.mjs', { session_id: 's1' });
    assert.doesNotMatch(fx.read('logs/sequences.log'), /a\+b/);
    assert.match(fx.read('logs/sequences.log'), /npm-ci\+npm-test/);
    const prompt = fx.hook('user-prompt-submit.mjs', { prompt: 'x' });
    assert.match(prompt.context, /1 unprocessed failure\(s\) older than 7 days/);
    assert.ok(!fs.existsSync(path.join(fx.brain, 'local', 'log-buffer', 's1.jsonl')), 'buffer cleared after flush');
  } finally { fx.cleanup(); }
});

test('P-030: quoted text, heredoc bodies and reading commands are not sequence steps', async () => {
  const { normalizeCommand, isReadonly } = await import('../scripts/logs.mjs');
  const policy = JSON.parse(fs.readFileSync(new URL('../policy/policy.json', import.meta.url)));
  const steps = (c) => normalizeCommand(c, policy).filter((x) => !isReadonly(x, policy));
  assert.deepEqual(steps(`cd /x && git add -A && git commit -q -m "a; the b\n\nc; d" && git push`), ['git add', 'git commit', 'git push']);
  assert.deepEqual(steps(`grep -n x f; cd y && sed -n 1,5p a && sed -i s/a/b/ f`), ['sed']);
  assert.deepEqual(steps(`python3 - <<EOF\nimport x; the=1\nEOF\nnpm test`), ['python3', 'npm test']);
  // shell keywords are syntax, text filters only read (Bob 2026-11-03: `for+echo`, `tr+echo` proposed as skills)
  assert.deepEqual(steps('for f in a b; do echo $f; npm test; done'), ['npm test']);
  assert.deepEqual(steps('if [ -f x ]; then rm x; fi; while read l; do printf "%s" $l | cut -c1-5 | tr a b; done < f'), ['rm']);
});

test('sequence normalization skips shell groups and keeps the program of $(...) assignments', async () => {
  const { normalizeCommand } = await import('../scripts/logs.mjs');
  assert.deepEqual(normalizeCommand('out=$(npm test 2>&1) || { echo x; exit 1; }; ls', { logs: { subcommand_programs: ['npm'] } }), ['npm test', 'echo', 'ls']);
});
