# Kart- och ruttmodell

Kartor och GPS-rutter implementeras inte i TASK 001. Följande gränser reserveras
så att tävlingsmodellen inte behöver brytas senare:

- kontroller har stabil intern identitet och kan senare kompletteras med WGS84,
  kartkoordinat och CRS utan att kod eller koordinat blir identitet,
- course-versioner är append-only och kan senare kopplas till en map-version,
- lopp, klass, deltagande och resultat har separata UUID:n som rutter kan
  referera till,
- extern identitet är adaptermetadata, aldrig primärnyckel,
- kart- och ruttfiler ska vara privata med explicit publiceringsregel.

TASK106/ADR-0120 implementerar ett första avgränsat steg: en privat,
race-scopad renderbar PNG/JPEG-kartbild kan få en explicit och återtagbar
publik release.
Det är inte georeferering eller ruttanalys: ingen CRS, tile, banpåtryck,
kontrollposition, GPS, GPX, FIT, TCX eller Livelox-gräns införs där. `.omap`
förblir en privat källfil tills en separat renderer/importadapter har beslutats
och implementerats.

Fulla kart-, tile- och ruttabeller skapas först i egna vertikala steg så att
oanvända produktionsvägar inte låtsas vara färdiga.

TASK111–112/ADR-0123 har implementerat en privat, deltagarbunden GPX 1.1-
track som immutable original och ordnade WGS84-punkter via en egen
upload-grant. En fortfarande giltig privat länk kan åter öppnas för en
anonymiserad lagringskvittens, men varken rutt eller punkter visas. Det gör
ännu ingen karta georefererad och får därför inte rita GPS-punkter ovanpå
TASK106:s rasterbild eller publicera ruttdata. Publik ruttvisning, analys och
fler-ruttuppspelning följer först i egna snitt.

TASK114/ADR-0124 implementerar nästa avgränsade förberedelse: en privat, immutable
trepunktsgeoreferens binds till exakt PNG/JPEG-manifestversion. Den skapar
ingen kartvisning med GPS, ändrar inte ADR-0120:s kartsläpp och tolkar inte
den privata `.omap`-källan. En separat senare väg måste besluta om och
auktorisera varje faktisk ruttöverläggning eller publicering.

TASK115/ADR-0125 implementerar den privata läsvägen: en `MANAGE_RACE`-
administratör kan välja exakt en tidigare GPX-rutt, rastermanifest och
georeferensrevision för en privat förhandsgranskning. Servern lämnar bara
pixelpunkter till browsern och läser exakt skyddad kartversion; valet görs inte
beständigt och publicerar varken rutt eller karta. Deltagar- och publikvy,
flera rutter och analys kräver fortfarande separata beslut.

TASK116/ADR-0126 implementerar nästa integritetsgräns före en sådan publik vy:
deltagaren kan med sin privata upload-session samtycka till eller återta
framtida publicering av exakt en immutable GPX-manifestversion. Samtycket är
en append-only journal, inte en aktuell publicering och inte en rättighet för
den publika resultatlänken. Val av publik målgrupp, kartsläppsvillkor och
faktisk routevisning måste fortfarande beslutas separat.

TASK117/ADR-0127 implementerar den första publika vägen: en `MANAGE_RACE`-
administratör släpper eller återtar en exakt samtyckt rutt ovanpå en exakt
redan släppt raster- och georeferensversion, och den visas från den befintliga
offentliga deltagarresultatsidan. Ingen läsning
får välja senaste version eller kringgå senare samtyckes-/kartåtertagande.

TASK118/ADR-0128 lägger till härledd distans, punkt-/segmentantal och ett
explicit tidslöst eller komplett GPX-tidsintervall för just den redan aktiva
publika rutten. Beräkningen använder privata källkoordinater på servern;
browsern får varken WGS84-punkter eller ny analysdata. Den skapar inga broar
över GPX-segment och blir otillgänglig tillsammans med TASK117-releasen.

TASK119/ADR-0129 är beslutat före kod för att skapa ett privat,
versionsbundet kontrollgeometriunderlag. Det behövs innan en bana kan ritas:
den nuvarande course-modellen lagrar endast kontrollkod och ordning, aldrig
position. Ingen kontrollposition får fabriceras från en GPS-rutt.

TASK120/ADR-0130 använder detta underlag på den redan publicerade
deltagarrutten, men bara när den effektiva publika resultatrevisionens
historiska course-version, TASK117:s exakta kart-/georeferensrelease och en
komplett TASK119-geometri överensstämmer. Vyn får bara pixelmarkörer med
ordning och kontrollkod. Saknas ett enda bevis blir rutten inte tillgänglig;
den använder aldrig nuvarande klassbana, senaste karta eller senare geometri.
Ruttjämförelse, passagetider, analys och OMAP ligger fortfarande utanför.

TASK121/ADR-0131 implementerar därefter jämförelse av exakt två sådana rutter
endast när båda har samma historiska course-version, map-manifest och
georeferens. Svaret innehåller bara två pixelbanor, gemensamma
kontrollmarkörer och redan härledd metadata. Valet är lokalt i browsern och
skriver eller utvidgar inte tidigare samtycke/release. Fler rutter,
tidsuppspelning och analys väntar på egna ADR:er.

TASK122/ADR-0132 lägger endast till de två deltagarnas redan publika för- och
efternamn i TASK121:s färgförklaring. Etiketterna kommer från samma effektiva
resultathuvuden och saknas tillsammans med hela jämförelsen när grinden inte
går att bevisa. Ingen organisation, profil, resultatfakta eller ny
beständig data läggs till.

TASK123 visar slutligen den metadata som TASK118 redan har härlett i den
befintliga två-ruttvyn: distans, punkt-/segmentantal och antingen komplett
GPX-tidsintervall eller ett uttryckligt tidslöst besked. Det är en
renderingsförbättring, inte ny ruttanalys eller tidsuppspelning.

TASK124/ADR-0133 lägger därutöver en liten läsprojektion för redan publicerade
resultatsplits i samma exakta två-ruttjämförelse. Bara ett helt `OK`-resultat
med komplett befintlig splitlista kan bidra med kontrollkod, förekomst,
sträcktid och ackumulerad tid. Om någon sida saknar sådant underlag eller
kontrollordningen skiljer sig, visas inga tider alls. Resultatstatus,
placering, starttid och GPS-passagetider är fortsatt utanför vyn.

TASK125 gör den redan publika en-ruttvägen synlig direkt vid deltagarens
resultat. Kortet återanvänder samma godkända läsprojektion och URL, visar
enbart dess befintliga härledda metadata och uteblir helt vid `not-found`.
Det är ingen ny release, uppslagsväg, ruttanalys eller fallback till annan
karta eller banversion.

TASK126 gör den redan publika direktlänken till en deltagarrutt begriplig med
namn, klass och tävlingskontext från den befintliga resultatprojektionen.
Resultat- och ruttgrindarna förblir separata: opublicerat resultat blir
`notFound`, medan en senare återtagen rutt fortsätter visa samma explicita
otillgänglighetsbesked som tidigare. Ingen ny ruttdata lämnar servern.
