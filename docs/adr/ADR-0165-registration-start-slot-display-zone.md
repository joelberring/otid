# ADR-0165: tävlingszon i direktanmälans startslotvisning

- Status: Accepterad för TASK252, 2026-09-27. Skriven före implementation.

## Kontext

TASK110:s privata läskontrakt för direktanmälan lämnar verifierade
`FIXED`-startluckor som exakta UTC-instanter men ingen tävlingszon. Den
fristående registreringssidan visar därför `UTC` medan den gemensamma
`MANAGE_RACE`-vyn redan visar samma instanter i eventets tidszon från sin
rosterprojektion. En operatör som arbetar efter loppets startlista behöver
kunna jämföra tiderna utan egen omräkning. ADR-0063 har redan beslutat att
zonen är validerad presentationsmetadata, inte mutationsdata.

## Beslut

De två befintliga privata `REGISTER_ENTRY`-läsresponsen, klasslistan och
startslotkandidaterna, får ett obligatoriskt Intl-validerat `timeZone`.
Application hämtar `events.time_zone` via loppets event i respektive
lästransaktion efter lopplåset. Saknad eller ogiltig zon avvisas; varken
webbläsarens zon eller en hårdkodad Stockholmzon får användas som reserv.
`formatVersion: 1` behålls enligt ADR-0063:s samordnade server-/klientbyte;
en äldre strikt klient måste laddas om och får inte tolka en partiell respons.

Den fristående sidan använder samma formatterare som startlistan för datum,
sekunder, eventuell millisekund och numerisk UTC-offset. Slotkandidatens zon
måste vara samma som klasslistans zon och dess lopp, klass, snapshot och
banversion måste fortfarande matcha. Försenade svar för ett tidigare klassval
får inte visas. Vid osäkert eller oförenligt kandidatunderlag visas ingen
verifierad slot och operatören får ett textmärkt fel; den redan separata
manuella undantagsvägen finns kvar. Granskningen fryser visningszonen med
exakt begäran så omläsning eller ny inloggning inte byter dess presentation.
Den gemensamma administratörsvyn kräver att kandidatens zon matchar dess
redan lästa rosterzon.

`option.value`, registreringsrequest, slotbevis, journal och idempotent
retry behåller samma kanoniska UTC-instant. Ingen lokal väggtid gissas från
sommar-/vintertid, ingen extra startregel och ingen automatisk omräkning
införs. Visningszonen serialiseras aldrig i skrivrequesten.

## Konsekvenser och återgång

Ingen migration, dependency, ny capability eller domänändring. Server och
klient måste uppdateras tillsammans; återgång görs tillsammans. Historiska
journaler och tider påverkas inte. Riktade kontraktsprov och syntetisk
browserkontroll räcker för visningsvägen; ett PostgreSQL-prov får bara köras
mot en uttryckligen isolerad testdatabas. Extern källkod återanvänds inte.
