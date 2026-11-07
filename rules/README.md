# rules/

Jadro pravidiel (`*.md`), vrstva „workflow“ podľa P-035. Krátke normatívne vety (MUSÍ/NESMIE), postupy patria do skillov (P-022).
Výsledné pravidlá zostavuje `bin/rules.mjs` z vrstiev jadro → harness → stroj → projekt → lokálne a doručuje ich SessionStart hook (P-021).
Limit po zostavení: 200 riadkov a 10 000 znakov. Dôvod a podrobné znenie pravidla P-NNN je v `docs/principles/P-NNN.md`; číta sa iba ten jeden súbor, keď agent nie je istý, prečo pravidlo platí (priečinok sa neprehľadáva, hook to zamietne).
