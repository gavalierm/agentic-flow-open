# rules/

Jadro pravidiel (`*.md`), vrstva „workflow“ podľa P-035. Krátke normatívne vety (MUSÍ/NESMIE), postupy patria do skillov (P-022).
Výsledné pravidlá zostavuje `bin/rules.mjs` z vrstiev jadro → harness → stroj → projekt → lokálne a doručuje ich SessionStart hook (P-021).
Limit po zostavení: 200 riadkov a 10 000 znakov. Zdrojom znenia je `docs/PRINCIPLES.md`.
