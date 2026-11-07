// P-059: a reply that ends with a check-in question ("mám začať?") is blocked once at Stop; real blockers pass on the second stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { checkInQuestion, nextStepClaim } from '../hooks/stop.mjs';

test('checkInQuestion: permission questions that end the reply', () => {
  // alice 2026-11-03: asked before starting the work of the held topic workflow-dev.
  const alice = 'Na zistenie príčiny treba prečítať kód hooku, ktorý dáva pokyn „thread title: rename…“. Mám to zadať pracovníkovi?';
  assert.equal(checkInQuestion(alice), 'Mám to zadať pracovníkovi?');
  for (const t of ['Medzitým môžem postaviť tunel. Začať s tým hneď?', 'Hotové.\n\nMám pokračovať?', 'Chceš, aby som to opravil?', 'Should I proceed with the fix?', 'Want me to run the tests?', '**Mám spustiť zisťovanie na serveri?**', 'Môžem to vydať?'])
    assert.ok(checkInQuestion(t), t);
});

test('checkInQuestion: a Pre teba block that opens with a check-in question counts even when a recommendation follows', () => {
  // alice 2026-11-05: asked whether to fix a bug (the rule says fix it), then wrote the recommendation; the turn ended without the fix.
  const alice = 'Hotové.\n\n**Pre teba:** mám to zaviesť ako chybu a opraviť cez `fix` vo vetve `dev`? Odporúčam áno; začnem tým, že zreprodukujem zamietnutie hookom.';
  assert.match(checkInQuestion(alice) || '', /^mám to zaviesť ako chybu a opraviť cez `fix` vo vetve `dev`\?$/);
  assert.equal(checkInQuestion('Hotové.\n\n**Pre teba:** schváľ port 8080, bez neho služba nenaštartuje.'), null);
  assert.equal(checkInQuestion('Hotové.\n\n**Pre teba:** ktoré heslo patrí k účtu bob@x? Chýba mi.'), null);
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
    // the P-056 shape: question first, recommendation after it (the turn that ended without the fix)
    const pre = 'Hotové.\n\n**Pre teba:** mám to opraviť? Odporúčam áno; začnem tým, že to zreprodukujem.';
    assert.equal(fx.hook('stop.mjs', { stop_hook_active: false, last_assistant_message: pre }).json.decision, 'block');
    assert.equal(fx.hook('stop.mjs', { stop_hook_active: true, last_assistant_message: pre }).json.decision, undefined);
  } finally { fx.cleanup(); }
});

test('nextStepClaim: a reply that announces a next step is found; plain text is not', () => {
  assert.match(nextStepClaim('Hotové.\n\nVerifikáciu v pilote robím ako ďalší krok, potom vydanie.') || '', /ďalší krok/);
  assert.match(nextStepClaim('Done. The next step is the release.') || '', /next step/);
  assert.ok(nextStepClaim('Ďalší krok: vydanie.'));
  assert.ok(nextStepClaim('- Ďalším krokom je pilot.'));
  // a sentence that only describes the guard is not an announcement (false positive 2026-11-05)
  // quoted examples and code are not announcements (false positive 2026-11-05)
  assert.equal(nextStepClaim('Hook zablokuje len oznámenie, napríklad „robím ako ďalší krok“ alebo „Ďalší krok: x“, a `next step is` v kóde.'), null);
  for (const t of ['Hotové, vydané ako v0.9.6.', '', undefined, '- Nezapísaný krok: hook zablokuje odpoveď, ktorá pomenuje ďalší krok, ak handover žiadny nemá.', 'The hook blocks a reply that names a next step without a handover.'])
    assert.equal(nextStepClaim(t), null, String(t));
});
