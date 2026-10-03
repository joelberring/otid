# TASK180: inventering av server-writers

Läsande källkodsinventering för planeringen av ADR/TASK180, återkontrollerad
2026-09-27. Den visar representativa writer-kategorier, men bevisar inte att
alla muteringsvägar har räknats upp eller spärrats i drift.

## Körmiljö och befintlig samordning

- Arkitekturen är en modulär monolit: `apps/web` är en vanlig Node-process med
  Next.js, `apps/worker` beskrivs som en platshållare och applikationstjänsterna
  delar databaspaket (`docs/architecture.md:8-22`).
- Webbrouterna använder en modulglobal databaspool per process från
  `DATABASE_URL` (`apps/web/src/lib/db.ts:1-22`).
- Applikationsskrivningar körs ofta i lokala PostgreSQL-transaktioner.
  Befintliga lås gäller ett lopp/en deltagare
  (`packages/application/src/concurrency.ts:5-29`) eller en request-/idempotensnyckel
  (till exempel `packages/application/src/entry-registration.ts:75-82`). Inget
  globalt lås för writer-insläpp eller dränering hittades.
- Ingest är transaktionell per händelse och tar loppets snapshotlås
  (`packages/application/src/ingest.ts:80-115`). Det skyddar samstämmigheten
  mellan ingest och resultat, men inte hela databasen mot andra skrivningar.

## Writer-kategorier

**HTTP/API:** En källkodssökning hittade 175 exporterade deklarationer av
`POST`/`PUT`/`PATCH`/`DELETE`-handlers under
`apps/web/src/app/api/**/route.ts`. Det är ett sökresultat, inte ett fullständigt
bevis. Kategorierna omfattar enhetsingest
(`apps/web/src/app/api/races/[raceId]/device-batches/route.ts:4-6`), IOF-import
(`apps/web/src/app/api/races/[raceId]/imports/route.ts:4-6`), många adminrutter
för lopp/deltagare/resultat/klasser/start/publicering (till exempel
`apps/web/src/app/api/admin/races/[raceId]/administrator/registration/route.ts:4`)
och arrangörsrutter för tävlingar och anmälningar.

**Autentisering och sessionstillstånd:** inloggning/utloggning, kontoaktivering
och återställning, parkopplingsinlösen, deltagaranspråk/följningar samt
utfärdande/återkallande av capability-sessioner ändrar också lagring.
Representativa rutter: `apps/web/src/app/api/organizer/login/route.ts:4-6`,
`apps/web/src/app/api/account/recovery/route.ts:4-6` och
`apps/web/src/app/api/station-pairing/redeem/route.ts:4`.

**Uppladdningar och objektlagring:** ruttuppladdningens reservation och
överföring använder separata endpoints
(`apps/web/src/app/api/route-upload/reservations/route.ts:4-5`,
`apps/web/src/app/api/route-upload/reservations/[uploadId]/route.ts:5-8`);
kartuppladdning har reservations-/överföringsrutter under
`apps/web/src/app/api/admin/races/[raceId]/map/`. Applikationens
uppladdningsflöden kombinerar PostgreSQL-transaktioner med anrop till
objektlagringen, till exempel `packages/application/src/route-upload.ts:83-186`
och `packages/application/src/map-asset.ts:153-210`. Enbart DB-transaktionen
spärrar inte sidoeffekten i objektlagringen.

**Jobb/bakgrundsprocesser:** worker-entrypointen deklarerar och loggar för
närvarande bara en platshållare (`apps/worker/src/index.ts:1-3`).
Lease-operationerna för PM-skanning är transaktionella
(`packages/application/src/pm-scan-jobs.ts:26-57,60-76`), men en eventuell
produktionsrunner och dess insläppsgräns måste omfattas om den införs.

**Betrodd CLI/underhåll:** en sökning hittade 39 filer i `scripts/*.ts` som
innehåller `createDatabase(`. Antalet bevisar inte att alla körande anropare
har hittats. Exempelvis skapar `scripts/eventor-connection.ts:21-46` en egen
pool från `DATABASE_URL`; processen är oberoende av webbpoolen. Provisionering,
utfärdande/återkallande av behörigheter, återställning och migrationer behöver
också hanteras uttryckligen när de riktas mot databasen i scope.

