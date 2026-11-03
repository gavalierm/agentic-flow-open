---
name: topic
description: Použi, keď operátor začína novú samostatnú prácu alebo diskusiu (založ tému), keď treba tému zabrať, uvoľniť, vypísať stav, alebo založiť kópiu kódu pre kódovú tému.
argument-hint: "create <id> --subject \"...\" [--kind code|discussion] [--for-thread <id>] [--here | --new-thread] | main | claim <id> [--mode operator|auto] | thread <id> [--task \"...\"] | release <id> | list | status"
---

# topic – téma ako jednotka práce (P-036, P-037, P-045)

Skript: `node ${CLAUDE_PLUGIN_ROOT}/bin/topic.mjs`.

- `create <id> --subject "<jedna veta>" [--kind code|discussion]` – ID malé písmená, číslice, pomlčky. Vytvorí `topics/<id>/` (topic.json, holder.json, handover.md), zaberie tému pre toto vlákno a pri `--kind code` založí kópiu kódu `../<project>-topics/<id>/` (samostatný klon, vetva `topic/<id>`). Kód kódovej témy meň iba v kópii. V persone kódovú tému zakladaj s `--project <spravovaný projekt>` (bez neho skript odmietne: persona nemá kód projektu, P-025).
- Nová téma v T3: vlákno bez témy (operátor zadal prácu v ňom) ju zaberie samo. Vlákno, ktoré už drží tému (aj `main`), `create <id> --subject "…"` spustí nové vlákno s názvom témy (`t3 thread start`), jeho prvá správa je obsah témy a téma patrí jemu; toto vlákno ju nezaberá. Odkaz na nové vlákno daj operátorovi. `--here` keď operátor chce tému v tomto vlákne, `--new-thread` keď chce nové vlákno. Nie `t3_thread_launch` + `--for-thread`, lebo vlákno potom nemá názov ani obsah témy a operátor ho musí rozbehnúť sám (alice 2026-11-02). Téma, ktorú nikto nedrží (jej vlákno ju nezabralo alebo skončilo), dostane nové vlákno cez `thread <id>` (s `--task`, ak je práca zadaná); nie `t3_thread_send` do cudzieho vlákna (P-055), lebo to je práca iného vlákna bez adresy.
- Operátor tému zakladá s úlohou (čo sa má urobiť, nie iba „založ tému“): pridaj `--task "<zadanie vlastnými slovami, celé>"`; nové vlákno ho vykoná hneď. Nie bez `--task`, lebo vlákno iba vypíše obsah témy a čaká na pokyn, ktorý operátor už dal (operátor 2026-11-02, téma agent-playbook stála).
- `main` – iba hlavné vlákno persony: založí a zaberie trvalú tému `main` a zaregistruje ju v pošte ako `@<persona>/main`. Nezapočítava sa do limitu tém, neponúka sa ako voľná, `finish --topic` ju odmietne. Spusti raz v hlavnom vlákne. Ak `main` drží iné vlákno, zabratie odmietne; nové hlavné vlákno po reštarte ju prevezme iba na pokyn operátora `topic.mjs main --force --operator-approved` (bez `--operator-approved` skript odmietne; commit prevzatie pomenuje). Vlákno témy `main` nikdy nezaberá (ani kvôli `finish`). V ťahu zo správy funguje iba prvé zabratie (téma bez držiteľa), takže stačí o to požiadať poštou na `@<persona>/main`.
- `claim <id>` – zabratie: fetch → kontrola `holder.json` → commit → push. Ak tému drží iné vlákno, skript to oznámi a tému nedostaneš. Prevzatie `claim <id> --force --operator-approved` iba na výslovný pokyn operátora na prevzatie; nečinnosť držiteľa nie je dôvod. Výnimka: tému, ktorú založilo toto vlákno (`created_by`; test, chyba), prevezmeš `claim <id> --force` bez súhlasu a upraceš (`finish --topic`, vlákno archivuj), P-018. Pokyn „zaber tému X“ nie je pokyn na prevzatie: operátorovi povedz, kto tému drží, a spýtaj sa (blocker), či ju prevziať.
- `release <id>` – uvoľnenie držiteľa (téma ostáva otvorená). Tému `main` nikdy neuvoľní (P-045). Ak pošta uvoľnenie neprijme, skript to oznámi a zopakovaním sa uvoľnenie zaregistruje znova.
- `list` – otvorené témy, jeden riadok. `status` – čo drží toto vlákno.

Bez stabilného `thread <id>` (stavový riadok) skript tému nezaberie: spusti harness cez `node ${CLAUDE_PLUGIN_ROOT}/bin/thread.mjs` alebo v T3. V ťahu spustenom správou (wake) skript zabratie odmietne (P-047).

Pri prevzatí témy porovnaj „Hotové“ z handoveru so súbormi a pri rozchode sa zastav a spýtaj (P-011).

Po zmene témy hook raz pokynom „thread title: rename this thread to …“ požiada o premenovanie vlákna podľa témy: urob to nástrojom `t3_thread_update` (`action: rename`). Ručne zmenený názov, hlavné vlákno persony a vlákno s viac témami hook vynechá (P-036).
