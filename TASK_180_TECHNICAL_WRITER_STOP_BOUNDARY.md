# TASK180: tekniskt skrivstopp som bevisad backupgräns

Status: **ADR-beslut, HTTP-grind, icke aktiverad startprofil och beständig
markörstängning finns; full controller/dränering, installation och tekniskt
bevis återstår**.
[ADR-0160](docs/adr/ADR-0160-technical-writer-stop-process-boundary.md)
väljer en synlig installations-/processgräns och en dedikerad Linux/systemd-
installation som första implementeringsprofil. TASK192 har lagt exempelenheter
och en fail-closed startkontroll, men de är varken installerade eller provade
under systemd och täcker inte alla CLI-starter. Ingen fullständig controller eller fysisk
credentialgräns är integrerad. TASK190 har lagt ett partiellt HTTP-insläpp
före Next-rutter, men det stoppar varken pågående anrop eller objektsteg och
utfärdar inget stoppbevis. TASK194 skapar nu bara markören beständigt och
utfärdar uttryckligen inget dränerings- eller backupbevis. TASK195 pinnar
dessutom HTTP-ingången till samma Linux-/root-ägda
markörväg som writerstarten. Inget av stegen är en installerad controller.
TASK196 har bara förberett en syntetisk systemd-fixture och en tvåfasig
Linux-acceptans; den är inte körd och lägger ingen produktionswriter.
Källgranskningen 2026-09-27 visar dessutom att TASK190:s proxy bara ser
insläpp: ett systemd-stopp kan inte kallas dränering förrän den pinnade
standalone-serverns hela anrop, inklusive klientavbrott under objektsteg,
är verifierat på Linux. Se
[Next-dräneringsgrinden](docs/research/next-standalone-writer-drain.md).
TASK211 stänger nu en redan öppen läsande resultat-SSE när den styrda
markören stängs, men hubbens LISTEN-session och skrivande anrops avslut
återstår att bevisa; det ändrar inte TASK180:s öppna status.
TASK212 har förberett en statiskt verifierad, explicit opt-in Linux-probe
för just standalone-uppladdningens SIGTERM-/klientavbrottsfråga. Den är inte
körd mot PostgreSQL/MinIO/Linux och utfärdar inget stoppbevis.
TASK213 har därefter lagt en läsande Linux-/root-preflight för den fasta
webb-/migrations-/speakerprofilens unit-, sökvägs- och credentialkällmetadata.
Den är bara syntetiskt testad och installerar eller aktiverar inte profilen;
den kan inte ersätta fysisk credential-/systemd-acceptans.
TASK214 förbereder nu en separat, icke aktiverande installation av just dessa
tre unitfiler, med stängd markör, privatkällor och strikt icke-hemlig
konfiguration som förvillkor. Även detta är bara syntetiskt testat; ingen
installation eller systemd-/credentialisolering är accepterad.
TASK180 är nästa minsta D1b.4g-snitt efter
[TASK179](TASK_179_DURABLE_BACKUP_RESTORE_HANDOFF.md). Detta är ett
delmål för att kunna lita på en framtida operativ backup, inte en ny
tävlingsfunktion eller en färdig backup-CLI.

Inventeringen återkontrollerades 2026-09-27: 40 `scripts/*.ts`-filer öppnar
egna DB-pooler via 77 deklarerade kommandon, och `db:seed` är en ytterligare
writer utanför den katalogen. Endast TASK193:s fasta speaker-spärrning har nu
en **icke aktiverad** CLI-enhetsmall i `systemd-v1`-profilen; övriga CLI-
kommandon är förbjudna där. En statisk käll-/unitkontroll upptäcker ändring av
den granskade listan eller av mallarnas fasta markör/startkommando.
Detta är ett inventeringsbevis, **inte** credentialisolering, stopp, dränering
eller Linux-acceptans. Riktad Node-kontroll 5/5, ESLint och shellsyntax gav
exit 0; typecheck/build är inte tillämpliga på detta dokument-/`.mjs`-snitt.
Generisk CLI-unit är fortsatt avvisad; den enda nya mallen kastar bort
stdout/stderr och skriver en separat privat kvittens.

## Operatörsutfall

Operatören kan i en isolerad O-Tid-installation sätta ett verkligt skrivstopp
före dump/källpreflight, vänta tills redan påbörjade skrivningar är avslutade
och se ett verifierbart tillstånd där ingen ny serverwrite kan börja. Läsning
som uttryckligen tillåts ska fortfarande fungera. Återöppning kräver ett
separat, medvetet beslut; fel eller omstart får inte tyst släppa spärren.
Nuvarande `writeStopConfirmed` är bara ett intygande, inte detta bevis.

## Besluts- och leveransordning

1. Inventera faktiska server-writers och deras transaktionsgränser: ingest,
   admin-/anmälansändringar, auth/session-sidoeffekter, upload-/jobbvägar och
   andra mutationsportar. Skilj server-writers från lokala offlineköer som
   fortfarande måste kunna spara lokalt men inte synka under stoppet.
2. ADR-0160 kompletterar ADR-0140:s mänskliga skrivstoppsintygande och
   väljer Linux/systemd som första supervisorprofil. Gör den **konkret** med
   deklarerade webb-/worker-/CLI-/migrationsenheter, separat writer-principal,
   privat credentialöverlämning och en controller som håller ingress stängd
   och hindrar omstart. Enbart en processlista eller noll DB-sessioner vid
   ett ögonblick räcker inte.
3. Implementera bara den valda minsta gränsen. Den ska hindra en ny write från
   att korsa konsistenspunkten och vänta ut pågående transaktioner innan
   backupgrund får läsas. Osäkerhet ska ge ett fail-closed besked, inte ett
   falskt `writeStopConfirmed`.
4. Prova mot en uttryckligen vald **isolerad syntetisk PostgreSQL/PostGIS**:
   pågående write kontra stop, ny write efter stop, release, fel/omstart och
   minst ett representativt anrop från varje inventerad writer-klass, även en
   uppladdning vars objektsteg ligger mellan DB-transaktioner. Redovisa
   täckningsmatris och kvarvarande vägar. Kör riktad lint, typecheck, tester
   och build för berörda paket; ingen stor testsvepning som ersätter
   täckningsbeviset.

TASK180 får bara markeras syntetiskt verifierad om hela den beslutade
servergränsen och dess negativa samtidighetsfall är visade. Om inventeringen
visar att den inte kan täcka alla writers inom detta snitt, dokumentera
blockeringen och välj en smalare verifierbar drift-/processgräns i ADR innan
implementation. Påstå inte att en race-scope-låsning stoppar hela servern.
Den nuvarande macOS-värden saknar Docker, systemd och VM-runner; riktade
kodtester här kan inte ersätta acceptans mot riktiga systemd-enheter i en
disponibel Linux-miljö.

## Ingår inte

Exklusivitet för MinIO-replikeringsregler, betrodd operatörs-CLI, automatisk
backupplanering, produktionscredentials, writer-release efter osäker regel-
cleanup, verklig tävling, Eventortrafik, SPORTident-/GPS-hårdvara, TLS-
driftsättning eller fältacceptans. Dessa får separata efterföljande snitt.
