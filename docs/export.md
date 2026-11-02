# Säkerhetskopia av en tävling

Inställningar → "Ladda ner säkerhetskopia" (bara administratör, [ADR-0187](adr/ADR-0187-sakerhetskopia-och-aterstallning.md))
ger en fil `otid-sakerhetskopia-<lopp>-<datum>-<ÅÅÅÅMMDD-TTMM>.zip` med allt om tävlingen. Den läses in med
"Återställ tävling från säkerhetskopia" under Mina tävlingar och blir då en **ny** tävling, på samma eller en annan server.
Ta en kopia efter lottningen, före start och efter sista målgång.

**Filen innehåller personuppgifter** (namn, klubb, bricka, resultat och e-post för dem som har behörighet). Arrangören ansvarar
för kopiorna på sin dator; det står också på integritetssidan (`/integritet`, Arrangörens egna kopior).

## Innehåll

```text
manifest.json          format, formatVersion, tid, antal och sha256 + storlek för varje annan fil
personer.json          personer med behörighet: { ref, email, eventRole, courseSettingLevel }
data/<tabell>.json     tävlingens rader, en fil per tabell (kolumnnamn i snake_case, tider i ISO 8601)
filer/<sha256>         binärdata: kartfilen (OCAD/Mapper), kartbilden, foton i notiser, GPX, festens logga
```

```json
{ "format": "otid-sakerhetskopia", "formatVersion": 2, "createdAt": "…", "engineVersion": "…", "containsPersonalData": true,
  "race": { "eventName": "…", "raceName": "…", "raceDate": "…", "raceType": "…", "timeZone": "…" },
  "counts": { "classes": 2, "entries": 120, "cardReadouts": 118, … }, "staleResults": 0,
  "tables": [{ "name": "entry", "rows": 120, "sha256": "…", "bytes": 51234 }, …],
  "people": { "sha256": "…", "bytes": 312 }, "files": [{ "sha256": "…", "bytes": 4183022 }, …] }
```

- **Med:** tävlingen och evenemanget, kontroller, banor med versioner, kontrollföljd och varianter (gafflingar), klasser,
  stafettens sträckor och lag, deltagare (även strukna), brickor och hyrbrickor, lottningar och starttider, publicerade
  startlistor, rättningar för hela tävlingen, råa avläsningar (oförändrade, med ramar), avläsningar och deras utfall,
  resultatrevisioner, beslut och fastställanden (med IOF XML), avprickningen vid start, kortbaneöverflyttningar,
  journalerna för arrangörens begäranden och inlästa filer, radiokontroller och radiostämplingar, kartan och kartfilen, kartans
  avtal, vägvalsanalysen, GPS-rutter, banläggningen (dokument, tidigare versioner, ändringslogg, notiser med foton, svar, förslag,
  "kollad"), festen, Eventor-kopplingen utan nyckel, publiceringsinställningarna och journalen (`audit_event`).
- **Inte med:** konton, lösenord, sessioner och länkar (kontonas id är utbytta mot slumpade referenser), Eventor-nyckeln,
  PDF:er för tryck, resultatströmmens tekniska väckningar, träningsgruppen och kvitton som hör till andra tävlingar.
  Listan med skäl står i `packages/application/src/race-backup-tables.ts`.
- `formatVersion` höjs när en tabell eller kolumn ändrar betydelse. Nya kolumner kan komma utan ny version; en server som inte
  känner till en kolumn avvisar kopian och ber om en uppdatering. Den gamla JSON-exporten (formatVersion 1) kan inte läsas in.

## Återställning

Mina tävlingar → "Återställ tävling från säkerhetskopia": välj filen, "Kontrollera filen" visar tävlingen, datum, antal
klasser, deltagare och avläsningar, formatversion och personer med behörighet, och först "Skapa tävlingen" sparar.

- Den nya tävlingen får nya id genomgående och en egen kort adress, och är opublicerad. Resultaten och sträcktiderna är
  desamma; inget räknas om.
- Den som återställer blir ägare. "Ge dem samma behörighet här" ger personerna i kopian sin roll igen om de har ett konto med
  samma e-post på servern (ägare blir administratör); de som saknar konto räknas upp.
- Radiohämtningen är avstängd och Eventor-nyckeln saknas: slå på radion och klistra in nyckeln under Inställningar.
- Gränser: högst 200 MB fil, 96 MB per tabellfil, 72 MB per binärfil och 400 MB uppackat. Varje fil kontrolleras mot sin
  sha256 och varje rad mot databasens kolumner innan något sparas.
