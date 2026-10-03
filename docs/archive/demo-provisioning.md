# Reproducerbar lokal syntetisk demo (aktuell A2-ingång)

Den här sidan är den aktuella ingången för TASK078/A2. TASK007:s befintliga CLI
provisionerar en tom, redan migrerad PostgreSQL-databas med ett litet syntetiskt
tävlingsunderlag. Den startar inte webbserver, skapar inte databas och ändrar
aldrig en befintlig tävling. Endast repositoryts syntetiska IOF-fixtures används.
Ingen Eventor-nyckel eller fysisk SPORTident-utrustning behövs.

## Förbered separat mål

Använd en ny databas med namn `otid_demo_` följt av 1–48 gemena bokstäver,
siffror eller underscore. Sätt DATABASE_URL privat med explicit loopbackvärd
och port. Queryparametrar, kodade databasnamn och fjärranslutningar nekas.
NODE_ENV måste vara uttryckligen development eller test. Kör migration separat
mot det valda nya målet; kör **inte** den äldre db:seed först.

Exempel för lokal PostgreSQL, med ett nytt valt databasnamn:

```bash
export DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_demo_nytt_prov
NODE_ENV=development pnpm db:migrate
```

Databasen måste först ha skapats separat av en betrodd operatör. Kopiera inte
kommandot med ett produktionsmål. Verktyget kräver både namngrind, faktiskt
databasnamn och tomma applikationstabeller; befintlig data rensas aldrig.

## Provisionera

Skapa en privat katalog utanför repositoryt. På macOS ska den kanoniska
sökvägen användas, exempelvis `/private/tmp`, inte symlänken `/tmp`.
Föräldrakatalogen måste ägas av operatören och sakna grupp-/övrig åtkomst.

```bash
task_demo_private_dir="$(mktemp -d /private/tmp/otid-demo.XXXXXX)"
NODE_ENV=development pnpm demo:provision --confirm synthetic-empty-database --private-output "$task_demo_private_dir/credentials.json"
```

Outputfilen skapas exklusivt med mode 0600. Existerande filer och symlänkar
avvisas utan överskrivning. Samma privata manifest innehåller kortlivade roller
för tävlingsadministration (`MANAGE_RACE`) och de begränsade operativa vyerna
`VIEW_RACE_OVERVIEW`, `START_CHECKIN` och `FINISH_FOREST_WATCH`. Kopiera varje
`accessCredential` endast till den vy som anges i manifestet. De är inte
Eventor-nycklar. `MANAGE_RACE` är den gemensamma administratörsinloggningen för
hela A2-provet; den ersätter inte stationscredentialen för simulatorn.
Stdout visar endast en validerad sammanfattning med lopp-id, giltighetstid och
relativa testlänkar. Tokenmaterial ska inte kopieras till logg eller URL.

På macOS kan du slippa leta i JSON-filen och kopiera just den giltiga
administratörsbehörigheten med:

```bash
pnpm demo:access:copy --private-manifest "$task_demo_private_dir/credentials.json"
```

Kommandot läser den redan skapade privata filen, ändrar den inte och skriver
aldrig nyckeln i terminalen. Klistra in med ⌘V i **Administratörsbehörighet**
och välj **Logga in**. Urklippet är tillfälligt och kan läsas av andra lokala
appar; skriv över det efteråt. Utgången behörighet måste återutfärdas via
betrodd rollhantering, inte genom att köra provisionering igen.

Fel före/under provisionering kan lämna en tom eller skriven privat fil.
Den behålls avsiktligt. Ett fel under databascommit kan vara osäkert: kontrollera
databasens tillstånd och privat output innan nytt försök. Byt inte bara namn
på filen och kör igen. Skrivfel rullar tillbaka DB, men fil och databas har
ingen gemensam atomisk commit. En redan provisionerad databas avvisas på nytt.

## Starta och prova A2-flödet

Använd den validerade sammanfattningen från `demo:provision` för loppets id och
relativa paths. Den privata administratörsvägen är `/admin/{raceId}/manage`.
Starta en lokal server med samma `DATABASE_URL`:

```bash
O_TID_PUBLIC_ORIGIN=http://127.0.0.1:3000 O_TID_SIMULATOR_MODE=loopback-development pnpm --filter @o-tid/web dev
```

Öppna sammanfattningens paths under den lokala origin du valde:

1. Öppna `/admin/{raceId}/manage` och klistra in manifestets `MANAGE_RACE`
   credential i **Administratörsbehörighet**. Välj **Logga in**. Sök efter
   Ada eller Bo och öppna deltagaren i arbetsvyn.
2. Prova klassbytet genom **Granska klassbyte**. Kontrollera före/efter,
   målklassens faktiska startregel och platsunderlaget innan du bekräftar. Ett
   D21-underlag på `1/2` ska visas och servern ska fortfarande avvisa ett byte
   om gränsen hunnit nås. Byt gärna tillbaka Ada till H21 efter provet så att
   demodata åter visar både fri start och minutstart.
3. Kontrollera startupplägget i **Klassens startupplägg**: Ada/H21 använder
   startstämpling och Bo/D21 har fast minutstart. Ändra inte klassregeln om du
   vill behålla detta blandade demounderlag för resten av provet.
