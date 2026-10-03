# TASK242: neutral och tät privat kartadministration

Status: genomförd 2026-09-27.

## Användarutfall

En tävlingsadministratör ska på `/admin/[raceId]/map` direkt kunna se
publiceringsläget och därefter hitta uppladdning, lagrade kartor,
georeferering och kontrollpositioner utan stora gröna knappar, skuggade
kort eller omotiverad vertikal tomyta. På dator används bredden för att
visa mer relevant information samtidigt; mobilen behåller läsbara,
minst 44 px höga manöverdon utan horisontellt sidspill.

## UI-beslut före implementation

Ge endast kartadministrationssidan en neutral ljus/grå sidkrom och en
konsekvent kompakt textskala. Gör den befintliga publiceringsytan till
en tydlig aktuell status följd av uppladdning och val av lagrad karta;
på större skärmar kan de två sistnämnda ligga bredvid varandra. Låt
georeferering och kontrollpositioner fortsatt vara tydligt märkta,
synliga *ingångar* i samma ordning, men använd tunna avdelare i stället
för upprepade skuggade paneler. De oberoende avancerade formulären och
deras historik får vara initialt stängda i varsin native `details` så
den primära kartpubliceringen inte kräver scroll förbi tolv
kalibreringsfält. Rubrik, kort beskrivning, status och minst 44 px hög
`summary` är alltid synliga; båda arbetsytorna kan öppnas samtidigt.
Gruppera relaterade inmatningar utan att förminska tryckmål. Tomma
statusparagrafer ska inte reservera plats. Laddning/fel får inte
presenteras som ett säkert "ingen karta"-utfall.

Behåll exakta svenska konsekvenstexter för privat uppladdning, explicit
publicering och återtagande. Bekräftelserutor ska ligga intill respektive
åtgärd; publicera/återta får aldrig ske automatiskt eller på enbart
visningsändring. Ett misslyckat eller gammalt läsunderlag får ingen
fabricerad samlad "klar"-signal. Färg används endast för faktiska fel,
saknad/okänd information och tydligt fokus, inte normal navigation.

Sidlokala CSS-regler får inte ändra global `button`, `.panel` eller andra
administrationsytor. Inga API-kontrakt, åtkomstregler, map-release-
journaler, lagringsbeslut, datamodeller eller domängränser ändras. Därför
behövs ingen ny ADR; ADR-0120 gäller oförändrat.

## Riktad acceptans

Syntetiskt monterad `MapAssetAdmin` med tomt, lagrat och publicerat
underlag vid 390/1280 px: rätt textstatus, synliga ingångar till de
avancerade ytorna, ingen horisontell sidspill,
tydlig kort bekräftelse för release/withdraw, oförändrade privata
HTTP-vägar och inga exponerade lagrings-ID:n. En riktad visuell
browserkontroll granskar även sidans rubrik- och sektionsrytm.
Relevanta befintliga komponentprov, webblint/typecheck och webbuild
räcker. Det databasbundna TASK106/TASK114-browserprovet får bara köras
mot uttryckligen isolerad PostgreSQL; annars redovisas det som ej kört.

## Ingår inte

OMAP-import, ny kartpubliceringsregel, georeferensalgoritm, ändrade
kontrollkoordinater, GPS, ruttvisning, ny global visuell design eller
fysisk touch-/fältacceptans.

## Utfall

Kartadministrationen är neutral och uppdelad med tunna avdelare i stället
för skuggade kort. Publicerad karta syns först; uppladdning och lagrade
kartor är två kolumner på dator och en kolumn på mobil. Kalibrering och
kontrollpositioner har synliga rubriker, förklaringar och textstatus,
men formulär/historik öppnas var för sig med native `details`. Den
syntetiska mobilvyn blev väsentligt kortare utan att ta bort
arbetsfunktioner. Misslyckad eller ännu inte validerad läsning visas
inte som ett säkert tomläge.

Verifiering: webblint, webbtypecheck, TypeScript/ESLint för TASK242 och
uppdaterat TASK114-prov, checkin-förberedelse och Next-build gav exit 0.
Berörda komponentprov passerade 4/4. Tre riktiga Next-/Chromium-fall med
syntetiska HTTP-svar passerade 3/3; 390/1280 px och publicerat mobilläge
granskades visuellt. TASK106/TASK114:s databasbundna browserprov kördes
inte utan isolerad PostgreSQL. Ingen verklig MinIO-publicering, fysisk
touch eller fältanvändning verifierades.
