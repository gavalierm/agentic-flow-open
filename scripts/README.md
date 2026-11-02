# scripts/

Zdieľaná logika (knižnica) pre `bin/` a `hooks/`: čítanie `.workflow.json` a `local/workflow.json` (P-024), politika (P-017),
git operácie brain (P-040), normalizácia kľúčov (P-031, P-049), napojenie na klienta pošty `agentic-comms` (P-041: cesta z konfigurácie, limit 2 s, cache počtu u klienta).
Žiadna logika nesmie závisieť od harnessu (P-017) ani od konkrétnej inštancie (P-004).
