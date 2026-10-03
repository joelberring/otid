# ADR-0155: relativ tidsuppspelning av exakt egen privat GPX

- Status: Accepterad för C3a/TASK162 före implementation
- Datum: 2026-09-23

## Kontext

ADR-0149 binder redan en uttryckligen vald privat GPX-version till exakt
karta, georeferens, kontrollgeometri och historisk publicerad resultatrevision.
Endast ett konto med aktiv koppling till exakt anmälan får läsa överlägget;
källans koordinater och lagringsreferenser stannar på servern. Projektionen
läser redan varje punkts `recordedAt` och `deriveRouteMetadata` skiljer en
komplett monoton tidsserie från ofullständigt/omvänt tidsunderlag, men den
privata vyn visar ännu inte någon uppspelning. Den publika vyn har en ren
relativ pixelinterpolering som inte drar en linje över GPX-segmentbrott.

## Beslut

Första C3-snittet återanvänder endast den **exakta valda privata rutten**
och den befintliga kontobundna läsgrinden. Det är en läs-/presentationsändring,
inte ny analysauktorisation, ny databas, publicering eller GPS-synk.
Servern räknar relativa millisekunder från första uppmätta GPX-tidpunkten
för varje punkt endast när hela källserien är komplett och monoton. I annat
fall returneras `UNAVAILABLE` utan delvis eller fabricerad tidsserie. Den
privata overlay-responsen får `formatVersion: 2` och en obligatorisk
diskriminerad `playback` med samma tids-/längdgränser som den befintliga
publika pixelrutten. Punkten, dess segment och relativa tid hålls i samma
ordning. Varken WGS84, intern källhash, objektadress eller en ny publik länk
skickas till browsern.

Klienten får spela/pausa, börja om och skrubba längs **GPX-tiden**, med en
markerad pixelposition på den redan privata kartan. Den använder den rena
befintliga interpoleringen; vid segmentbrott visas ingen påhittad mellanväg.
När tidsunderlag saknas visas ett uttryckligt besked och befintlig karta,
sträcka och punktantal finns kvar. Kartfel får inte presenteras som lyckad
kartuppspelning. Texten skiljer GPX-tid från officiella stämplingar.

Kontrollcirklar är historisk banlayout, **inte** uppmätta GPS-passager.
Ingen kontrolltid, split, hastighet, höjd eller placering härleds ur
markörens närhet till en kontroll. Sådan kombination av två beviskedjor
kräver separat beslut. En osläppt privat rutt blir aldrig publik som följd
av detta snitt; samtycke och release enligt ADR-0150 förblir separata.

## Verifiering och konsekvenser

Riktade kontraktsprov kontrollerar tidsseriens längd, första nollpunkt,
monotonicitet, duration och unavailable-vägen. Ett isolerat PostgreSQL-prov
kontrollerar exakta källpunkter och fortsatt owner-/versionsgrind; ett
390px-browserfall prövar uppspelning och ärligt saknat tidsunderlag utan
horisontell scroll. Befintliga publika markeringsprov täcker segmentbrott
och kan återanvändas. Berörd lint, typecheck och build körs, inte hela
projektets testsvit. Ingen fysisk kartprecision eller mobil-GNSS kan
slutsatsdras av syntetiska prov.

`formatVersion: 2` är en avsiktlig versionshöjning för den privata
app-responsen eftersom ett obligatoriskt nytt fält annars skulle bryta
strikt v1-validering. Både server och bundlad klient byts i samma
Next-leverans; `no-store` och den befintliga neutrala felvägen behålls.
Detta ändrar inte serverns teknikval eller domänens resultatregler.
