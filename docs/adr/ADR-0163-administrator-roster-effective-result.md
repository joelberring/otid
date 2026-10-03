# ADR-0163: Effektivt resultat i administratörens deltagartabell

- Status: Accepterad
- Datum: 2026-09-27
- Uppgift: TASK207

## Kontext

ADR-0099 ger listan endast resultatets aktualitet; ADR-0074 ger full
effektiv status och eventuell löptid först efter personval. Operatören
behöver hitta deltagare efter resultatläge i den täta tabellen utan att
öppna varje person. Att läsa senaste råstatus från SQL skulle kunna vara
fel när ett manuellt beslut styr eller har återtagits.

## Beslut

Rosterläsningen projekterar ett diskriminerat per-entry-tillstånd från
senaste **publicerade** revision och den befintliga bulkresolvern i samma
repeatable-read-snapshot. `NO_PUBLISHED_RESULT` bär ingen revision,
`NO_ACTIVE_RESULT` bär vald revision men ingen status/tid och
`ACTIVE_RESULT` bär vald revision, effektiv resultatrevision, status,
orsak, eventuell löptid och resultatets snapshotversion. Den befintliga
strikta lagrade-resultatparsern och speakerresultatets kontrakt validerar
status/tid; React gör ingen resultatbedömning.

Det obligatoriska nya fältet gör kandidat-*svaret* inkompatibelt med äldre
strikt schema, så dess `formatVersion` blir 2. Skrivbegäran och kvittens för
klassbyte behåller formatVersion 1. Redan existerande `resultFreshness`
behålls för filter och sammanräkningar och måste överensstämma med den nya
projektionen och loppets snapshotversion. Framtida snapshot eller ogiltig
provenance avvisas i stället för att visas som aktuellt resultat.

## Konsekvenser

Kontrakt, application-läsmodell och privat webbrad påverkas. Ingen
migration, ny behörighet/route, domänlogik, råavläsning eller publik
resultatvy tillkommer. Resultatet är kunskap vid angiven lästid, inte live
eller fastställt. Personkortet förblir kanonisk detaljvy. Återställning är
att dra tillbaka svarsversion 2/projektionen och resultatkolumnen; lagrad
historik påverkas inte.