4. Öppna `/results/{raceId}`. Publikresultat kräver ingen inloggning. För att
   få ett syntetiskt resultat i en ny demo, följ simulatorsteget nedan först.
5. Simulatorn visar ett enhets-id. Utfärda en separat enhetsbunden READOUT-
   credential med befintlig betrodd station-CLI och klistra in dess `token` i
   fältet Stationscredential. Använd samma DATABASE_URL och lopp-id som i
   sammanfattningen; välj en kort explicit utgångstid, exempelvis `expiresAt`.
   Skriv endast till en ny privat fil, inte terminal/logg:

   ```bash
   umask 077
   pnpm exec tsx scripts/station-credential.ts issue --device-id <simulatorns-uuid> --race-id <loppets-uuid> --expires-at <ISO-tid> > "$task_demo_private_dir/station.json"
   ```

   `MANAGE_RACE` och de tre begränsade arrangörsrollerna fungerar inte som
   stationscredential. Simulatorn kan därefter skicka syntetiska avläsningar
   för bricka 12345 eller 67890. Ladda sedan `/results/{raceId}` igen.
   Simulatorn är inte USB-stöd.

Check-in och målpersonal ligger kvar som separata operativa prov:

- `/checkin/index.html#{raceId}` använder `START_CHECKIN`, separat lokal
  lösenfras och uttryckligt lagringssamtycke.
- `/admin/{raceId}/forest-watch` använder `FINISH_FOREST_WATCH` och visar
  senast synkade uppgifter; listan garanterar inte att skogen är tom.

Servern stoppas med Ctrl-C i dess terminal och återstartas med samma kommando,
utan ny seed/provisionering. Utgångna credentials återutfärdas endast genom
betrodd rollhantering; radera inte data eller stäng av auth för att få åtkomst.
En annan mobil kan inte använda datorns loopbackadress: betrodd HTTPS-drift
måste konfigureras separat. Exponera inte denna utvecklingsserver på internet.

## Stopp och begränsningar

### Valfri nyckelfri lokal utvecklingsåtkomst (TASK186)

För UI-arbete kan `apps/web/.env.local` ange
`O_TID_DEV_AUTO_LOGIN_RACE_ID=<det egna demoloppets UUID>`. Då öppnas
`/admin/<raceId>/manage` automatiskt utan att klistra in en nyckel. Efter
sessionsutgång räcker omladdning eller knappen **Öppna testtävlingen**.
Vanliga sessionscookies, CSRF och behörighetskontroller används fortfarande.

Kräver `NODE_ENV=development`, konfigurerad exakt HTTP-loopback-origin och
lokal `otid_demo_`-databas. Kör servern bunden till loopback, aldrig bakom
publik proxy. Läget är alltid av i produktion och E2E. Det ger bara tillgång
till det valda loppets sammanhållna administration, inte separata roller,
andra tävlingar eller kontohantering. Ta bort flaggan för att stänga av.
Se [ADR-0162](adr/ADR-0162-local-development-demo-access.md).

Stoppa webben med Ctrl-C i dess terminal och återstarta samma server mot samma
databas utan ny seed eller ny provisionering. Stoppa endast den separata lokala
PostgreSQL-klustret enligt dess driftkommando; radera inte demodatabasen för att
försöka börja om.

Detta är ett syntetiskt A2-prov: ingen riktig tävling, Eventor-nyckel, telefon
över nät, fysisk SPORTident, produktions-HTTPS eller produktionslast verifieras.
Simulatorn använder syntetiska payloads och är inte USB-stöd. Begränsade roller
ger inte generell administratörsbehörighet, och utgångna credentials ska inte
återanvändas.

Den äldre `db:seed`-starten, fasta race-id:n och äldre lokala demoguider är
**legacy** och ska inte användas för att bedöma aktuell version.

## Verifieringsläge

CLI, privat fil, policy och atomisk DB-provisionering är verifierade med
automatiserade riktiga fil-/PostgreSQL-prov. Ett genomgående browserprov med
CLI-provisionerade roller och separat stations-CLI har också passerat:
gemensam administration med platskontroll och klassbyte → återställd blandad
start → simulator → offentligt resultat → offlineavprickning → reload → synk →
privat utskrivbar målvy. Detta är syntetisk funktion, inte fysisk
SPORTident-verifiering.
PostgreSQL-testet skapar/raderar bara egna slumpnamngivna syntetiska testdatabaser
och kräver CREATEDB för testrollen, inte för CLI:n.

Browserprovet körs separat, aldrig mot den manuella demon:

```bash
# Välj och skapa först en NY tom otid_demo_-databas.
export DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_demo_nytt_browserprov
export TEST_DATABASE_URL="$DATABASE_URL"
OTID_DEMO_TEST_CONFIRM=synthetic-empty-database pnpm test:demo:e2e
```

Provet migrerar det uttryckligt valda nya testmålet och använder port3107 med
separat byggkatalog. Testdatabasen lämnas kvar; omkörning kräver ett nytt tomt
mål, inte reset. Tillfälliga testcredentials tas bort från fil efter provet.
En redan installerad service worker byts först när gamla appflikar stängts;
appuppdatering får aldrig kringgå lokal köhantering med automatisk radering.
