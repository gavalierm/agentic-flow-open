# agents/

Definície subagentov pluginu (P-025, P-027).

- `worker.md`: pracovník. Bez kontextu workflow (`omitClaudeMd: true`), bez nástroja `Skill`, skilly prednačítané cez `skills`,
  zápis iba v delegovanom rozsahu. Výsledok musí obsahovať časť „Failures“ (P-028).

Subagent triáže bol odstránený (2026-11-02): čakajúce správy číta hlavný agent cez `comms receive --id <id>` (P-044). Každý subagent
smie poštu iba čítať (`receive|list|count`, P-025).
