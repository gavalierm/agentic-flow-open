# bin/

Vstupné body skriptov, volané ako `node <plugin>/bin/<name>.mjs` v koreni projektu (alebo s `--project <dir>`). Bez závislostí (P-034). Logika je v `scripts/`.

| Skript | Princíp | Úloha |
|---|---|---|
| `brain.mjs write|remove|sync|status` | P-040, P-037, P-025 | jediný zapisovač do brain: zápis, commit so značkou `[brain-script]`, push, kontrola nesúhlasu, retry na `index.lock`, kontrola držiteľa |
| `brain-init.mjs <path> [--attach] [--remote] [--project]` | P-024, P-018, P-040 | založenie brain zo `templates/brain/` alebo aktivácia klonu: `core.hooksPath`, `local/` |
| `brain-precommit.mjs pre-commit|commit-msg` | P-040 | kontrolná logika git hookov brain (volajú ju shimy z `templates/brain/.githooks/`) |
| `rules.mjs [--check]` | P-035, P-022 | zostavenie pravidiel z vrstiev, výpis výnimiek, kontrola limitov |
| `index.mjs` | P-039, P-010 | generovanie indexov do `<brain>/local/index/`, kontrola limitov |
| `find.mjs <query> | --relates-to | --similar` | P-031 | deterministické vyhľadanie kľúčov, aliasov a väzieb |
| `topic.mjs create|claim|release|list|status|copy` | P-036, P-037, P-045 | témy, držiteľ, kópia kódu |
| `thread.mjs [--id] [-- <args>]` | P-038 | vygeneruje `WORKFLOW_THREAD_ID` a spustí harness |
| `adapter.mjs claude-code | codex | --version` | P-017, P-015 | Claude Code: `.claude/settings.json`, `.workflow.json`, `.gitignore`, kópia skillov brain; Codex: `.codex/config.toml`, `AGENTS.md`, lokálne `.codex/hooks.json` a `.agents/skills/` (pozri `adapters/codex/`) |
| `save.mjs memory|decision|rule|exception|skill|handover` | P-013, P-007 | skript skillu `save` |
| `finish.mjs [--topic] --verified` | P-029, P-005, P-006, P-036 | skript skillu `finish` |
| `error.mjs list|check|resolve` | P-003, P-028 | skript skillu `error` |
| `delegate.mjs prepare|check` | P-027, P-028 | skript skillu `delegate` |
| `consolidate.mjs report` | P-010 | skript skillu `consolidate` |
| `log.mjs flush|failures|names` | P-030 | logy pozorovaní (volá ich hook Stop) |
| `comms.mjs status|count|list|receive|ack|send|notices|decide|register` | P-041, P-042, P-044, P-047 | skript skillu `comms`: obal nad klientom `agentic-comms` s konfiguráciou projektu; telo správy vypisuje ako dáta |
| `check.mjs --loaded <sha>` | P-020, P-021 | skript skillu `check`: porovná verziu zo štartu session s nainštalovanou; novšia → vypíše aktuálne pravidlá, rovnaká → hlásenie správcovi (`maintainer/workflow-dev`) |
