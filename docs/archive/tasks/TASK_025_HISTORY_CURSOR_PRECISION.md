# TASK025 – allmän historik utan precisionstapp

Avgränsat korrekthetssnitt i application enligt ADR-0066, före implementation.
Allmän readoutlista använder cursor v2 med sex decimaler och exakt SQL-seek.
V1-listcursor avvisas; detaljcursor v1 är oförändrad. Ingen UI/domain/schema-
eller hårdvaruändring. Befintlig uppdateringsknapp börjar om från första sidan.

Acceptans: verklig PG sidning utan tapp/dublett över sub-millisekundgräns,
v1/felrace/ogiltig cursor avvisas, oförändrad detaljsidning. Lint/typecheck,
riktade tester och build; ingen full onödig browseromkörning för opaque token.

Status: implementerat och avgränsat verifierat. Application lint/typecheck/build
och web build exit 0. PG: 8 passerade/124 avsiktligt bortvalda (3.45 s), inklusive
nytt deterministic 2+2-prov inom samma millisekund, befintlig allmän historik/
detaljvattenmärke och TASK024. Webklient-/routeprov: 8 passerade (1.83 s).

Testclustern stoppad, syntetiska data bevarade. Ingen råpost ändrades eller
raderades. Ingen ny browser-/hårdvaruomkörning för oförändrat UI/opaque token.
Produktionsvolymer och skarp driftsättning är ej verifierade. V1-markörer
kräver att operatören uppdaterar listan för att få v2.
