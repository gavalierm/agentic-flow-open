// P-059: a reply that ends with a check-in question ("mám začať?") is blocked once at Stop; real blockers pass on the second stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { checkInQuestion } from '../hooks/stop.mjs';

test('checkInQuestion: permission questions that end the reply', () => {
  // alice 2026-11-03: asked before starting the work of the held topic workflow-dev.
  const alice = 'Na zistenie príčiny treba prečítať kód hooku, ktorý dáva pokyn „thread title: rename…“. Mám to zadať pracovníkovi?';
  assert.equal(checkInQuestion(alice), 'Mám to zadať pracovníkovi?');
  for (const t of ['Medzitým môžem postaviť tunel. Začať s tým hneď?', 'Hotové.\n\nMám pokračovať?', 'Chceš, aby som to opravil?', 'Should I proceed with the fix?', 'Want me to run the tests?', '**Mám spustiť zisťovanie na serveri?**', 'Môžem to vydať?'])
    assert.ok(checkInQuestion(t), t);
});

test('checkInQuestion: statements, blocker questions on facts, and questions mid-reply pass', () => {
  for (const t of ['Hotové, vydané ako v0.8.2.', 'Aký konkrétny problém máš na mysli?', 'Ktoré heslo patrí k účtu bob@x?', 'Mám pokračovať? Pokračujem, je to v zadaní.', '', undefined, 'Mámut je zviera?', 'Ako sa volá server?'])
    assert.equal(checkInQuestion(t), null, String(t));
});

test('Stop hook: check-in question blocks once with the P-059 reason; the second stop passes; a bell turn is not blocked', () => {
  const fx = setup();
  try {
    fx.hook('user-prompt-submit.mjs', { prompt: 'oprav to' });
    const msg = 'Príčina je asi v hooku. Mám to zadať pracovníkovi?';
    const first = fx.hook('stop.mjs', { stop_hook_active: false, last_assistant_message: msg }).json;
    assert.equal(first.decision, 'block');
    assert.match(first.reason, /check-in question: "Mám to zadať pracovníkovi\?".*P-059.*do it now/);
    assert.deepEqual(fx.hook('stop.mjs', { stop_hook_active: true, last_assistant_message: msg }).json.decision, undefined);
    assert.equal(fx.hook('stop.mjs', { stop_hook_active: false, last_assistant_message: 'Hotové.' }).json.decision, undefined);
  } finally { fx.cleanup(); }
});
