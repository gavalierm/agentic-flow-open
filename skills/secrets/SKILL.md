---
name: secrets
description: Použi, keď pracuješ s tajomstvom (heslo, token, kľúč, súbor z request_secret): kontroluješ jeho formát alebo platnosť, kopíruješ ho alebo o ňom niečo vypisuješ.
---

# secrets – tajomstvo nikdy v prepise (P-018, P-003)

1. Z tajomstva vypisuj iba booleany a dĺžky: obsahuje oddeľovač (`@`, `:`), počet častí, dĺžka každej časti, zhoda so vzorom (regex → true/false).
2. Časť tajomstva (napr. doménu adresy) vypíš iba po overení, že zodpovedá vzoru, ktorý ju robí verejnou (e-mail pred `@`); inak iba false.
3. Overenie prihlásením (SMTP, API) vypíše iba OK/FAIL a typ chyby, nie text odpovede, ktorý môže obsahovať vstup.
4. Tajomstvo odovzdávaj cestou k súboru (`<projekt>/local/` alebo cieľ služby s právami 600), nie hodnotou v príkaze ani v správe.
5. Keď sa časť tajomstva dostala do prepisu: povedz to operátorovi hneď (čo a koľko znakov, nie hodnotu) a navrhni zmenu tajomstva.
nie `split()` a výpis časti (napr. `u.split('@')[-1]`), lebo bez oddeľovača vráti celú hodnotu a tajomstvo sa ocitne v prepise (2026-11-03).
