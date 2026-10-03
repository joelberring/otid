# Prova deltagarflödet – lokal testtävling 2026-09-09

Öppna [Deltagare och startlista](http://127.0.0.1:3002/admin/6b44804f-c75f-4118-8726-9fad7446ea88/start-list).

Detta är en ny syntetisk tävling med Ada Löpare och Bo Skog, inte
Skärgårdshelgen. Dina privata tävlingar, kartor och gamla demodata är orörda.
Adressen fungerar bara på denna dator, inte från en annan telefon.

## Prova namn och klubb

1. Öppna [den privata startlistebehörigheten](/private/tmp/otid-manual-027.XY2nPs/start-list.json).
   Kopiera bara värdet `accessCredential` till **Startlistebehörighet** och
   välj **Logga in**. Kopiera inte hela JSON-filen.
2. Sök efter Ada eller Bo, öppna radens **Rätta** och välj **Namn och klubb**.
3. Öppna [den privata rättningsbehörigheten](/private/tmp/otid-manual-027.XY2nPs/identity.json).
   Kopiera dess `accessCredential` till **Namn- och klubbbehörighet** och
   logga in. Detta är en annan roll än startlistans.
4. Välj **Välj länkad deltagare**, ändra namn eller klubb och välj
   **Granska rättning**. Kontrollera före/efter och **Bekräfta och spara**.
5. Kontrollera **Rättningshistorik** under formuläret. Gå tillbaka till
   startlistan och välj **Uppdatera startlista** för att se ny text.

Direktlänk: [Namn och klubb](http://127.0.0.1:3002/admin/6b44804f-c75f-4118-8726-9fad7446ea88/entry-identity).
Vid direkt öppning väljer du deltagare i listan; ingen deltagare väljs
automatiskt. Tom klubb innebär uttryckligen ingen klubb. Gamla publicerade
kopior och resultat ändras inte automatiskt.

Du kan göra fler rättningar för att se historiken växa. Inga rättningar har
gjorts i detta manuella underlag vid överlämningen. Ett okänt svar kan betyda
att ändringen redan sparats: använd **Försök igen med samma begäran**.
Efter omladdning eller utloggning: läs aktuell lista/historik före nytt beslut.

## Privat åtkomst och giltighet

Startliste- och rättningsbehörigheterna gäller till **2026-09-10 kl.05:16:01
svensk tid** (`2026-09-10T03:16:01.000Z`). Sessioner gäller högst en timme;
logga in igen med samma ännu giltiga credential när sessionen går ut.
De förlängs inte automatiskt. Efter utgång behöver en betrodd operatör utfärda
nya roller, inte stänga av auth eller radera data.

De privata filerna är mode0600 i katalog mode0700. Lägg inte tokenvärden i
chatt, URL, repository eller logg. `credentials.json` i samma katalog är det
oförändrade grundmanifestet med tre andra roller, giltiga endast till
2026-09-09 kl.23:15:55 svensk tid; det ersätter inte filerna ovan.

## Drift och återstart

Ny databas: `otid_demo_20260909_participants`, PostgreSQL på127.0.0.1:55441.
Denna cluster är separat från automatiska testers55440 och från gamla
privata/demodatabaser. Den har lokal trust-auth och innehåller endast
syntetiska data: **ingen produktionsmiljö eller nätverksöppning**.

Webben kör på127.0.0.1:3002 med `.next-local-demo`. Den lämnas igång för
manuell provning, utan automatisk omprovisionering eller credentialförnyelse.
Utvecklingsservern kan däremot uppdatera gränssnittet när projektkoden ändras.
Först kontrollera att porten är ledig; starta aldrig dubbla processer.
Återstarta befintligt underlag, kör aldrig seed/provision på nytt:

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/otid-manual-027.XY2nPs/data status
# Bara om den är stoppad:
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/otid-manual-027.XY2nPs/data -l /private/tmp/otid-manual-027.XY2nPs/postgres.log -o '-h 127.0.0.1 -p 55441 -k /private/tmp/otid-manual-027.XY2nPs' -w start
CI=true O_TID_LOCAL_DEMO=1 DATABASE_URL=postgresql://joelberring@127.0.0.1:55441/otid_demo_20260909_participants O_TID_PUBLIC_ORIGIN=http://127.0.0.1:3002 pnpm --filter @o-tid/web dev --hostname 127.0.0.1 --port 3002
```

Stoppa webben med Ctrl-C i dess egen terminal (be om hjälp om den startades
av agenten). Stoppa därefter endast denna cluster, utan radering:

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/otid-manual-027.XY2nPs/data -m fast -w stop
```

Loggar finns privat i samma katalog: `web.log`, `postgres.log`, `migrate.log`.
Starta inte en gammal manuell server samtidigt med samma `.next-local-demo`.

## Kontrollerat

42 migrationer genom0041, ett lopp, två deltagare, tom rättningsjournal och
båda entryversioner1. Befintlig demo-CLI och båda separata roll-CLI:er exit0.
HTTP: sidor200, privata API401 utan auth, login/läsning200 med rätt roll,
fel roll401, logout204 och no-store. Testsessionerna är utloggade; ingen
privat session eller offlinekö har installerats i din browser.

TASK026:s separata browser→HTTP→PG-prov på1366/390px verifierade redan
spara/retry/historik och PII-rensning. Den manuella demon har inte utsatts för
testmutationer. Ingen ny full test-/build-/hårdvarusvit kördes för denna
provisionering med oförändrad programkod. Produktion, telefon över nät och
fysisk SPORTident är inte verifierade. Programmet är inte fullt MeOS-likvärdigt.