**Precisering 2026-09-27:** dessa 39 filer nås via 76 deklarerade
`tsx scripts/…`-kommandon i rotens `package.json`. Den fyrtionde deklarerade
scriptfilen, `demo-access-copy.ts`, öppnar inte DB men kan hantera privata
åtkomstuppgifter. Därutöver är `db:seed` en faktisk separat DB-writer i
`packages/application/src/seed.ts`; `db:migrate` är redan en egen
exempelenhet. Den granskade 39-filskatalogen och de två fasta enheternas
markörkonfiguration låses av `ops/systemd/writer-inventory.test.mjs`.
Alla 39 CLI:er och `db:seed` är **otillåtna** i den valda, ännu inte
installerade `systemd-v1`-profilen tills de får granskad startväg eller
bevisligen saknar writer-credential. Detta är ett urval för profilen, inte
ett påstående att befintliga lokala utvecklingskommandon har spärrats.
Flera issue/rotate/recovery-kommandon skriver bearerhemligheter till stdout;
en generell systemd-enhet utan privat utdatahantering vore osäker.
Ingen komplett credential-/processgräns är ännu verifierad på Linux.

**Offline-station:** lokal avläsning/kölagring ska fortsätta fungera under
serverstoppet; det är synkrequesten till servern som ska spärras.
`docs/offline-sync.md` (”Transaktionsgräns”, TASK005A/C) beskriver lokal
outbox-bevaring och serverns commit-/kvittensbeteende.

## Gränslucka och checklista för acceptanstäckning

Webbprocessen kan stoppas kontrollerat när inkommande trafik har stängts, så att
pågående handlers dräneras. Det stoppar inte separat startade CLI:er,
migrationsverktyg, externa databasklienter eller en framtida worker. Befintliga
lopp-/advisory-lås styr inte insläppet till hela servern. Denna källkodskontroll
hittade ingen driftsättningskontrollerare, processinventering eller gemensam
skrivspärr. En processbaserad acceptans måste därför ange vilken avgränsad
installation och externt verkställbara underhållsgräns den gäller. Den kan inte
säga sig spärra godtyckliga klienter som fortfarande har skrivuppgifter till
databasen. Lokal `docker-compose.yml` definierar endast Postgres och MinIO,
med delad utvecklingsanvändare/rootcredentials; den är inte en färdig
produktionsprofil för writer-stopp.

En senare isolerad syntetisk acceptans bör dokumentera belägg för varje punkt:

- [ ] Ange alla DB-/objektlagringsprocesser och credentials som ingår.
- [ ] Stäng HTTP-ingången och neka nya appanrop; dränera varje webbinstans
      kontrollerat och verifiera att dess pågående skrivningar avslutas.
- [ ] Stoppa/inaktivera worker och schemalagda jobb; förhindra omstart under
      capture.
- [ ] Förbjud körning av betrodda CLI:er/migrationer och spärra externa
      DB-writers under den angivna perioden.
- [ ] Verifiera att inga transaktioner/sessioner från writers i scope återstår
      innan backupens konsistenspunkt läses; stäng fail-closed vid osäkerhet.
- [ ] Visa att ett representativt muteringsförsök efter stopp nekas, samtidigt
      som uttryckligen tillåtna läsningar fungerar.
- [ ] Visa att lokal offline-outbox fortfarande sparar poster när nätverkssynk
      saknas och att inga lokala händelser tas bort.
- [ ] Verifiera att en uttrycklig release återöppnar skrivningar; fel/omstart
      lämnar stoppet aktivt tills det släpps medvetet.
- [ ] Redovisa täckta writer-kategorier, utelämnade vägar och exakt omfattning
      för slutsatsen.

Relaterade krav: `TASK_180_TECHNICAL_WRITER_STOP_BOUNDARY.md` och
`docs/backup-restore-operations.md` (”Före backup”).
