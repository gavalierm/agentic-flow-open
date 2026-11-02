# adapters/codex/

Adaptér pre Codex (P-017, druhoradý harness; funkčnosť overí smoke test pilotu, body 4, 6, 7). `node <plugin>/bin/adapter.mjs codex` v koreni projektu vygeneruje z toho istého zdroja ako Claude adaptér (`policy/policy.json`, `hooks/hooks.json`, `rules/*.md` + výnimky brain, `skills/`):

| Súbor | Commit | Obsah |
|---|---|---|
| `<project>/.codex/config.toml` | áno | `features.hooks = true`, `features.memories = false` (P-014), `model_auto_compact_token_limit` a `compact_prompt` (P-026), profil `default_permissions = "workflow"` s `filesystem` deny na brain, `~/.claude/**` a `.agents/skills/**` (P-015). Celý súbor je generovaný; cudzí `config.toml` adaptér odmietne (iné nastavenia patria do `~/.codex/config.toml`). |
| `<project>/AGENTS.md` | áno | blok medzi `<!-- workflow:begin -->` a `<!-- workflow:end -->`: ako workflow beží v Codexe + zostavené pravidlá (vrstva `harness-codex`). Ostatný obsah súboru sa zachová. SessionStart hlási `AGENTS.md stale`, keď sa blok líši od zdroja. |
| `<project>/.codex/hooks.json` | nie (`.gitignore`) | mapovanie udalostí na skripty `hooks/*.mjs`; obsahuje absolútnu cestu ku klonu pluginu (P-004). |
| `<project>/.agents/skills/` | nie (`.gitignore`) | kópie skillov workflow s dosadenou cestou pluginu za `${CLAUDE_PLUGIN_ROOT}` + skilly brain; prepíše sa pri každom SessionStart. |
| `<project>/.workflow.json` | áno | ak chýba (rovnako ako Claude adaptér). |

## Mapovanie udalostí

| Codex udalosť | Skript | Preklad |
|---|---|---|
| SessionStart | `hook.mjs session-start` → `scripts/boot.mjs` | bez položky 1 (pravidlá nesie `AGENTS.md`), `additionalContextLimit: 0`, kontrola zhody `AGENTS.md`, skilly do `.agents/skills/` |
| UserPromptSubmit | `hooks/user-prompt-submit.mjs` | priamo (rovnaký vstup aj výstup) |
| PreToolUse (`Bash`, `apply_patch`) | `hook.mjs pre-tool-use` → `hooks/pre-tool-use.mjs` | `apply_patch` → jedna kontrola `Edit`/`Write` na každý súbor patchu; `ask` → `deny` s dôvodom (Codex nevie `ask`, P-018) |
| PostToolUse (`Bash`) | `hooks/post-tool-use.mjs` | priamo; `PostToolUseFailure` Codex nemá |
| Stop | `hook.mjs stop` → `hooks/stop.mjs` | záznam ťahu (`turn closed`), logy a signály ako v Claude Code; bez ďalšieho ťahu (chýbajúcu odpoveď zistí TTL správy, P-042) |
| SubagentStop | `hooks/subagent-stop.mjs` | priamo (`agent_type`, `last_assistant_message`, `stop_hook_active`) |

`hook.mjs` je tenký prekladač bez vlastnej logiky (P-017). `toml.mjs` je mini zapisovač/čítač TOML pre podmnožinu, ktorú adaptér vydáva (bez závislostí, P-034). `generate.mjs` sú čisté funkcie `codexConfig`, `codexHooks`, `agentsBlock` + `generateCodex`.

Čo je overené z dokumentácie a čo ostáva na prvý beh Codexu, je v `PLAN.md` (Rozhodnutia pri implementácii M7).
