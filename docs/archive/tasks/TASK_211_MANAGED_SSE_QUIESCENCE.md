# TASK211: avsluta öppen resultatström när styrt HTTP-insläpp stängs

Status: implementerat och riktat syntetiskt verifierat 2026-09-27;
inte skrivdränering eller backupbevis.

## Operatörsutfall

En öppen publik resultat-SSE ska inte hålla den styrda webbprocessens
HTTP-svar öppet på obestämd tid efter att installationsmarkören har stängt
nytt insläpp. Samma fail-closed kontroll som i TASK195 används före första
strömdata, efter asynkrona steg och vid heartbeat. Vid stängning avslutas
strömmen och dess subscriber/timer avregistreras. Omanagerad utveckling är
oförändrad. EventSource-klienten får återansluta när installationen åter
öppnas enligt ett separat, ännu ej implementerat beslut.

## Gräns

Endast `apps/web/src/lib/public-result-event-stream.ts` och ett riktat
syntetiskt enhetstest. ADR-0160/TASK180:s installationsgräns gäller redan;
ingen ny ADR behövs. Ingen signal-handler, global räknare, produktionsroute,
markör-release, CLI-enhet eller teknisk `writeStopConfirmed` införs. Den
globala PostgreSQL LISTEN-klienten lever fortfarande tills processen
avslutas; stängd SSE visar inte noll writer-sessioner.

## Kontroll

Riktat test visar både markör före strömstart och markör under öppen
heartbeat. Kör berörd web lint/typecheck/test/build. Hela skrivande
DB–objekt–DB-anropet, klientavbrott och faktisk SIGTERM/systemd måste provas
separat på disponibel Linux-installation innan TASK180 kan få stoppbevis.

## Utfall

Strömmen kontrollerar den pinnade insläppsgrinden före listener-anskaffning,
efter asynkrona steg, vid notifiering och varje 25-sekunders heartbeat.
Stängning tar bort subscriber, timer och abort-lyssnare. Ett klientavbrott
under asynkron uppstart lämnar inte en ström öppen. En reader-cancel gör
cleanup utan att stänga en redan avbruten stream controller igen.

Riktad Vitest: **3/3 SSE-tester, exit 0**; slutlig kombinerad körning med
TASK195:s markörprov: **2 filer, 8/8 tester, exit 0**. Web lint, typecheck
och build: var för sig **exit 0**. Ingen PostgreSQL, MinIO, riktig klient,
Linux eller systemd användes. Även efter SSE-stängning behålls hubbens
globala LISTEN-klient tills webbprocessen avslutas; detta är inte ett
sessions- eller writer-dräneringsbevis.
