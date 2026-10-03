# Prova aktuell O-Tid – lokal demo 2026-09-07

Öppna [testresultatet](http://127.0.0.1:3001/results/fd400248-8b3b-4d9b-a6f8-62f8d52f7c73).
Det kräver ingen inloggning. Ada Löpare har ett syntetiskt godkänt resultat
på 40:00. Detta är inte Skärgårdshelgen eller riktig SPORTident-avläsning.

Servern kör bara på denna dator, `127.0.0.1:3001`. En telefon kan inte använda
adressen. Den tidigare demon på 3000 har gammalt schema och ska inte användas
för att bedöma senaste versionen. Båda gamla databaserna är bevarade.

## Prova en avläsning

1. Öppna [simulatorn](http://127.0.0.1:3001/admin/fd400248-8b3b-4d9b-a6f8-62f8d52f7c73/simulator)
   i den förberedda Codex-webbläsarfliken. Kontrollera att Enhet visar
   `e4da3319-f17b-4d90-a05c-f07e8d6a7300`.
2. Öppna privat `/private/tmp/otid-demo-preview.qwcoC7/station.json` och
   kopiera enbart värdet `token` till **Stationscredential**. Lägg aldrig
   token i URL, chatt, repository eller logg.
3. Ange bricknummer **67890** för Bo Skog, behåll kontrollerna **31,32,33**
   och välj **Simulera och skicka**. Kontrollera serverkvittensen.
4. Öppna resultatlänken igen; listan uppdateras automatiskt.

Om en annan browser visar ett annat enhets-id fungerar inte denna token.
En separat READOUT-credential måste då utfärdas för den faktiska enheten.
Ändra inte enhets-id eller lokala sekvenser för att kringgå kontrollen.
Den avläsning som redan finns gjordes av en annan, nu spärrad kontrollenhet;
din förberedda browsers lokala kö/sekvens är orörd.

## Personalvyer

Alla fyra JSON-filer nedan är mode 0600 i privat katalog. Kopiera endast
rollens `accessCredential` till motsvarande inloggningsfält, inte hela filen.

| Vy | Behörighet i `/private/tmp/otid-demo-preview.qwcoC7/` |
| --- | --- |
| [Tävlingsöversikt](http://127.0.0.1:3001/admin/fd400248-8b3b-4d9b-a6f8-62f8d52f7c73) | `credentials.json`: VIEW_RACE_OVERVIEW |
| [Startavprickning](http://127.0.0.1:3001/checkin/index.html#fd400248-8b3b-4d9b-a6f8-62f8d52f7c73) | `credentials.json`: START_CHECKIN |
| [Kvar i skogen](http://127.0.0.1:3001/admin/fd400248-8b3b-4d9b-a6f8-62f8d52f7c73/forest-watch) | `credentials.json`: FINISH_FOREST_WATCH |
| [Speaker](http://127.0.0.1:3001/admin/fd400248-8b3b-4d9b-a6f8-62f8d52f7c73/speaker) | `speaker.json` |
| [Klassbyte](http://127.0.0.1:3001/admin/fd400248-8b3b-4d9b-a6f8-62f8d52f7c73/classes) | `classes.json` |

Startavprickningens offlineförberedelse kräver egen lokal lösenfras och
uttryckligt lagringssamtycke. Jag har inte förberett någon privat offlinekö
i din browser. Skrivläge, lokal sparning och serverkvittens är skilda steg.
Kvar-i-skogen-listan visar bara senast synkade uppgifter och garanterar inte
att alla har återkommit.

## Giltighet

**Utgångna:** vid återkontroll 2026-09-07 kl. 20:35 svensk tid har dessa
testbehörigheter gått ut. Servern lyssnar fortfarande på lokal port 3001.
Instruktionerna för privata vyer och simulator kräver nya behörigheter;
de gamla filerna ger inte längre åtkomst.

Testbehörigheterna gäller till **2026-09-07 kl. 07:39:49 svensk tid**
(`2026-09-07T05:39:49.495Z`). De förlängs inte automatiskt. Publikresultatet
kan fortfarande läsas när behörigheterna gått ut, om servern kör.

Efter utgång behövs nya testbehörigheter från den betrodda rollhanteringen.
Radera inte databas eller lokal kö och stäng inte av autentisering. En ny
startcredential kan inte automatiskt överta en tidigare actors offlinekö;
behåll originalet och använd dokumenterad återhämtning om en kö finns.

## Återstart utan ny import

PostgreSQL måste köra på 55432. Använd samma databas och separat byggkatalog:

```bash
CI=true DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_demo_20260907_preview O_TID_PUBLIC_ORIGIN=http://127.0.0.1:3001 O_TID_SIMULATOR_MODE=loopback-development O_TID_LOCAL_DEMO=1 pnpm --filter @o-tid/web dev --hostname 127.0.0.1 --port 3001
```

Starta inte en andra process om porten redan används. Kör inte ny seed eller
demo:provision mot denna databas. `O_TID_DEMO_E2E` ska vara avstängd här.
Byggkatalogen är `.next-local-demo`, separat från `.next` och `.next-demo-test`.
Webbloggen finns i `/private/tmp/otid-demo-preview.qwcoC7/web.log`.

## Kontrollerat och inte kontrollerat

Ny tom databas migrerades genom 0037 och provisionerades med befintlig CLI.
Fem privata HTTP-läsvyer gav 401 anonymt och 200 med rätt roll samt no-store.
Syntetisk HTTP-ingest gav stored och duplicate vid exakt retry: en råpost och
en resultatrevision. Publikresultatet kontrollerades visuellt i appens browser.
Detta är ingen ny komplett offline-/USB-/mobilfältverifiering. API-nyckeln,
privata tävlingsdatabasen, gamla demon och uppladdade kartor ändrades inte.
