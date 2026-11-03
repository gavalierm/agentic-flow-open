// Work never stops (P-057, operator 2026-11-03): "čakám" or an open question ends a turn only with a real waker; the
// Stop hook blocks it once and then arms the timer itself; the timer rings through the closed turn; the question tool is
// denied; the rule texts no longer tell a recipient or a sender to stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setup } from './helpers.mjs';
import { waitingClaim, operatorQuestion, parseDelay, wakerFromTool, validWaker, setTimer, activeTimer } from '../scripts/waker.mjs';
import { updateNotice } from '../scripts/update-notice.mjs';
import { assembleRules } from '../scripts/rules.mjs';

const stateOf = (fx) => JSON.parse(fs.readFileSync(path.join(fx.brain, 'local', 'threads', `${fx.thread}.json`), 'utf8'));

test('waitingClaim: Slovak and English waiting claims, with and without diacritics; code and quotes are data', () => {
  for (const t of ['Poslal som blocker, čakám na odpoveď.', 'Cakam na Carol.', 'Počkám, kým to dobehne.', 'Teraz čakáme na build.', 'Vlákno čaká na operátora.', 'Waiting for the reply.', "I'll wait until it finishes.", 'Zostáva len čakanie na teba, takže tu končím.', 'Potrebujem od teba, čo mám urobiť.', 'Bez tvojho pokynu nič z toho nerobím.', 'Ak to nevyriešiš, čakám na teba.'])
    assert.ok(waitingClaim(t), t);
  for (const t of ['Hotové, vydané.', 'Text `čakám` je v kóde.', 'Hook blokuje slovo „čakám“ bez budíka.', 'Čakanie je zakázané.', 'Tieto frázy sa teraz rátajú ako čakanie na teba.', '- Keď krok čaká na neskoršiu udalosť, hook teraz agentovi káže skončiť.', 'If the step waits for an event, the hook ends the turn.', '```\nčakám\n```', '', undefined])
    assert.equal(waitingClaim(t), null, String(t));
});

test('operatorQuestion, parseDelay, wakerFromTool', () => {
  assert.equal(operatorQuestion('Hotové. Vydať teraz?'), 'Vydať teraz?');
  assert.ok(operatorQuestion('Stav.\n\n**Pre teba:** schváľ port'));
  assert.equal(operatorQuestion('Hotové.'), null);
  assert.equal(parseDelay('30m'), 1_800_000); assert.equal(parseDelay('2h'), 7_200_000); assert.equal(parseDelay('90s'), 90_000); assert.equal(parseDelay('15'), 900_000); assert.equal(parseDelay('soon'), null);
  const now = Date.parse('2026-11-03T10:00:00Z');
  assert.equal(wakerFromTool({ tool_name: 'Bash', tool_input: { command: 'npm test', run_in_background: true } }, now).kind, 'background');
  assert.equal(wakerFromTool({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, now), null);
  assert.equal(wakerFromTool({ tool_name: 'mcp__t3-code__schedule_task', tool_input: {} }, now).kind, 'scheduler');
  assert.equal(wakerFromTool({ tool_name: 'Bash', tool_input: { command: 'node bin/comms.mjs send --level blocker --to x --text y' }, tool_response: { stdout: 'sent m1' } }, now).kind, 'mail');
  assert.equal(wakerFromTool({ tool_name: 'Bash', tool_input: { command: 'node bin/comms.mjs send --reply-to m1 --text y' }, tool_response: { stdout: 'sent m2' } }, now), null, 'a reply wakes nobody');
  const st = { turn_started_at: '2026-11-03T10:00:00Z', wakers: [{ kind: 'background', at: '2026-11-03T09:00:00Z', until: '2026-11-03T09:30:00Z' }] };
  assert.equal(validWaker(st, now), null, 'a waker from an earlier turn that ran out does not count');
  assert.ok(validWaker({ ...st, timer: { at: '2026-11-03T10:30:00Z' } }, now));
});

test('Stop: "čakám" without a waker is blocked with the timer command; ending anyway arms the timer; a timer lets it pass', () => {
  const fx = setup();
  try {
    fx.hook('user-prompt-submit.mjs', { prompt: 'oprav to' });
    const msg = 'Poslal som otázku Carol, čakám na odpoveď.';
    const first = fx.hook('stop.mjs', { stop_hook_active: false, last_assistant_message: msg }).json;
    assert.equal(first.decision, 'block');
    assert.match(first.reason, /says it waits \("čakám na odpoveď\./);
    assert.match(first.reason, /bin\/timer\.mjs --in <minutes>m --then/);
    assert.match(first.reason, /without a timer is forbidden/);
    assert.equal(fx.hook('stop.mjs', { stop_hook_active: true, last_assistant_message: msg }).json.decision, undefined);
    const st = stateOf(fx);
    assert.ok(activeTimer(st), 'the Stop hook armed the timer itself');
    assert.equal(st.timer.auto, true);
    assert.equal(st.auto_timer_n, 1);
    // A timer armed in the turn lets the waiting end pass.
    fx.hook('user-prompt-submit.mjs', { prompt: 'ďalej' });
    assert.equal(stateOf(fx).timer, undefined, 'an operator prompt clears the timer');
    setTimer(fx.brain, fx.thread, { delayMs: 30 * 60_000, then: 'check the reply' });
    assert.equal(fx.hook('stop.mjs', { stop_hook_active: false, last_assistant_message: msg }).json.decision, undefined);
    // A bell turn is held to it too: a message never stops the work.
    fx.hook('user-prompt-submit.mjs', { prompt: 'ďalej' });
    const f = path.join(fx.brain, 'local', 'threads', `${fx.thread}.json`);
    fs.writeFileSync(f, JSON.stringify({ ...stateOf(fx), turn_source: 'wake' }));
    assert.equal(fx.hook('stop.mjs', { stop_hook_active: false, last_assistant_message: 'Steer prijatý, práca zastavená. Čakám na pokyn.' }).json.decision, 'block');
  } finally { fx.cleanup(); }
});

test('UserPromptSubmit: a fired timer names its step; the update notice re-injects the rules once', () => {
  const fx = setup();
  try {
    fx.hook('user-prompt-submit.mjs', { prompt: 'začni' });
    const f = path.join(fx.brain, 'local', 'threads', `${fx.thread}.json`);
    fs.writeFileSync(f, JSON.stringify({ ...stateOf(fx), timer: { at: new Date(Date.now() - 1000).toISOString(), then: 'check the reply to m7', set_at: new Date(Date.now() - 900_000).toISOString() } }));
    const r = fx.hook('user-prompt-submit.mjs', { prompt: 'turn ended with a next step, continue from handover' });
    assert.match(r.context, /timer fired .*: check the reply to m7/);
    assert.equal(stateOf(fx).timer, undefined);
  } finally { fx.cleanup(); }
  assert.equal(updateNotice({ plugin_sha: 'aaa' }, { sha: 'aaa', version: '1' }), null);
  const n = updateNotice({ plugin_sha: 'aaa' }, { sha: 'bbb', version: '2' }, () => ['comms', 'topic']);
  assert.ok(n.line); assert.equal(n.patch.plugin_sha, 'bbb');
  // Tokens (operator 2026-11-03): only the changed skills are named; none changed says so; no diff falls back to all.
  assert.match(n.line, /changed skills: comms, topic: read one again/);
  assert.match(updateNotice({ plugin_sha: 'aaa' }, { sha: 'bbb' }, () => []).line, /no skill changed/);
  assert.match(updateNotice({ plugin_sha: 'aaa' }, { sha: 'bbb' }, () => null).line, /changed skills: all/);
});

test('PreToolUse: AskUserQuestion is denied (it halts the turn); a subagent is not affected', () => {
  const fx = setup();
  try {
    const r = fx.hook('pre-tool-use.mjs', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }).json;
    assert.equal(r.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /continue with your recommended option.*Pre teba/);
    const hooks = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'hooks', 'hooks.json'), 'utf8'));
    assert.match(hooks.hooks.PreToolUse[0].matcher, /AskUserQuestion/);
  } finally { fx.cleanup(); }
});

