# TASK180: genomförbarhet för Linux/systemd-profil

Kontrollerad 2026-09-23 genom läsning av repositoryt och skrivskyddade
värdkontroller. Detta är en genomförbarhetsbedömning och målprofil, inte
implementation, driftsättningsinstruktion eller Linux-acceptans.

## Värd och repository

- Värden rapporterar macOS 26.6.2 (BuildVersion 25G83), arm64.
  `/bin/launchctl` finns.
- `docker`, `systemctl`, `podman`, `multipass`, `limactl`, `colima` och
  `qemu-system-aarch64` saknas. Värden kan därför inte köra eller verifiera
  den valda systemd-profilen.
- `docker-compose.yml` startar endast Postgres 17/PostGIS och MinIO. Den har
  en gemensam utvecklingsroll `otid` och MinIO-rootcredentials; den styr inte
  webb, worker eller betrodda CLI-processer.
- Webbens `apps/web/src/lib/db.ts` skapar en pool per process. `apps/worker`
  är en placeholder. `packages/database/src/index.ts` erbjuder en vanlig
  PostgreSQL-pool.
- Repositoryt har 41 TypeScript-filer under `scripts/`; 39 innehåller
  `createDatabase(`. CLI:er
  kan alltså ha egna pooler oberoende av webbservern.
- Rutt- och kartuppladdning gör objektlagringsanrop mellan DB-transaktioner
  (`packages/application/src/route-upload.ts` och `map-asset.ts`). Noll aktiva
  DB-transaktioner visar inte att en PUT är avslutad.

## Varför befintliga prov inte räcker

TASK171–179 och befintliga backup-/restoreprov börjar med antagandet
`writeStopConfirmed`; de styr inte ingress, processstarter eller credentials.
Manifest- och capturetester accepterar samma booleska intygande. Mockar,
routeprov, en processlista eller ett enstaka `pg_stat_activity`-utdrag kan
inte visa att en ny CLI, process eller objektanslutning förblir spärrad efter
controllerfel. MinIO-kompatibilitetsprov testar inte samtidiga O-Tid-writers.
Se inventeringen i `task180-writer-inventory.md` och beslutet i
`../adr/ADR-0160-technical-writer-stop-process-boundary.md`.

## Vald målprofil

Följ ADR-0160: en dedikerad Linux-installation där systemd äger O-Tids
writer-processer. En betrodd controller skriver och synkroniserar ett
beständigt stoppbeslut före dränering, stänger HTTP-ingress, hindrar omstart
av samtliga deklarerade webb-, worker-, CLI- och migrationsenheter, dränerar
hela anrop inklusive objektsteg och verifierar därefter att writer-processer
och writer-DB-sessioner är noll. Backupens läsprocess har separat credential.
Writer-DB- och MinIO-credentials ska bara vara tillgängliga för den
kontrollerade serviceidentiteten och startvägen; externa skrivare eller
oinventerade credentials gör stoppbeviset ogiltigt. Controllerkrasch,
timeout och reboot lämnar stoppet aktivt. Återöppning är en separat avsiktlig
åtgärd. Första profilen får stänga även läsning under pausen.

Root/OS-administratör och lagringsadministratör är uttryckliga
förtroendegränser. Beviset gäller bara den inventerade installationen.
Repositoryt saknar ännu systemd-enheter, controller, credentialgräns och
Linux-acceptansharness; profilens införande och acceptans återstår.

Senare delsteg 2026-09-25: TASK192 har lagt **icke aktiverade** exempelenheter
och en startkontroll; ovanstående inventering är ett historiskt läge från
2026-09-23. [Systemds credentialdokumentation](https://systemd.io/CREDENTIALS/)
bekräftar `LoadCredential=` och `$CREDENTIALS_DIRECTORY` samt att vanliga
miljövariabler ärvs av barnprocesser. Den rekommenderar mount-namespacing för
att isolera servicecredentials. Befintliga O-Tid-processer läser fortfarande
miljövariabler; TASK192:s bridge är därför ett ofärdigt säkerhetssteg, inte
least-privilege-bevis. [Node 24.11:s processdokumentation](https://nodejs.org/download/release/v24.11.0/docs/api/process.html#processexecvefile-args-env)
märker `process.execve()` som experimentell, så exempellaunchern använder
POSIX-shellens `exec` i stället. Ingen Linux-värd eller systemd-körning har
använts för denna uppdatering.

## Framtida processacceptans

Kör i en disponibel Linux-VM med systemd, ny isolerad migrerad
PostgreSQL/PostGIS och privat syntetisk MinIO. Kör inte mot demo- eller
tävlingsdata. Harnessen ska använda riktiga systemd-enheter, PostgreSQL-
sessioner och MinIO-versionslistning; mocks får komplettera men inte ersätta
dem. Kräv följande observerbara fall:

1. Blockera syntetisk HTTP-uppladdning efter att MinIO PUT startat. Begär stopp;
   stoppbevis får inte utfärdas förrän PUT och handler är avslutade.
2. När stoppet satts, försök starta nya mutationer via HTTP och var och en av
   de tillåtna CLI-/migrationsvägarna. De ska nekas innan DB- eller
   objektanslutning; ingress ska förbli stängd.
3. Täck ingest, admin/anmälningsändring, auth/session-sidoeffekt, workerjobb,
   route-/kartuppladdning och migration/underhålls-CLI i en redovisad matris.
   Prova en lokal stationkö offline och visa att serverstopp inte raderar den.
4. Efter dränering verifieras noll processer i writer-cgroupen, noll sessioner
   och transaktioner för writer-principalen samt oförändrad MinIO-versionlista.
   Okänt tillstånd ska neka stoppbevis.
5. Döda controllern efter beständigt stoppbeslut och starta om VM/enheter.
   HTTP och varje stödd writer-start ska fortsatt nekas tills explicit release.
6. Verifiera att läsning följer den valda profilen (stängd i första profilen),
   och att separat explicit release återöppnar en syntetisk mutation.

Ingen Linux-provkörning har gjorts. Först efter implementation ska riktad lint,
typecheck och kodtester köras; de ersätter inte ovanstående processacceptans.
