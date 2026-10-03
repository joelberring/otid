# TASK 001 – första vertikala tävlingskärnan

## Mål

Skapa repositoryts första körbara vertikala funktion:

> En arrangör kan skapa en individuell tävling, importera deltagare och banor, simulera en brickavläsning, få ett revisionssparat resultat och se resultatet på en offentlig sida.

Bygg inte riktig SPORTident-USB i denna uppgift. Simulatorn ska använda exakt samma ingest- och resultatflöde som den framtida stationsappen.

## Obligatoriska leverabler

### Repository

- pnpm workspace
- TypeScript strict
- Next.js web/API-app
- workerplaceholder ur samma kodbas
- PostgreSQL + PostGIS i Docker Compose
- privat MinIO i Docker Compose
- migrationsstyrt databaslager
- Vitest
- Playwright
- CI som kör lint, typecheck och tests
- `.env.example`
- reproducerbara seeddata

### Dokumentation

Skapa:

- `docs/architecture.md`
- `docs/domain-rules.md`
- `docs/offline-sync.md`
- `docs/sportident.md`
- `docs/map-and-route-model.md`
- `docs/acceptance-tests.md`
- `docs/status.md`
- minst ADR för modulär monolit, databas och rådata/revisioner

### Domän

Implementera rena typer och funktioner för:

- Event
- Race
- Class
- Course och CourseVersion
- Control och CourseControl
- Entry
- CardAssignment
- NormalizedCardReadout
- EvaluationResult
- ResultRevision

Implementera:

```ts
evaluateCardReadout(
  readout: NormalizedCardReadout,
  snapshot: RaceSnapshot
): EvaluationResult
```

Första regler:

- OK
- saknad kontroll = MP
- extra kontroll tillåts
- fel ordning = MP
- start och mål
- okänd bricka
- upprepad kontrollkod
- fast starttid eller startstämpling

### Import

Importera och validera IOF XML 3.0:

- `EntryList`
- `CourseData`

Spara originalfil och en strukturerad importrapport. Importen ska vara atomär.

### Simulerad station

Bygg en enkel station/simulator som:

- får ett stabilt `deviceId`,
- har lokalt sekvensnummer,
- skapar rå payload,
- skickar en idempotent batch,
- kan skicka samma batch igen,
- visar serverkvittens,
- inte går direkt mot databasen.

Spara först:

1. `raw_device_message`
2. normaliserad avläsning
3. resultatrevision

### Arrangörsvy

- skapa tävling,
- importera filer,
- lista klasser, banor och deltagare,
- se avläsningar,
- se resultat och förklaringskod,
- ändra deltagares klass och explicit räkna om resultat,
- se revisionshistorik.

### Publikvy

- tävlingsinformation,
- klassvis resultat,
- sträcktider,
- uppdatering via SSE eller en dokumenterad första pollinglösning,
- fungerar utan konto.

## Databasvillkor

- interna UUID
- externa identiteter separat
- rådata immutable på applikationsnivå
- unik nyckel för `device_id + local_sequence`
- innehållshash
- resultatrevisioner append-only
- course versions append-only
- auditposter för klassändring och omräkning

## Obligatoriska tester

1. samma batch 100 gånger ger en rå post,
2. saknad kontroll,
3. extra kontroll,
4. upprepad kontrollkod,
5. fel ordning,
6. okänd bricka,
7. ändrad klass skapar ny resultatrevision,
8. ogiltig XML lämnar tävlingen oförändrad,
9. samma XML-import ger inga okontrollerade dubletter,
10. publikresultat visar senaste publicerade revision.

## Får inte byggas nu

- riktig USB,
- Eventor,
- GPS,
- karttiles,
- stafett,
- betalning,
- avancerad autentisering,
- Liveloxintegration.

## Slutrapport från Codex

Redovisa:

- filstruktur,
- körkommandon,
- databasmigrationer,
- tester och resultat,
- arkitekturbeslut,
- kända begränsningar,
- exakt nästa minsta uppgift.
