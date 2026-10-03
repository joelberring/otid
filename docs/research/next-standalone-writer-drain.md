# Next standalone och TASK180:s dräneringsgrind

Datum: 2026-09-27. Läsande källgranskning; ingen Linux-/driftacceptans.

## Bekräftat i aktuell installation

- `apps/web/package.json` pinnar Next **16.3.3** och
  `apps/web/next.config.ts` använder `output: "standalone"`.
- `apps/web/src/proxy.ts` kontrollerar stoppmarkören **före** routekörning.
  Den får inte användas som räknare för när ett redan accepterat anrop
  faktiskt har avslutat DB- och objektlagringssteg. [Nexts Proxy-dokumentation](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
  avråder uttryckligen från att förlita sig på delade globala värden där.
- I den installerade Next 16.3.3-koden,
  `apps/web/node_modules/next/dist/server/lib/start-server.js:319-390`,
  hanterar produktionsservern SIGTERM med `server.close()` följt av
  `nextServer.close()`. Den väntar på aktiva HTTP-förbindelser; bara
  utvecklingsservern anropar `closeAllConnections()` i detta steg.
  [Node HTTP-dokumentationen](https://nodejs.org/api/http.html#serverclosecallback)
  beskriver att `server.close()` väntar på förbindelser som ännu skickar
  begäran eller väntar på svar. Ett svar kan däremot stängas när klientens
  anslutning avslutas i förtid. Därav följer **inte** ett bevis för att
  serverarbete som fortsätter efter klientavbrott har slutförts.
- [Nexts custom-server-guide](https://nextjs.org/docs/app/guides/custom-server)
  säger att en egen Next-server och `standalone`-utdata inte kan användas
  tillsammans. En processwrapper får därför inte väljas som en tyst
  implementation av ADR-0160.
- `ops/systemd/otid-web.service.example` har `KillMode=control-group` och
  `TimeoutStopSec=300s`. Systemd kan avbryta enheten vid timeout; unitens
  inaktiva tillstånd är inte ett bevis för att en påbörjad mutation avslutats.
- TASK211 stänger en redan öppen publik resultat-SSE vid nästa heartbeat när
  den styrda insläppsmarkören är stängd/osäker. Det tar bort en långlivad
  svarskälla men hubbens LISTEN-session lever tills processen stängs; detta
  är inte ett bevis för skrivande anropsavslut eller noll DB-sessioner.

## Beslutspunkt, inte ny arkitektur

Före `systemctl stop` eller en teknisk backupkvittens måste TASK180 visa en
**exakt avslutningskälla** för redan accepterade anrop, även när klienten
kopplar ned medan objektlagring pågår mellan två DB-transaktioner. Nästa
försök ska pröva nuvarande pinnade standalone-server med ett blockerat,
syntetiskt objektsteg och både kvarvarande och avbruten klient. Endast om
hela anropet verkligen avslutas före processens exit kan denna
SIGTERM-väg övervägas i controllern. Misslyckas det krävs ett separat ADR-
beslut för en annan process-/ingressgräns, med konsekvenser för
`standalone`-bygget och driftprofilen, **innan** implementation.

Även ett grönt HTTP-prov räcker inte ensamt: migration och den fasta CLI:n
måste få avsluta naturligt, nya starter nekas av markören, alla unit-/cgroup-
processer och writer-DB-sessioner måste kontrolleras, och credentialåtkomst
utanför profilen måste uteslutas. Ingen av dessa punkter är visad på Linux.

## Nästa verifiering i disponibel miljö

Använd endast en ny, isolerad Linux/systemd-installation med syntetisk
PostgreSQL/PostGIS och privat objektlagring. Pausa ett anrop efter första
DB-transaktionen men före objektstegets slut. Stäng markören, begär
graceful stop och kontrollera att objekt- och avslutande DB-steg är varaktigt
färdiga innan processen lämnar cgroupen. Upprepa med klient som kopplar
ned före objektsteget. Timeout/fel måste behålla markören och ge **inget**
stopp- eller backupbevis. Kör inga sådana försök mot demo eller tävlingsdata.

Den aktuella macOS-värden har ingen Linux/systemd-miljö; en befintlig
VMware-katalog innehåller bara en Windows-VM. Varken verkliga systemd-
semantiken eller Linux-acceptans är därför verifierade här.