test('rule texts: no level and no rule tells an agent to stop the work; the core rules leave room for project rules', () => {
  const rules = assembleRules({ policy: { limits: {} } });
  assert.doesNotMatch(rules.text, /zastaví prácu na nej|\(stojíš\)|AskUserQuestion`, odporúčaná/);
  assert.match(rules.text, /prácu NEZASTAVÍ/);
  // Operator 2026-11-03: rules must not grow without end; a new principle replaces or tightens an old one.
  assert.ok(rules.chars <= 8200, `core rules ${rules.chars} chars > 8200: fold the change into an existing principle`);
});

test('changedSkills: names the skills a real update changed (v0.8.18 -> v0.8.19 changed topic)', async () => {
  const { changedSkills } = await import('../scripts/update-notice.mjs');
  const tags = spawnSync('git', ['tag', '-l', 'v0.8.18', 'v0.8.19'], { cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8' }).stdout.trim().split('\n');
  if (tags.length < 2) return; // shallow clone without the tags
  assert.deepEqual(changedSkills('v0.8.18', 'v0.8.19', path.join(import.meta.dirname, '..')), ['topic']);
  assert.equal(changedSkills('nope1', 'nope2', path.join(import.meta.dirname, '..')), null);
});

test('UserPromptSubmit: an update with unchanged rules sends the update line without the rules block (tokens)', () => {
  const fx = setup();
  try {
    fx.hook('session-start.mjs', { source: 'startup' });
    fx.hook('user-prompt-submit.mjs', { prompt: 'a' });
    const f = path.join(fx.brain, 'local', 'threads', `${fx.thread}.json`);
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.ok(st.rules_hash, 'rules hash recorded');
    fs.writeFileSync(f, JSON.stringify({ ...st, plugin_sha: '0000000', plugin_version: '0.0.1' }));
    const r = fx.hook('user-prompt-submit.mjs', { prompt: 'b' });
    assert.match(r.context, /workflow updated during this session/);
    assert.doesNotMatch(r.context, /Platné pravidlá od tohto ťahu/);
  } finally { fx.cleanup(); }
});

test('operatorQuestion: a P-056 override note (option already taken) is not an open question; a bare blocker is', async () => {
  const { operatorQuestion } = await import('../scripts/waker.mjs');
  assert.equal(operatorQuestion('Hotové.\n\n**Pre teba:** repo „open template“ neexistuje, tak som vybral `agent-playbook`. Ak si myslel iné, napíš.'), null);
  assert.equal(operatorQuestion('Hotové.\n\n**Pre teba:** I took option A; B and C remain.'), null);
  assert.equal(operatorQuestion('**Pre teba:** chýba heslo k účtu, bez neho sa nedá prihlásiť.'), 'Pre teba');
});
