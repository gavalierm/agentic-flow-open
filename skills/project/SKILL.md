---
name: project
description: Použi, keď operátor povie „spusti nový projekt“, „založ projekt“, „prevezmi projekt“ alebo „obnov projekt“, aj keď chce starý projekt (vlastná štruktúra, iný brain) previesť do T3 a do workflow.
argument-hint: "probe <meno> | restore <meno> | connect <meno> [--repo <repo>] [--brain <repo>] [--rename-brain] [--adopt] [--brain-branch <b>] | create <meno> [--repo <repo>] --purpose \"...\" | inventory <dir> | tidy --project <dir> --plan <file>"
---

# project – spustenie, obnova a prevzatie projektu (P-024, P-018, P-002)

Skript: `node ${CLAUDE_PLUGIN_ROOT}/bin/project.mjs`. Sprievodca (vetvy `adopt` a `create`) sa pýta dialógom: na začiatku `wizard start <meno>` otvorí okno (2 h), v ktorom hook pustí `AskUserQuestion` v ťahu operátora; na konci `wizard end`. Súhrn, zoznam a návrh píš textom do odpovede; dialóg iba kladie otázku s krátkymi voľbami, nie súhrn v náhľade voľby (operátor ho nevidí, 2026-11-04). Mimo okna hook dialóg zamietne a otázky idú textom pod `**Pre teba:**` (P-056). Repozitáre sú vždy pod GitHub účtom operátora (token operátora); priečinok projektu je `~/agentic/<meno>/`: v ňom kódové repozitáre `<meno>-<časť>` (napr. `mojprojekt-web`, každé je projekt T3) a jeden spoločný brain `<meno>-brain`. Staršie projekty ležia priamo v `~/agentic` (`<repo>` vedľa `<repo>-brain`); `restore` ich obnoví, presun robí operátor neskôr.

## 1. Zistenie stavu (bez otázok)
`probe <kmeň>` (napr. `mojprojekt`) vypíše priečinky na disku a repozitáre operátora s týmto kmeňom v názve, každý s druhom (`workflow-project`, `workflow-brain`, `legacy`, `code`, `empty`) a navrhne vetvu. K tomu sám over T3: `t3_project_list`, projekt s priečinkom v `~/agentic/<meno>/`. Stopy v brainoch iných agentov (témy, handovery s menom projektu) daj vyhľadať pracovníkovi (`workflow:delegate`); priečinky iných používateľov čítaj iba cez Bob (`@bob/main`), nie sudo.

## 2. Vetva podľa `branch`
- `restore` (projekt workflow je na disku): `restore <meno>`; ak niektoré repo nie je v T3, založ projekt v T3 (`t3_project_create`, priečinok repa) a dôveru (`hasTrustDialogAccepted` v `~/.claude.json`). Bez otázok; na konci jeden riadok, čo bolo treba obnoviť.
- `connect` (repozitáre v našom formáte alebo čistý kód): ukáž zoznam (meno, súkromné, posledný push, popis) s návrhom, ktoré repo je projekt a ktoré brain, pod `**Pre teba:**` (P-056); spoj až po potvrdení operátora. Potom `connect <projekt> --repo <repo> [--brain <repo>] [--rename-brain]`, T3 projekt (priečinok repa) a dôvera. Bez brain repa skript použije `<projekt>-brain`, ak existuje, inak ho založí; ďalšie repo projektu pripojíš rovnako a zdieľa ten istý brain.
- `adopt` (starý projekt): brainstorming nižšie.
- `create` (nič neexistuje): sprievodca nižšie.

