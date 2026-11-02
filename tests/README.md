# tests/

Testy `node --test` (P-034), spúšťané `npm test`. Bez závislostí. Rozpis podľa míľnikov je v `PLAN.md` (časť c).

Trvalé kontroly (lint):
- P-004: zakázané vzory v súboroch workflow (absolútne cesty, mená osôb, názvy inštancií),
- P-034: žiadne `.sh`, `.ps1`, `.py`; každý príkaz v `hooks/hooks.json` začína `node`,
- P-048: manifest má `name: workflow` a `defaultEnabled: false`,
- P-049: názvy súborov a polí bez diakritiky,
- P-023: každý hook má deklarovanú triedu a limit výstupu,
- P-029: existuje každý základný skill so skriptom,
- P-022: štartovacia sekvencia dodrží limity z `policy/policy.json`,
- P-017 (`adapter-codex`): generované súbory Codexu sú platné (TOML podmnožina, JSON), zhodné s politikou a zdrojom, commitované súbory bez absolútnych ciest, výstup Claude adaptéra nezmenený.

Integračné testy pošty (`prompt-mail`, `comms-skill`) spúšťajú dočasnú inštanciu `agentic-comms` (klient hľadaný v `../agentic-comms` vedľa klonu pluginu alebo cez `AGENTIC_COMMS_DIR`) ako detský proces v dočasnom priečinku; po teste ju zastavia a priečinok zmažú. Bez `agentic-comms` sa tieto testy preskočia.
