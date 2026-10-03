# TASK196: disponibelt Linux-prov för en och samma skrivstoppsmarkör

Status: **provunderlag förberett, inte kört eller accepterat** 2026-09-27.
Detta följer TASK195 och ADR-0160; ingen driftprofil aktiveras här.

## Varför detta snitt

TASK194 kan beständigt skapa `/var/lib/o-tid/controller/closed`, TASK192:s
launcher nekar writerstart och TASK195:s Next-proxy nekar HTTP. De har ännu
inte provats tillsammans på ett riktigt Linuxfilsystem med systemd. macOS-
värden saknar systemd, Docker och VM-runner. Att köra fler injicerade
Mac-tester skulle inte fylla denna bevislucka.

## Endast disponibel miljö

Provet får köras enbart i en ny, återställbar Linux-VM med systemd som PID 1,
utan tävlingsdata, produktionscredentials, Eventor-nycklar eller åtkomst till
en verklig O-Tid-databas/objektlagring. Bekräfta VM-identitet och snapshot
utanför O-Tid innan några systemfiler skapas. `otid-writer` ska vara en separat
icke-root UID. Installera en granskad byggd release under `/opt/o-tid` och
provisionera en verklig root-ägd katalogkedja till
`/var/lib/o-tid/controller` (ingen symlänk eller grupp-/världsskrivrätt).
Starta aldrig de tre produktionsliknande `.service.example`-enheterna i
detta prov.

Den enda extra filen är
[`ops/systemd/fixtures/otid-admission-probe.service`](ops/systemd/fixtures/otid-admission-probe.service):
en oneshot-fixture som genom **samma** `writer-start.sh` kör `/usr/bin/true`
med en syntetisk, oanvändbar `database-url`. Den måste ligga i en disponibel
VM och kräver både en separat sentinel och credentialfil i en root-ägd 0700-
katalog under `/run/o-tid-admission-probe`; ingen riktig writer-credential får
användas.
Den aktiveras inte vid boot. `systemd-analyze verify` ska köras på den
installerade fixturen före start. Kontrollera faktiskt laddad `ExecStart`,
`User`, `LoadCredential` och båda markörvariablerna med `systemctl show`;
förlita dig inte bara på repositoryfilen.

## Två faser, ingen automatisk återöppning

1. **Öppet före markör:** verifiera med `lstat` att exakt markör saknas.
   Starta fixturen en gång med `systemctl start` och kontrollera
   `ExecMainStatus=0`, inte bara kommandots exitkod. Kör lokal Next-server
   bunden till `127.0.0.1` med `systemd-v1`, exakt markörväg och en
   syntetisk, oanvändbar `DATABASE_URL`; `GET /activate` ska ge 200.
   Inga mutations-API:er anropas i öppet läge.
2. **Beständigt stängt:** kör TASK194:s root-/Linux-kommando utan argument.
   Det måste ge `WRITER_ADMISSION_CLOSED_ONLY; NOT_DRAINED`, och markören
   måste vara tom, root-ägd 0600. Samma redan startade Next-process ska nu
   ge 503 samt `Cache-Control: no-store` för `/activate` och en statisk
   resurs. Ett nytt startförsök av fixturen ska ge `ExecMainStatus=78`;
   det visar launcherns spärr, inte att systemd avstod från att läsa sin
   syntetiska `LoadCredential`-källa. Inspektera systemd-status utan att kopiera
   credentials eller journalinnehåll till rapporten. Simulera en omstart av
   **endast** Next-processen; HTTP ska fortfarande ge 503. Markören får inte
   tas bort av ett `finally`-steg.

Bevara maskinens versions-/unit-/filmetadata och en kort tabell med de
faktiska HTTP-statusarna och `ExecMainStatus`, utan bearerdata. Återställ
hela disponibla VM:n från snapshot efteråt i stället för att köra en
produktionsliknande release-rutin. Om något avviker är utfallet **ej
accepterat**, inte en partiell backupkvittens.

## Bevisgräns

Detta provar en syntetisk systemd-start och Next-HTTP mot en fysisk Linux-
markör. Det provar **inte** att den verkliga webbenheten har säkra
credentials, att alla CLI-writers är inventerade, att redan accepterat
HTTP-/MinIO-arbete dräneras eller att writer-DB-sessioner är noll. Det
utfärdar inget `writeStopConfirmed`, ingen teknisk stoppkvittens och ingen
återöppning av en verklig installation. För den fulla TASK180-grinden krävs
fortfarande controller, credentialisolering, dränering och isolerad
PostgreSQL-/MinIO-acceptans.

## Lokal kontroll av underlaget

På macOS kan endast fixturens statiska innehåll granskas mot
`writer-start.sh` och den fasta markören. `systemd-analyze verify`, faktisk
`systemctl start`, Linux-filsemantik och Next-övergången är **inte körda**.
Den befintliga statiska writerinventeringen utökades med ett fixturfall:
`node --test ops/systemd/writer-inventory.test.mjs` gav **3/3, exit 0**;
`CI=true pnpm exec eslint ops/systemd/writer-inventory.test.mjs` gav
**exit 0**. `command -v systemd-analyze` gav **exit 1** på denna Mac.
Ingen lint/typecheck/build av produktkod är tillämplig; ingen produktkod
eller installerad enhet ändrades.
