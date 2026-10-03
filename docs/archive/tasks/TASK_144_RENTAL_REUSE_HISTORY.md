# TASK144: privat deltagarhistorik för hyrbricksåteranvändning

Påbörjad 2026-09-22. Detta är en liten, läsande fortsättning på TASK143 och
ADR-0142 — inte en ny inventerings- eller bricklivscykel.

## Användarvärde

Efter att en återlämnad hyrbricka har getts vidare behöver
tävlingsadministratören vid båda deltagarna kunna se vad som hände utan att
tolka aktuella brickrader eller öppna tekniska journaler. Källans privata
historik ska visa att brickan lämnade deltagaren; målets ska visa att den
tilldelades och nu ännu inte är återlämnad.

## Avgränsning

- Endast den befintliga privata `MANAGE_RACE`-deltagarhistoriken utökas.
- Läs den immutable TASK143-journalen och visa en rad för både käll- och
  måldeltagare med riktning, bricknummer, sparad tid och den berörda
  deltagarversionen.
- Behåll befintlig fallande versionsordning, cursor och fail-closed
  sekvensvalidering.
- Ingen ny route, capability, databasstruktur eller skrivväg.
- Inga publika deltagarsidor, resultat, readout-/checkin-historik, stationer,
  offlineköer, inventory, betalning, Eventor, GPS, karta eller stafett.

## Beslut och arkitektur

Ingen ny ADR behövs: TASK144 ändrar inte teknikval, databaslivscykel,
domängräns eller behörighetsmodell utan använder TASK143:s redan accepterade,
immutable journal och den existerande privata historieprojektionen. Den andra
deltagarens identitet, actor-credential, UUID:er, assignment-id:n och audit-
JSON ska inte lämna application-kontraktet. Projektionsraden bär endast
användartextens riktning, bricknummer, tid och version/snapshot som redan
behövs för den privata historikens ordning och kontroll.

## Acceptans

1. En verkligt genomförd TASK143-operation ger exakt en `RENTAL_REUSE`-rad i
   vardera berörd deltagares privata historia; orelaterade deltagare får ingen
   rad.
2. Källan visar att den återlämnade hyrbrickan lämnade deltagaren, målet att
   brickan tilldelades som ej återlämnad. Båda raderna använder journalens
   sparade card number, timestamp, entryversion och snapshot — inte en
   gissning från en senare aktiv assignment.
3. Tidigare hyr-/returhistorik, råavläsningar, resultat och återanvändnings-
   journalen ändras inte. Replay skapar inga dubbletter i historiken.
4. Fel lopp och saknad `MANAGE_RACE`-behörighet avvisas av samma befintliga
   historiauthorization; inga nya interna id:n eller personkopplingar exponeras
   utanför den privata administratörsvyn.
5. Historikens svenska etikett och detalj fungerar vid 390 px utan horisontell
   sidscroll.

## Verifieringsplan

Ett riktat contractsprov, ett PostgreSQL-integrationsprov för den befintliga
historieprojektionen och berörd webbs komponent-/route-svit räcker. Ett enda
390 px-browserfall läggs endast till om den befintliga TASK143-browsern kan
öppna samma historiepanel utan ny testinfrastruktur. Ingen bred workspace-svit
eller fysisk/externt integrerad kontroll körs.

## Utfall 2026-09-22

Utfört utan migration eller ny route. Kontraktprovet passerade 5/5 och det
utökade PostgreSQL-provet för TASK143/144 3/3. Ett enda 390 px-browserfall
passerade med granskning, tappat svar, exakt retry och måldeltagarens privata
historikdetalj. Berörd lint, typecheck och build för contracts, application
och web samt E2E-TypeScript/E2E-ESLint passerade. Databasen var en ny tom,
isolerad PostgreSQL17/PostGIS-databas med endast syntetiska data.
