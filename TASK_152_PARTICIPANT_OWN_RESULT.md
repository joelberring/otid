# TASK152: inloggad deltagare hittar eget publicerat resultat

Status: syntetiskt verifierad 2026-09-23. Beslut: ADR-0146.
Inte fältverifierad.

## Användarutfall

En redan betrott provisionerad deltagare får en engångskod för en exakt
anmälan från start-/tävlingsadministratören, loggar in, löser in koden och
ser under ”Mitt resultat” samma publicerade resultat/sträcktider efter en ny
inloggning på en annan enhet. Ett konto kan ha flera verifierade anmälningar.
Anonym publik fortsätter se publicerade resultat utan konto.

## Avgränsat vertikalt snitt

1. Migration 0079 och schema för immutable kodutfärdande, exakt en inlösen
   och spärr; inga gamla entries, konton eller resultatrevisioner ändras.
   Dokumentera rollback/restore enligt ADR-0146.
2. Strikta kontrakt och applicationoperationer för issue, redeem, revoke och
   kontobunden läsning. Race/entry och aktiv `MANAGE_RACE`-operatör kontrolleras
   server-side; deltagaren autentiseras med befintlig kontosession.
3. En liten utfärdande-/spärryta vid vald anmälan i befintlig raceadmin och
   en svensk, mobil läsbar ”Mitt resultat”-vy med konto-login, kodinlösen,
   tomt/väntande resultat och länk till befintlig publik detalj. Ingen ny
   resultatberäkning i React eller API-rutter.
4. Riktad PostgreSQL-, kontrakts-, webb- och browserverifiering följd av
   berörd lint, typecheck, tester och build. Syntetiskt och fysiskt bevis
   redovisas åtskilt.

## Acceptans

- Utfärdaren väljer exakt en entry och intygar privat identitetskontroll.
  Endast kodhash lämnar browsern; plaintext finns bara i det korta
  utfärdandeögonblicket. Förlust kräver spärr/ny kod.
- Inloggat konto löser in rätt kod en gång. Exakt retry är stabil; annat
  konto/intent med samma request-id, okänd/utgången/spärrad/använd kod samt
  samtidig andra inlösare nekas utan att röja entry eller skapa dubbel länk.
- En operatör kan spärra exakt felaktig koppling med spårbar orsak och
  utfärda nytt underlag; gammalt konto förlorar den skyddade listningen
  vid nästa request. Kontospärr/logout blockerar också läsning.
- Två anmälningar i skilda lopp syns under rätt konto efter ny session;
  opublicerat/saknat resultat får begripligt vänteläge. En senare publicerad
  eller korrigerad revision visas via befintlig publik projektion utan att
  rådata eller resultatets historik skrivs om.
- Fel konto ser inte kopplingen. Offentlig lista och detalj fungerar fortsatt
  utan login. 390 px-vyn är kompakt, tryckbar och läsbar utan horisontell
  scroll eller enbart färg som tillståndssignal.

## Ingår inte

Självregistrering, e-post/SMS, kontoåterställning, bevisad juridisk
vårdnadshavare, privata GPS-/ruttfält, ruttpubliceringssamtycke, följda
deltagare mellan enheter, ny resultatregel, live-GPS, riktig USB, stafett,
OMAP, Eventor-liveanrop eller uppgradering av gamla operatörscredentials.

## Säkra verifieringsförutsättningar

PostgreSQL-provet kräver uttryckligen isolerad migrerad testdatabas med
syntetiska konton och lopp. Kör databaswriters sekventiellt. Browserprovet
använder loopback, syntetiska personer och separat byggkatalog. Inga
verkliga tävlingsdata eller privat API-nyckel behövs. Fysisk mobil och
fältacceptans kvarstår även om samtliga riktade syntetiska prov är gröna.

## Verifierat utfall 2026-09-23

- Riktade Vitest-prov: databasschema 3/3, kontrakt 4/4, application mot ny
  isolerad PostgreSQL 4/4, webbens route-/kodprov 6/6.
- Playwright mot riktig Next-server, separat syntetisk PostgreSQL och 390 px:
  1/1 på 14,7 sekunder med utfärdande, inlösen, vänteläge, publicerad
  resultatrevision, nytt browsercontext, fel konto, anonym detalj och
  kontroll mot horisontell overflow. Testharnessens tsc och ESLint: exit 0.
- Lint, typecheck och build för vart och ett av database, contracts,
  application och web: samtliga exit 0 efter sista produktändring.
- Ett första browserförsök fastnade på en överflödig testselector efter
  lyckad direktanmälan; den rättades utan produktkodändring och slutkörningen
  passerade. En kvarvarande tom, oanvänd körningsunik testdatabas från ett
  tidigare försök inspekterades och togs bort. Den syntetiska källan bevarades;
  den isolerade PostgreSQL-instansen stoppades.

Kvarvarande antaganden: operatörens kontroll utanför systemet och privat
överlämning av både konto och engångskod är inte tekniskt verifierade.
Självregistrering, återställning, vårdnadshavarbevis, fysisk mobil och
fältbruk är inte levererade. Ett nytt browsercontext bevisar kontobunden
serverpersistens, inte stöd på alla faktiska enheter.
