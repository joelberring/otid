# TASK156: begriplig delningsstatus för vald privat GPX-version

Status: syntetiskt verifierad 2026-09-23. Beslut: ADR-0150. C2c, inte hela deltagarprodukten.

## Användarutfall

En inloggad deltagare öppnar en av sina privata GPX-versioner och ser på
samma sida om just den versionen har samtycke, aktivt administrativt kart-/
ruttsläpp och en faktiskt tillgänglig offentlig ruttvy. Ett återtagande tar
bort offentlig länk men inte deltagarens privata original.

## Minsta vertikala snitt

1. Versionshöj det befintliga kontoskyddade detaljkontraktet med tre tydliga
   delningsfakta och publik länkidentitet endast när faktisk publik läsning
   lyckas. Ingen ny skrivväg eller migration.
2. Härled tillstånden i en skyddad, loppomfattande lästransaktion från senaste
   exakta samtycke, ruttrelease, kartrelease och **samma** publika route-gate
   som den öppna resultatsidan använder. Två GPX-versioner får inte blandas.
3. Visa korta svenska statusrader på befintlig deltagardetalj vid 390 px.
   Länk visas endast för faktiskt publik version; samtycke ensamt får aldrig
   beskrivas som publicering.
4. Kör riktade kontrakts-, PostgreSQL-, webb- och browserkontroller samt
   berörd lint/typecheck/build. Redovisa exakta utfall och resterande bevis.

## Acceptans och stoppunkt

- Två privata versioner: bara den exakt samtyckta och släppta versionen kan
  få publik länk. Ingen intern identifierare eller rå koordinat exponeras.
- Samtycke utan släpp, släpp utan aktiv karta, återtaget samtycke/släpp och
  saknat aktivt publikt resultat eller kompatibel geometri ger ingen publik
  länk. Den privata detaljen fortsätter fungera för rätt konto.
- Anonymt/annat konto/spärrad koppling kan inte läsa privat delningsstatus.
  Publik länk omprövas av den befintliga offentliga gaten vid varje klick.
- Ingen synlig horisontell scroll vid 390 px. Syntetisk verifiering märks
  inte som fysisk mobil, riktig objektlagring eller fältklarhet.

## Ingår inte

Nytt samtyckesflöde i kontot, GPS-inspelning/liveposition, ny publicerings-
motor, OMAP, ny ruttanalys, SPORTident, stafett eller fysisk driftacceptans.

## Verifierat utfall 2026-09-23

- Den befintliga privata detaljvägen returnerar nu version 2 med separat
  samtycke, exakt aktivt administrativt kart-/ruttsläpp och faktiskt
  tillgänglig publik rutt. Endast sistnämnda får `publicResultId` som länk.
  Publik tillgänglighet använder samma servergate och ruttprojektion som
  den öppna ruttsidan; vald GPX-ID/hash måste också matcha.
- Riktat kontraktsprov: 4/4; webbruttprov: 3/3; application mot isolerad
  PostgreSQL17/PostGIS: 1/1 med två GPX-versioner, samtycke/släpp,
  kart-/samtyckes-/ruttsåtertagande, ofullständig senare bangeometri och
  spärrad koppling. 390 px Playwright: 1/1 med verklig privat HTTP/DB och
  syntetiskt UI-svar enbart för villkorlig publik länk.
- Contracts, application och web lint/typecheck/build gav var för sig exit 0
  efter sista produktkodändringen. Browserharnessens riktade TypeScript och
  ESLint gav exit 0. Ett första PG-försök föll på fixtureordningen för två
  aktiva upload-grants; testet rättades så första grant återkallas innan
  nästa utfärdas, utan att produktkod eller existerande data ändrades.

Kvarstående antaganden: äldre samtyckesbeslut kan finnas kvar efter att
upload-granten har återkallats; beslutets effekt på offentlig läsning är
fortfarande styrd av senaste samtyckesjournalen enligt ADR-0126/0127.
Testets senare återtagande/regrant skapades som giltiga syntetiska
journalposter eftersom den gamla upload-sessionen då avsiktligt var spärrad;
TASK116 har separat prov av själva beslutsmutatorn. Syntetisk browserlänk
bevisar inte att en offentlig kartbild kan hämtas ur riktig objektlagring.
Fysisk mobil, internetdrift, riktig kartprecision och användarprovning
återstår före produktklarhet.
