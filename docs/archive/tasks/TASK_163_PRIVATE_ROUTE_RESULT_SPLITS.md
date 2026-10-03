# TASK163: resultatets sträcktider bredvid egen privat rutt (C3b)

Status: avgränsad i ADR-0156 före kod; syntetiskt verifierad 2026-09-23.

## Användbart utfall

En inloggad deltagare kan i den redan privata, versionsbundna ruttvyn öppna
en kompakt lista över sina **aktuellt publicerade resultatsträckor** och
förstå att de kommer från resultatet, inte från GPX-markören. Saknas ett
giltigt OK-resultat med sträcktider syns ett tydligt saknat-läge.

## Bygg endast detta

1. Höj privat overlay till formatversion 3 och lägg till strikt
   `resultSplits: AVAILABLE|UNAVAILABLE`. `AVAILABLE` bär aktuell effektiv
   resultatrevision samt existerande kontrollkod/förekomst/sträcktid/
   ackumulerad tid. Inga interna identiteter eller nya GPS-data.
2. Härled i samma skyddade read-only transaktion från exakt ruttens entry
   och dess aktuella effektiva publicerade resultathuvud på samma historiska
   bana. Endast `OK` med totaltid och befintliga splits är `AVAILABLE`.
3. Visa separat svensk expanderbar lista bredvid GPX-vyn; skriv att resultatet
   kan vara preliminärt och att GPS-markören inte bevisar kontrollpassage.

## Minsta verifiering

- Kontrakt: accepterad/nekad form och saknat-läge.
- Isolerad PostgreSQL: exakt anmälan, ny effektiv revision, icke-OK/saknad
  split och fortsatt kontospärr.
- Ett riktat 390px-browserfall: sträcktider och proveniens skilda från
  uppspelningsreglaget, inget horisontellt spill.
- Berörd lint/typecheck, riktade tester och build med exakta resultat.

## Ingår inte

GPS-kontrollpassage, automatiskt tidsankare, sträcktempo, fler-ruttanalys,
OMAP, ny resultatstatus, publicering, GPS-inspelning eller fältacceptans.

## Verifierat utfall 2026-09-23

Den privata overlayen är formatversion 3 och har en obligatorisk strikt
`resultSplits`-gren. Servern läser den aktuella effektiva publicerade
resultatrevisionen för samma anmälan och bana, inte en GPS-härledning eller
en äldre reservrevision. Den expanderbara listan visar revision, kontroll,
sträcktid och ackumulerad tid; saknat läge är synligt utan expansion.

Riktade kontrakts-/webbprov: **5 filer, 19/19 tester**. Isolerat
PostgreSQL-prov med revisionbyte, MP och kontospärr: **1/1**. Riktigt
390px-browserprov mot lokal Next/HTTP och syntetisk PostgreSQL: **1/1**.
Berörd ESLint/typecheck för contracts, application, web och e2e gav exit 0.
Contracts/application TypeScript-build, `build:checkin` och Next-
produktionsbuild gav exit 0. Ingen full workspace-svit eller fysisk
telefon-/fältacceptans kördes. Första `initdb`-försöken stoppades av
sandboxens delat-minne-spärr respektive macOS:s fulla segmentgräns; ett
exakt övergivet segment från vårt eget försök rensades och en separat
syntetisk instans kunde därefter startas. `pnpm`-wrappern försökte nå
registry; installerade lokala binärer användes i slutkontrollerna.
Testinstansen stoppades efter proven och dess exakta syntetiska tempkatalog
raderades; den kan inte återställas.
