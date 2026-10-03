# TASK053: utskrift av kvar-i-skogen från adminvyn

Klart avgränsat snitt 2026-09-12. Presentation enligt ADR-0090, ingen ny arkitektur.

Skriv ut senast lästa privata rapport med valt filter, datum/totaler och
osäkerhetsvarningar. Endast rapporten får ingå, inte annan administration.
Print-media använder separat rapportyta utanför details; logout rensar båda.
Ingen ny läsning/mutation på print, ingen fysisk skrivare kopplas in.

Web komponent/CSS och ett utökat TASK052-browserfall med print-media och
fångat printanrop. Web lint/typecheck/build. Ingen ny full testsuite.

Verifierat: web lint/typecheck/build exit0; ett utökat browserfall passerade
på7,3s. Print visar endast rapport, inkluderar filter/gammaldata/totaler och
orsakar inga nätanrop. Logout rensar även printytan. Ingen fysisk skrivare,
PDF-sidbrytning eller produktionsmiljö verifierad.
Nästa minsta uppgift: manuell återkomstregistrering med samma admininloggning.
