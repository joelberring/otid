# TASK164: manuell GPX-klockjustering mot resultatstart (C3c)

Status: syntetiskt verifierad 2026-09-23 enligt ADR-0157; inte fältklar.

## Användbart utfall

Deltagaren ser resultatets aktuella starttid intill den egna tidsatta GPX-
rutten, kan ange en tillfällig klockförskjutning och hoppa till motsvarande
punkt i sin uppspelning. Det framgår vad som kommer från resultatet och vad
som kommer från GPX, och när jämförelsen inte kan göras.

## Bygg endast detta

1. Höj skyddad privat overlay till formatversion 4 med strikt
   `resultStart: AVAILABLE|UNAVAILABLE`; `AVAILABLE` bär effektiva
   resultatrevisionen och UTC-starttiden för samma exakta anmälan/bana.
2. Läs starttiden från befintligt strikt validerat aktivt publicerat
   resultathuvud. Ingen äldre fallback, ny writer, migration eller
   resultatstatus. `OK`/teknisk `MP` med giltig start kan vara tillgänglig;
   övriga fall ger `UNAVAILABLE`.
3. Implementera ren tidsskillnadsfunktion och kompakt svensk kontroll i
   befintlig privat ruttvy. Tillfällig offset i sekunder ±86 400; hopp
   endast inom faktisk GPX-tidsserie. Ursprungspunkter och splits ändras
   aldrig.

## Minsta verifiering

- Riktat kontraktsprov och rena tidsgränsprov.
- Isolerad PostgreSQL för aktuell resultatrevision, saknad/MP-start,
  exakt entry och revokerad deltagarkoppling.
- Ett 390px-browserfall för klockjustering, hopp, saknat-läge och
  ingen horisontell scroll.
- Berörd lint/typecheck, riktade tester och build med exakta resultat.

## Ingår inte

Automatisk start-/kontrollpassage, manuell ruttgeometri, persisterad
alignment, tidsbeskärning, GPS-inspelning, OMAP, fler-ruttjämförelse,
ny resultatregel eller fältacceptans.

## Utfall och verifiering 2026-09-23

Privat overlay är formatversion 4 och håller aktuell resultatstart skild från
GPX-klockan. Den manuella förskjutningen och hoppet ligger bara i den egna
vyns minne; saknad eller utanförliggande tid visas utan påhittad punkt.
Riktade enhetsprov: 6 filer, 24/24 tester. Application mot separat lokal
syntetisk PostgreSQL: 1/1. Ett 390px-browserfall mot riktig Next/HTTP och
egen syntetisk PostgreSQL-underdatabas: 1/1; browsern simulerade endast
kartbildens bytes. Berörd ESLint och TypeScript-kontroll gav exit 0 för
contracts, application, web och e2e. Contracts- och application-build,
`build:checkin` och Next-produktionsbuild gav exit 0. Installerade lokala
binärer användes eftersom pnpm-wrappern försökte nätverkshämtning.

Kvarvarande antaganden: publicerad resultattid kan vara preliminär eller
rättad; verkliga GPX-/resultatklockor, kartprecision, objektlagring och
mobilens beteende i fält är inte verifierade. Uppspelningen är ingen
GPS-verifierad start eller kontrollpassage.
