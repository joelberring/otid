# ADR-0071: Brickbyte med gemensam administratörssession

- Status: Accepterad
- Datum: 2026-09-12
- Uppgift: TASK030

## Beslut

CHANGE_ENTRY_CARD ansluts uttryckligen till MANAGE_RACE enligt ADR-0069.
Befintlig application-tjänst och immutable brickbytesjournal återanvänds.
Verkligt credential-id och auditaktör behålls: administratören journalförs
som RACE_ADMIN_ACCESS_CREDENTIAL, begränsad brickoperatör som tidigare.
Ingen maskering av principal, cookie-fallback eller extra funktionsinloggning.
Journalens FK stödjer båda rollerna redan; ingen migration behövs.

Gemensamma transfer-candidates utökas med activeAssignment|null och
multipleActiveAssignments per entry, hämtade i samma låsta repeatable-read
som klass/start/version. Flera aktiva kopplingar visas som konflikt, aldrig
som en godtyckligt vald bricka. Webben och detta interna kontrakt levereras
tillsammans; äldre strikt klient behöver omladdning, ingen tyst default.

Ny PATCH /administrator/entries/{entryId}/card återanvänder befintliga
entry-card-change-kontrakt och idempotency-prefix. Route kräver verklig
MANAGE_RACE innan body läses och kontrollerar kvittens mot hela intentet.
Application återautentiserar under lås. Historiskt exakt retry hör till samma
aktör, inte valfri administratör. Annans historiska bricka övertas inte;
egen gammal bricka kan återaktiveras enligt befintlig regel.

Gemensam arbetsvy äger session, avbrutna anrop och ett enda väntande intent
för klassbyte, kapacitet eller brickbyte. Brickeditor har ingen egen login
eller beständig kö. Okänt svar behåller samma request; logout/omladdning
kan förlora minnesintent och kräver då kontroll av aktuellt underlag.

Entry-/snapshotversion ökar som tidigare vid brickbyte. Rådata, tidigare
resultatrevisioner, publiceringar och installerade stationspaket bevaras.
Omräkning är ett separat beslut, inte en dold effekt av brickbyte.

## Återställning och gränser

Vid incident stäng den nya routen och ta bort rollens åtgärd från explicit
policy; behåll journal och gamla begränsade flöden. Ingen schemaåterställning,
ny dependency, AGPL-kod, hårdvaruimplementation eller extern integration.

## Acceptans

Riktig PostgreSQL visar adminaudit, historiskt retry, nekad annan aktör och
bevarat kortägarskap. Befintliga brickbytesregressioner ska fortsatt passera.
Browser visar klassbyte och brickbyte med samma session, tappat svar/exakt
retry, nytt aktuellt nummer och logout i mobil-/datorbredd. Riktad lint,
typecheck, tester och build krävs; ingen produktions-/hårdvaruacceptans påstås.
