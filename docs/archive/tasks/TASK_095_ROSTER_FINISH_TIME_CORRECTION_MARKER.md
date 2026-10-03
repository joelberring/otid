# TASK095: läsmarkering av måltidsrättning i deltagarlistan

Genomförd 2026-09-19 efter TASK094. Ingen ADR behövs: snittet ändrar varken
arkitektur, domängräns, resultaturval eller skrivbehörighet.

## Användarvärde

Tävlingsadministratören ser direkt i den täta deltagarlistan om deltagarens
nuvarande, strikt validerade resultathuvud är en manuell måltidsrättning eller
ett återtagande av en sådan rättning.

## Avgränsning

- Ett nytt skrivskyddat nullable markeringsfält i det befintliga privata
  deltagarunderlaget: `MANUAL_FINISH_TIME_CORRECTION`,
  `MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL` eller `null`.
- Markören härleds enbart från den redan resolverade och validerade aktuella
  revisionen; journal-ID:n och annan intern proveniens lämnar inte servern.
- Två korta svenska badges visas under deltagarens namn, i samma rad som
  befintliga resultat- och hyrbricksmarkörer.
- Ingen ny endpoint, databasändring, behörighet, resultataction, omräkning,
  filter, bulkfunktion eller historikvy.
- Ingen GPS, karta/rutt, stafett, riktig USB eller ändring av offlineflödet.

## Acceptans

1. En nuvarande TASK093-rättning visas som `Måltid rättad`.
2. En nuvarande TASK094-återställning visas som `Måltidsrättning återtagen`.
3. En teknisk eller annan gällande revision visar ingen markör.
4. Motsägande eller ogiltig proveniens fortsätter att avvisas av befintlig
   resolver; listan gissar aldrig utifrån en journal eller revisionsorsak.
5. Markören visas när det vanliga deltagarunderlaget läses om och ryms i
   befintlig 390 px-deltagarlista utan ny panel eller sidscroll.

## Berörda paket och verifiering

Endast `contracts`, `application` och `web`. Riktat kontraktsprov,
isolerat PostgreSQL-prov för den befintliga resultatkedjan och ett kompakt
browserfall körs tillsammans med berörd lint/typecheck/build.
