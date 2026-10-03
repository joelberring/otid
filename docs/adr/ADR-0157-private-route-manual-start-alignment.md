# ADR-0157: manuell tidsförskjutning av egen GPX mot resultatstart

- Status: Accepterad för C3c/TASK164 före implementation
- Datum: 2026-09-23

## Kontext

ADR-0155/0156 skiljer egen privat GPX-uppspelning från den effektiva
publicerade resultatrevisionens sträcktider. GPX-överlägget har redan
absolut starttid för en komplett monoton tidsserie, men inte resultatets
starttid. En klockskillnad mellan inspelaren och tävlingsresultatet kan
göra två annars korrekta tidslinjer svåra att jämföra. En kontrollcirkel
eller närmaste GPS-punkt är inte bevis för faktisk kontrollpassage.

## Beslut

Den befintliga kontoskyddade privata overlayen höjs till formatversion 4
och får en separat strikt `resultStart`-gren. `AVAILABLE` innehåller bara
den **aktuella effektiva publicerade** resultatrevisionens nummer och dess
normaliserade UTC-starttid. `UNAVAILABLE` saknar tid och revisionsdata.
Källan är `parseStrictStoredResultRevision` för samma exakta race/entry som
ruttens manifest, medan samma historiska `courseVersionId` fortsatt måste
gälla. En äldre publicerad revision är aldrig fallback. Starten får
exponeras för `OK` eller teknisk `MP` endast när det effektiva utfallet
faktiskt bär en validerad starttid; `INVALID_TIME_ORDER`, saknad start,
status-only DNS/DNF/NT samt DSQ/OOC ger `UNAVAILABLE`. Detta påstår inte
att en fysisk start observerades: för en klass med fast start är det
resultatets tilldelade start, för PUNCH dess validerade stämpling eller
explicit rättning. Inget råkort, intern identitet eller startbevis lämnar
servern.

Deltagaren får ange en **tillfällig, signerad heltalsförskjutning i sekunder**
inom ±86 400 för GPX-klockan. Om GPX:s första absoluta tidsstämpel är `G`,
resultatets start är `R` och vald korrigering är `O` sekunder, motsvarar
resultatstarten positionen `R − (G + O)` på den oförändrade relativa
GPX-tidslinjen. Endast om den positionen ligger inom `[0, GPX-duration]`
kan ”Visa vid resultatstart” flytta den befintliga uppspelningsmarkören dit.
Utanför tidsserien visas ett tydligt saknat-läge; ingen punkt klampas eller
fabriceras. Fältet återställs vid byte av rutt-/kontext-/resultatrevision,
lagras inte i server, URL, lokal cache eller GPS-fil och påverkar inte
resultatsträcktiderna.

UI benämner källorna ”GPX-klocka” och ”Resultatets starttid” samt säger att
detta är en **visuell tidsjämförelse**, inte GPS-verifierad start eller
kontrollpassage. De ordnade pixelpunkterna och segmentbrotten från C3a
förblir oförändrade. Ingen automatisk tidslinjering, start-/kontrollmatchning,
resultatändring, publicering, databas-migration eller ny behörighet ingår.

## Verifiering och konsekvenser

Kontraktstest skiljer tillgänglig och saknad resultatstart och avvisar
interna/GPS-fält. En ren tidsfunktion provas för positiv/negativ offset,
ändpunkter, utanför-intervall och ogiltiga tal. Ett isolerat PostgreSQL-prov
verifierar samma entry/banversion, aktuell revision, teknisk MP med/utan
start och fortsatt revokeringsgrind. Ett 390px-browserfall provar manuell
förskjutning och hopp utan att ändra resultatsträckor eller originalpunkter.
Berörd lint, typecheck och build körs. Syntetiska prov är inte klock-,
kart-, GNSS- eller fysisk mobilacceptans.
