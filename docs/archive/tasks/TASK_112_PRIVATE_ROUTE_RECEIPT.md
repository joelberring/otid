# TASK112: återöppnad privat ruttkvittens

Status: implementerad och riktat verifierad 2026-09-21. Detta är en smal utvidgning inom
ADR-0123:s redan accepterade privata upload-/previewgräns; ingen ny ADR behövs
eftersom varken behörighet, domänägarskap, lagringsmodell eller publiceringsregel
ändras.

## Användarvärde

En deltagare som öppnar sin fortfarande giltiga privata ruttlänk igen ser om
routen redan är mottagen. Personen behöver då inte välja samma GPX-fil igen
bara för att få samma kvittens.

## Avgränsning

- En tokenfri, privat `GET` efter den befintliga bearer-växlingen läser endast
  den sessionens exakta grant/entry.
- Svaret är antingen `not-uploaded` eller en minimal lagrad kvittens med
  lagringstid, punktantal, segmentantal samt första/sista kända tidsstämpel.
- Återöppnad status använder ett eget anonymiserat läskontrakt. Det direkta
  uploadsvaret behåller sitt `uploadId` bara för den följande PUT:en, men
  statusläsningen innehåller inte filnamn, originalbytes, hash, WGS84-punkter,
  grant-/entry-/session-/upload-id, objektnyckel, bucket eller objektversion.
- Utgången eller spärrad grant/session ger samma privata felväg som övriga
  upload-anrop. En publik resultat- eller kartväg får aldrig läsa status.
- Läsvägen gör inga writes, parseranrop, objektlagringsanrop, omräkning eller
  snapshotmutation. Den läser inte kartor och ritar ingen rutt.

## Acceptans

1. En autentiserad privat session ser `not-uploaded` innan manifest finns och
   exakt lagrad kvittens efter manifest; manifestet söks på autentiserat
   grant/race/entry, aldrig på ett klientskickat upload-id.
2. Spärr eller utgång avvisar statusläsningen även om historiskt manifest finns.
3. Statussvaret är `private, no-store`, saknar hemligheter och interna id:n,
   och komponenten visar den lagrade kvittensen i stället för uploadformuläret.
4. Ett 390 px-browserprov visar återöppnad kvittens med syntetiskt HTTP-svar.

## Utanför uppgiften

- Privat GPS-lista, karta, georeferering, banmatchning, tidsanalys, rutt-
  uppspelning, offentlig release och fler-ruttjämförelse.
- Ny migration, objektlagringsläsning, FIT/TCX, live-GPS, stafett, USB eller
  stationens offlinekö.

## Genomförande och verifiering

`routeUploadStatusResponseSchema` är ett separat strikt läskontrakt. Det
återger endast `not-uploaded` eller lagringstid, antal punkter/segment och
första/sista tidsstämpel. Det direkta PUT-svaret behåller sin interna
uppladdningsidentitet för retry, men den anonymiserade GET-projektionen saknar
den identiteten helt.

Applikationsläsningen validerar session, grantens utgång och spärr under samma
delade race-lås som manifestläsningen. Manifestet läses enbart genom den
autentiserade principalens grant/race/entry; ingen klientskickad
uppladdningsidentitet accepteras. GET-svaret använder fortsatt
`private, no-store` och den tokenfria webbkomponenten visar kvittensen i stället
för formuläret.

Riktad verifiering 2026-09-21:

- contracts typecheck/lint och `route-upload.test.ts`: 4/4 tester passerar;
- application typecheck/lint och isolerad PostgreSQL17-
  `task-111-route-upload-grant.test.ts`: 2/2 passerar, inklusive före/efter
  manifest och spärr;
- web typecheck/lint samt två riktade testfiler: 4/4 passerar;
- e2e TypeScript/ESLint passerar och Playwright mot riktig lokal Next-browser
  på 390 px: 2/2 passerar med syntetiska privata API-svar.

Detta verifierar inte verklig MinIO-/objektlagring, publik ruttvisning eller
fältmobil.
