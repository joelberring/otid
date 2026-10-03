# Lokal syntetisk demo – 2026-09-06

Historisk guide: denna databas saknar authguard från migration 0037 och är
inte kompatibel med alla privata läsvyer i senaste serverkoden. Använd den
separata [aktuella demon](local-demo-20260907.md) på port 3001. Den gamla
databasen har inte raderats eller migrerats.

Webbservern har startats på `http://127.0.0.1:3000` med separat databas
`otid_demo_20260906`. Detta är en lokal utvecklingsdemo, inte en publicerad
tjänst eller produktionsdriftsättning. Serverprocessen måste vara igång.
Den riktiga tävlingen och dess Eventor-nyckel används inte.

## Börja här

1. Öppna [simulatorn](http://127.0.0.1:3000/admin/10000000-0000-4000-8000-000000000002/simulator).
   Den använder syntetiska avläsningar, inte riktig SPORTident/USB.
   Den behöver också en separat READOUT-stationscredential för sitt visade
   enhets-id. Utfärdandesteget beskrivs i `docs/demo-provisioning.md` under
   Starta och prova; de tre befintliga arrangörsrollerna ersätter inte den.
2. Använd de importerade testbrickorna 12345 (Ada Löpare) eller 67890 (Bo Skog).
   Följ simulatorns formulär och visa sedan
   [publikresultat](http://127.0.0.1:3000/results/10000000-0000-4000-8000-000000000002).
3. För startavprickning: öppna [offlineförberedelsen](http://127.0.0.1:3000/checkin/index.html#10000000-0000-4000-8000-000000000002).
   Kontrollera appskal och lagring, välj arbetsuppgift, separat lokal lösenfras
   och uttryckligt lagringssamtycke. Använd rätt roll ur den privata filen nedan.
4. Målpersonalens [kvar-i-skogen-lista](http://127.0.0.1:3000/admin/10000000-0000-4000-8000-000000000002/forest-watch)
   använder FINISH_FOREST_WATCH. Listan kan skrivas ut och visar senast synkade
   kunskap, inte en garanti att alla kommit tillbaka.

Lopp-id: `10000000-0000-4000-8000-000000000002`.
Översikten använder separat VIEW_RACE_OVERVIEW; mobilens startroll heter
START_CHECKIN. Roller ger inte automatiskt generell arrangörsbehörighet.

## Privat behörighetsfil

Tillfälliga credentials ligger endast i
`/private/tmp/otid-demo-access.zdHTEK/credentials.json` i en privat katalog.
De utfärdades för högst åtta timmar; kontrollera `expiresAt` i filen.
Kopiera respektive `accessCredential` till inloggningsfältet, aldrig till URL
eller repository. Detta är inte Eventor-nycklar. Ny utfärdning krävs efter
utgång; det ska inte lösas genom att stänga av autentisering.

## Kontroller och gränser

- Ny databas kontrollerades saknas före skapande och migrerades med befintlig
  migrationskedja. Befintlig seed importerade repositoryts syntetiska IOF-filer.
- Startsidan verifierades innehålla O-Tid demotävling; simulator och appskal
  svarade HTTP 200. Detta är en tillgänglighetskontroll, inte ett nytt fullständigt
  acceptansprov. TASK 006W:s tidigare verifiering redovisas separat.
- Endast loopback: en telefon kan inte öppna datorns 127.0.0.1. Mobiltest från
  annan enhet kräver en avsiktligt konfigurerad betrodd HTTPS-origin och separat
  driftupplägg. Exponera inte denna devserver på internet för att kringgå det.
- Demon innehåller den befintliga enkla seedens deltagare och banor; den är
  inte en kopia av Skärgårdshelgen eller ett bevis på verklig hårdvarufunktion.
- Webblogg: `/private/tmp/otid-demo-access.zdHTEK/web.log`. Inga credentials
  skrevs till loggen. Den privata databasen ändrades inte.

Återstart med samma databas (ingen ny seed behövs):

```bash
DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_demo_20260906 O_TID_PUBLIC_ORIGIN=http://127.0.0.1:3000 O_TID_SIMULATOR_MODE=loopback-development pnpm --filter @o-tid/web dev
```

PostgreSQL måste redan lyssna på lokal port 55432. Ingen automatisk
databasradering eller återställning ingår.