## 3. Prevzatie starého projektu (brainstorming s operátorom)
Najprv `wizard start <meno>`. Každá fáza končí rozhodnutím operátora: návrh s dôvodom a jedna otázka dialógom (`AskUserQuestion`, odporúčaná voľba prvá, nanajvýš 4 otázky naraz). Nič sa nepresúva, nemaže ani nepremenúva pred súhlasom operátora so súhrnom vo fáze 7 (P-018). Priebeh a návrhy si píš do `scratch/adopt-<meno>.md` (po fázach, čo operátor zmenil), aby sa sedenie dalo prerušiť.
1. **Inventúra:** naklonuj repá na prezretie do `scratch/` a `inventory <dir>` pre každé repo (skupiny: rules, memory, decisions, skills, errors, data, infra, scratch; mŕtve absolútne cesty). Obsah textov prečíta pracovník a vráti ku každej položke jeden riadok: čo to je, či ešte platí.
2. **Čo je projekt dnes:** navrhni jednu vetu účelu a stav (aktívny, údržba, hotový); operátor potvrdí alebo opraví.
3. **Vedomosti po skupinách:** ku každej položke navrhni cieľ s dôvodom: pravidlo (`save rule`), pamäť (`save memory`), rozhodnutie (`save decision`, pôvodné ID a dátum do textu), skill (`save skill`), dáta (ostanú ako súbor), preč (balast: mŕtve cesty, kópie šablón, starý mechanizmus). Na skupinu jedna otázka dialógom: čo ostáva a čo pôjde preč. Nejasné položky dopytuj (grill): platí to ešte, kto to dnes robí, odkiaľ to je.
4. **Dáta a podklady:** dizajny, podklady klienta, snímky: repo projektu alebo brain; operátor vyberie.
5. **Spojenie:** brain repo sa pripojí v tom istom repe (história ostane), premenuje sa na `<projekt>-brain` (`--rename-brain`, staré meno presmeruje GitHub); vetvu s aktuálnym obsahom brainu daj `--brain-branch` (main sa na ňu posunie, alebo sa s ňou zlúči, ak main má iba zlučovacie commity; ak má main vlastný obsah, skript skončí a rozhodne operátor).
6. **Stopy u iných agentov:** témy a handovery iných agentov k projektu: navrhni zatvoriť alebo presunúť; pošli to danému agentovi poštou (`workflow:comms`).
7. **Súhrn a jedno potvrdenie:** súhrn textom v odpovedi (čo sa prenesie, čo sa pretvorí, čo pôjde preč, čo sa premenuje, čo je krok navonok), potom jedna otázka dialógom na súhlas.
8. **Vykonanie:** `connect <projekt> --repo <repo> --brain <repo> --rename-brain --adopt [--brain-branch <b>]`, potom záznamy cez `save` s `--project ~/agentic/<projekt>/<repo>`, potom `tidy --project ~/agentic/<projekt>/<repo> --plan scratch/adopt-<projekt>.json` (odstránenia, presuny a `write`: starý záznam prepísaný na mieste vo formáte workflow, napr. rozhodnutie, ktoré sa nemaže; `reason`). Staré súbory v repe projektu (napr. vlastný brain, `CLAUDE.md`) uprac v kódovej téme projektu (`workflow:topic`). Potom T3 projekt a dôvera.
9. **Overenie (P-020):** `find` v novom projekte nájde prenesené záznamy, `rules.mjs --check` prejde, nové vlákno projektu naštartuje so stavovým blokom. Nakoniec `save decision` „prevzatie projektu“: odkiaľ, kedy, čo sa zahodilo a prečo, a `wizard end`.

## 4. Nový projekt (sprievodca)
`wizard start <meno>`, potom otázky dialógom (`AskUserQuestion`, odporúčaná voľba prvá, nanajvýš 4 naraz): meno projektu (návrh z vety operátora), meno prvého repa (`<meno>-web`, `<meno>-app` …), účel jednou vetou, viditeľnosť (súkromné), kto ho vedie a či založiť hlavné vlákno. Súhrn textom v odpovedi a jedno potvrdenie dialógom (nové repozitáre sú krok navonok), potom `create <meno> --repo <repo> --purpose "..."`, `save memory` s účelom, T3 projekt a dôvera, `wizard end`.

Nie repozitár mimo účtu operátora ani iné meno, než potvrdil operátor; nie prepísanie existujúceho priečinka (skript skončí, ukáž čo našiel).
