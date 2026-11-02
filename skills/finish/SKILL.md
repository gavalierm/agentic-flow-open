---
name: finish
description: Použi, keď operátor povie „hotovo“, „uzavri to“ alebo jednotka práce skončila; s --topic keď je celá téma hotová a má sa zlúčiť do hlavnej vetvy a archivovať.
argument-hint: "[--topic] --verified \"<pozorovanie>\" [--procedures a,b] [--derivations k1,k2]"
---

# finish – uzavretie jednotky práce alebo témy (P-029, P-005, P-006, P-011, P-020, P-036)

Skript: `node ${CLAUDE_PLUGIN_ROOT}/bin/finish.mjs` (iba držiteľ témy).

## Jednotka práce
1. Over výsledok jedným pozorovaním (spusti, pozri, porovnaj so zadaním). Bez toho skript odmietne; výsledok zapíš do `--verified "<čo si videl>"`.
2. `finish.mjs --list` vypíše existujúce názvy v `procedures.log` a `derivations.log`. Použi existujúci názov, ak zodpovedá.
3. Postupy s viac ako 3 krokmi bez skillu (`find`) uveď v `--procedures <action>-<subject>-<qualifier>,...` (anglicky, bez hodnôt inštancie). Odvodenia z viacerých zdrojov uveď v `--derivations <kľúč>,...`.
4. Skript zapíše logy, handover nastaví na „voľná“, tému na `free`, a vypíše: postup s 3 výskytmi → priprav **návrh** skillu operátorovi (názov, trigger, kroky, skript); sám skill nevytváraj. Odmietnutie ulož ako rozhodnutie s `--relates-to <názov postupu>`. Odvodenie s 2 výskytmi → ulož záver cez `save memory ... --origin derived --sources ...`.
5. Riadok „mail: n waiting (free point)“: odložené správy spracuj ešte pred odpoveďou operátorovi (skill `workflow:comms`, voľný bod).
6. Téma pokračuje: ďalšiu jednotku práce začni hneď v tomto vlákne, nečakaj na operátora (P-026). Novú session navrhni až po `finish --topic`. Vlákno bez témy ukončí jednotku tiež (`finish --verified`, bez handoveru); vlákno bez témy a bez práce v kontexte (napr. po `/clear`) zavrie `finish` bez parametrov, bez otázky operátorovi. V T3 potom archivuj vlákno; tému (ani `main`) nezaberaj iba kvôli `finish`.

## Celá téma: `finish.mjs --topic --verified "..."`
Pred tým presuň trvalé poznatky z handoveru podľa stromu P-007 cez `workflow:save`. Skript pri kódovej téme: v kópii stiahne hlavnú vetvu projektu a zlúči ju (konflikty rieš v kópii a spusti znova), zlúči `topic/<id>` do hlavnej vetvy projektu, zmaže kópiu; potom presunie `topics/<id>/` do `topics/archive/` a tému uzavrie v pošte (nové správy odmietne, čakajúce vráti odosielateľom). V ťahu spustenom správou skript odmietne (P-047). V T3 skript vypíše riadok „thread: … archive this thread“: ako posledný krok ťahu (po odpovediach a oznámení operátorovi) archivuj vlastné vlákno nástrojom `t3_thread_organize` (action `archive`, bez threadId). Vlákno, ktoré drží `main`, sa nearchivuje (skript to povie).
