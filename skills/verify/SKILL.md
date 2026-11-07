---
name: verify
description: Použi, keď ideš tvrdiť, čo nástroj, služba, knižnica alebo API vie alebo nevie (vlastnosť, podpora, limit, verzia), najmä keď ho zavrhuješ alebo odporúčaš iný.
---

# verify – schopnosti nástroja iba overené (P-019, P-003)

1. Zisti nainštalovanú alebo cieľovú verziu (`<nástroj> --version`, balíček, obraz).
2. Over konkrétnu schopnosť v oficiálnej dokumentácii alebo changelogu tej verzie (WebSearch, potom WebFetch na dokumentáciu alebo repo), prípadne pokusom na tomto stroji.
3. Operátorovi uveď zdroj a istotu (overené / pravdepodobné / neviem); čo sa overiť nedalo, povedz ako neoverené.
nie tvrdenie o schopnostiach z pamäte, lebo pamäť zaostáva za verziami: agent zavrhol monitorovací nástroj „treba agenta na zariadení“, hoci jeho verzia už mala sieťové monitory ICMP/TCP/HTTP/DNS na ľubovoľný cieľ (2026-11-03).
