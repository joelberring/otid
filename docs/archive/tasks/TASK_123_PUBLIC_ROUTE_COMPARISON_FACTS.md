# TASK123: tät faktaöversikt i publik ruttjämförelse

Status: implementerad och riktat verifierad efter TASK121–122.

## Genomförande

- Den befintliga härledda routemetadata visas som två täta, färgkopplade
  faktarader: distans, punkter, segment och komplett eller uttryckligt saknad
  GPX-tid.
- Ett litet rent formatbibliotek delas med den enskilda routevyn så att svensk
  distans- och tidsformatering inte kan glida isär.

## Användarvärde

Vid sidan av namn och färg ser besökaren den redan härledda distansen,
punkt-/segmentantalet och eventuell GPX-tidsinformation för var och en av de
två rutterna utan att lämna jämförelsen.

## Avgränsning

- Endast renderingen av TASK121:s redan publika `metadata`.
- Två kompakta, färgkopplade faktarader som fungerar vid 390 px.
- Ingen ny kontraktsdata, serverläsning, migration, writer, tidsuppspelning,
  fart, höjd eller kontrollpassageanalys.

## Acceptans

1. En godkänd jämförelse visar redan härledd distans, punkter, segment och
   antingen komplett GPX-tid eller uttryckligt tidslöst besked för båda
   rutterna.
2. Texten skapar inga kontinuerliga tidsanspråk, tempo, passagetider eller
   ny identifierande data.
3. Layouten är kompakt och har ingen horisontell sidscroll vid 390 px.
