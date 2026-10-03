# ADR-0148: kontobunden läsning av egen privat GPX-version

- Status: Accepterad för TASK154
- Datum: 2026-09-23

## Kontext

ADR-0146:s inlösta anmälningskoppling ger ett konto rätt att hitta redan
publicerade resultat, men utesluter uttryckligen privata rutter. ADR-0123:s
separata, tidsbegränsade uppladdningsgrant kan lagra en immutable GPX för
exakt race och entry; dess utgång eller återkallelse stoppar nya uploads men
raderar inte historiken. ADR-0125:s privata kartförhandsgranskning kräver
`MANAGE_RACE` och tre explicita versioner. ADR-0126:s samtycke och den senare
administrativa releasegränsen är skilda från både uppladdning och läsning.

En deltagare med aktiv, verifierad koppling behöver kunna återfinna sin redan
lagrade GPX efter ny inloggning, även när den gamla uppladdningslänken gått
ut. Dagens manifest binder rutt till anmälan och exakt objektversion, men
**inte** till en bevisad kart-, georeferens- eller historisk banversion.

## Beslut

TASK154 inför en separat, enbart läsande kontogräns för **redan lagrade**
`route_object_manifest` vars `(race_id, entry_id)` matchar en aktiv,
inlöst ADR-0146-koppling för det autentiserade kontot. Servern kontrollerar
kontosession, exakt koppling och att den inte spärrats vid varje skyddad
läsning. Den håller entry-lås medan spärr och manifest kontrolleras, så en
administrativ återkallelse inte kan kringgås av ett äldre listunderlag.

Ett privat `GET /api/participant/me/routes` ger en versionslista och ett
privat `GET /api/participant/me/routes/{routeUploadId}` ger fakta för **en
uttryckligen vald** version. `routeUploadId` är en opak väljare som kan synas
i kontots URL men är aldrig en bearerhemlighet eller ett behörighetsbevis.
Saknad eller ej ägd version får samma neutrala 404. Listning får inte tyst
välja ”senaste” version när flera GPX-filer finns för en anmälan.

Svar valideras strikt och är `private, no-store`. De innehåller endast
race-/eventnamn, opak ruttväljare, lagringstid och härledda GPX-fakta:
punkt-/segmentantal, summerad spårlängd inom segment och tidsstatus. Tid
anges bara när varje punkt har en fullständig monoton tidsserie enligt
befintlig `deriveRouteMetadata`; annars visas uttryckligen att mätbar tid
saknas. Manifestantal och normaliserad punktprojektion måste stämma innan
detaljens fakta lämnas ut. Ingen rå WGS84, GPX-byte, objektlagringsnyckel,
grant/session, intern entry- eller resultatrevision lämnar denna gräns.
Den svenska `/me`-vyn visar ett separat ”Mina privata GPX-rutter”-avsnitt
och en kompakt detalj efter vald version. Den kallar inte dessa fakta en
kart-/banpassad rutt eller en färdig analys.

Denna nya läsrätt ändrar **inte** ADR-0146:s publika resultatsvar, äldre
route-upload-grants, samtycke, publiceringsregler eller kartsläpp. Att
uppladdningsgranten senare går ut eller spärras tar inte bort kontots läsning
av ett redan lagrat original, medan spärrad anmälningskoppling eller spärrad
kontosession stoppar läsningen omedelbart. Ett återtaget offentligt samtycke
stänger publik ruttåtkomst men inte ägarens privata original. Publika resultat
och kartor förblir kontofria enligt sina redan gällande publiceringsbeslut.

## Begränsning och nästa beslut

C2a visar ännu inte rutten på karta. Det finns ingen tillförlitlig koppling
från varje privat manifest till exakt kart-, georeferens- och historisk
ban-/resultatversion. C2b måste besluta och verifiera ett sådant bevis före
pixelöverlägg; en aktuell eller senast uppladdad karta får inte gissas fram.
En osläppt karta får inte publiceras via kontogränsen som bieffekt. C2a ger
inte rätt att ladda upp, spela in GPS, ändra samtycke, släppa en rutt, ladda
ner original-GPX eller administrera tävlingen. Den skapar ingen ny migration
eller beständig koppling och ändrar inga resultatregler.

## Drift och verifiering

Inga tabeller eller objekt muteras; rollback är att stänga de nya GET-vägarna
och ta bort deras UI-ingång utan att röra immutable manifest eller journaler.
Det finns därför ingen datamigration att backa. Riktade kontrakts-,
PostgreSQL-, webb- och browserprov använder endast syntetiska konton och
GPX-fakta i en uttryckligen isolerad miljö. Prova två versioner på samma
anmälan, annat konto, anonym läsning, spärrad koppling/session, utgången
uppladdningsgrant och GPX utan komplett tid. Fysisk mobil och fältbruk
redovisas separat från syntetiska prov.

## Avvisade alternativ

- `publicResultId`, ruttnamnet eller `routeUploadId` som ensam credential:
  de är visnings-/väljaridentiteter, inte ägarbevis.
- Återanvända upload-sessionen som kontosession: grantet har annan livstid,
  annan mottagare och skrivrätt som kontot inte ska få av detta beslut.
- Välja nyaste karta/bana eller ge geografiska punkter direkt till browsern:
  manifestet bevisar ännu inte denna koppling och en missvisande eller
  oavsiktligt offentlig överläggning vore sämre än ett ärligt vänteläge.
