---
name: error
description: Použi po každej chybe (vždy ju aj nahlásiš správcovi workflow) – operátor hlási „nefunguje to“ / „to je chyba“, príkaz zlyhá druhýkrát, pracovník vrátil neprázdne „Failures“, alebo si tvrdil niečo nepravdivé. Chyba sa stáva skillom alebo pravidlom.
argument-hint: "[list | check <tool> | resolve <n>]"
---

# error – chyba sa stáva skillom (P-003, P-028)

1. Oprav chybu a nájdi postup, ktorý funguje; over ho jedným úspešným spustením (P-020).
2. Zisti, kam poučenie patrí: chyba nástroja alebo postupu → skill; chyba správania agenta (nevyžiadaná zmena, neoverené tvrdenie) → pravidlo (`save rule`). Zopakovaná nespoľahlivosť (aspoň 2×, aj napriek skillu či pravidlu) → kód, ktorý ju vynúti bez agenta (hook s rozhodnutím, skript, služba); oznám to správcovi workflow (P-015).
3. `node ${CLAUDE_PLUGIN_ROOT}/bin/error.mjs check "<nástroj alebo druh práce>"` – ak skill existuje, doplň ho; nový nevytváraj. Doplnok: `--content` iba nové kroky; opravené celé telo: `--replace`.
nie celý skill v `--content` bez `--replace`, lebo save ho pripojí pod „## Doplnenie“ a skill bude dvakrát (alice 2026-11-02).
4. Ulož cez `workflow:save`: `save.mjs skill <name> --description "Použi, keď ..." --origin error --content "<funkčný postup>\nnie <zlý spôsob>, lebo <prečo>"`. Popis je trigger formulovaný situáciou. Ak sa chyba zopakovala napriek skillu, oprav trigger alebo kroky.
5. Nahlás chybu správcovi workflow (skill `workflow:comms`): `send --to maintainer/workflow-dev --level assist --text "chyba: <čo sa stalo>; príčina: <prečo>; uložené: <skill/pravidlo>"`. Úroveň je vždy `assist` (`info` je zrušená, 2026-11-02). Hlási sa každá chyba, aj opravená; samotné „moja chyba bola…“ operátorovi nestačí, lebo z poučenia v jednom brain sa nikto iný nedozvie. Ak držíš tému `workflow-dev`, chybu rieš priamo v nej.
6. Zlyhania pracovníkov a opakované zlyhania príkazov sú v `error.mjs list`; po spracovaní `error.mjs resolve <n>`.

Nie zoznam chýb, ale prevencia v skille. Skilly z chýb sa nemažú podľa veku.
