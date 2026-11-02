---
name: save
description: Použi vždy, keď sa má niečo uložiť do brain – operátor povie „ulož“, „zapamätaj si“, „volám sa…“, „páči sa mi to“, alebo workflow vyžaduje zápis (rozhodnutie, handover, výnimka, skill z chyby alebo rutiny). Jediný vstupný bod zápisu.
argument-hint: "[memory|decision|rule|exception|skill|handover] ..."
---

# save – jeden vstupný bod zápisu (P-013, P-007)

Zápis do brain ide výlučne cez `node ${CLAUDE_PLUGIN_ROOT}/bin/save.mjs`. Write/Edit do brain sú zakázané.

## 1. Klasifikácia (tvoj úsudok, v tomto poradí, prvá zhoda vyhráva)
1. Postup (kroky, ako niečo urobiť) → `skill`
2. Mení správanie agenta (MUSÍ/NESMIE, „odteraz rob…“) → `rule`; ak operátor mení platný princíp → `exception`
3. Voľba medzi alternatívami → `decision`
4. Obsah s hodnotou sám o sebe (zoznam, text, výstup pátrania) → dokument v projekte, nie brain (bez save)
5. Stav nedokončenej práce → `handover`
6. Inak opisný fakt o subjekte → `memory`

Pri nejednoznačnosti sa opýtaj operátora, nehádaj. „Toto ulož“ = posledný výstup agenta, ak nie je jasné, opýtaj sa.

## 2. Zápis (skript, deterministicky)
- `save.mjs memory <type> <name> --content "..." [--origin operator|derived|observed] [--aliases a,b] [--relates-to x] [--sources f1,f2]`
  typy: operator, project, service, tool, person, environment. Kľúč `<type>-<name>` tvorí skript; existujúci subjekt sa prepisuje. Podobný kľúč skript odmietne a vypíše ho: zvoľ existujúci názov alebo `--new`.
  `derived` vyžaduje `--sources` (odtlačok pre P-009). Zapisuj záver (1–3 vety) a zdroje, nie kópiu zdroja.
- `save.mjs decision "<title>" --what "..." --alternatives "..." --reason "..." --relates-to <súbor|vec>` → ID D-XXXX; uveď ho v commite zmeny. Nahradenie: `--supersedes D-XXXX`.
- `save.mjs rule <name> --content "..."` (pravidlo projektu, krátke, normatívne: iba MUSÍ/NESMIE alebo odkaz na skill; kroky a príkazy skript odmietne, patria do skillu, P-007); `--remove --reason "nahradené P-XXX"` zmaže pravidlo projektu, ktoré pokrýva pravidlo workflow (nie duplikát, P-007).
- `save.mjs exception P-XXX --wording "..." --reason "..." [--layer project|harness|machine|local]`; nemenné princípy skript odmietne.
- `save.mjs skill <name> --description "Použi, keď ..." --content "..." --origin error|routine [--from-procedure <n>] [--from-sequence <s>] [--script <súbor>[,<súbor>]]`; `--script` uloží skript (.mjs/.js/.sh, ≤ 64 KB) vedľa SKILL.md v tom istom commite a nasadí sa so skillom; skript zdroj ber z `<projekt>/scratch/` a v texte skillu ho volaj absolútnou cestou, ktorú save vypíše (`script runs as: node <projekt>/.claude/skills/<name>/<skript>`), nie `node <skript>` relatívne; existujúci skill pre ten istý nástroj sa doplní (`--content` je iba doplnok, nie celý skill), nový nevznikne; `--replace` nahradí telo skillu opravenými krokmi (oprava skillu, ktorý naviedol zle). Úprava časti tela: `save.mjs skill <name> --sed 's/<vzor>/<náhrada>/[gim]'` (regex JavaScriptu, `\n` v náhrade = nový riadok; description a origin ostanú; bez zhody nič nezmení), nie awk + `--replace` s opísanou description. `--description` zadaj bez úvodzoviek navyše. Skill operátora sa nemení, iba navrhne.
- `save.mjs handover <topic> --task "..." --done "a; b" --next "..." --files "a; b" --questions "a; b"` (15 riadkov, iba držiteľ témy).

Skript po zápise commitne so značkou, pushne, vygeneruje indexy a hlási `unpushed: N` alebo prekročený limit (vtedy `workflow:consolidate` po dokončení práce).

Príklad: „Volám sa Anna“ → `save.mjs memory operator operator --content "name: Anna"`; druhýkrát ten istý príkaz prepíše záznam.
