# ADR-0149: uttrycklig versionsbunden privat kartkontext för deltagarrutt

- Status: Accepterad för TASK155
- Datum: 2026-09-23

## Kontext

ADR-0148/TASK154 ger ett konto med aktiv koppling till exakt anmälan rätt
att läsa sina immutable GPX-fakta. Ruttmanifestet säger inget om vilken karta,
kalibrering eller historisk bana rutten hör till. ADR-0125:s privata
arrangörsförhandsgranskning accepterar uttryckliga GPX-/kart-/kalibreringsval,
men ett tillfälligt browserval är inte ett beständigt deltagarbevis.
ADR-0126:s samtycke och offentlig rutt-/kartrelease har andra syften och får
inte bli ett villkor för ägarens privata efterloppsvy.

En pixelprojektion på fel karta eller en senare ändrad bana kan se övertygande
ut trots att den är fel. Kontrollpunkter och uppmätta passager är olika saker:
sparad kontrollgeometri bevisar banans märkning, inte att en GPS-punkt är en
stämpling eller en exakt kontrollpassage.

## Beslut

En `MANAGE_RACE`-administratör väljer och bekräftar **separat** en privat
kontext för en exakt lagrad GPX-version. Valet lagras i en append-only journal
med request-ID, aktör, tid, route-manifest-ID/hash och dess race/entry,
map-manifest-ID/hash, georeferens-ID, exakt kontrollgeometrirevision-ID samt
ID/nummer och `course_version_id` för den då effektiva **publicerade**
resultatrevisionen för samma anmälan. Publicerat resultat väljs för att
deltagarvyn inte ska avslöja en ännu opublicerad banändring. Saknas ett aktivt
publicerat resultat eller fullständig geometri kan kontext inte bindas.

Skrivningen är idempotent på request-ID och använder väntad aktuell
kontextrevision, racelås och strikta transaktionskontroller. Exakt retry ger
samma journalpost; ändrad aktör, scope eller intent ger konflikt. En ny
bindning lägger till en revision, aldrig en uppdatering av historien.
Servern verifierar vid skrivning att alla poster hör till samma race/entry,
hashar och georeferens stämmer, kontrollgeometrin exakt täcker den historiska
banans kontrollförekomster samt att hela rutten kan projiceras inom den
valda bildens gränser. Varken en förvald första option i UI eller en lyckad
förhandsgranskning utgör bekräftelse; separat knapp/handling krävs.

En inloggad deltagare kan läsa överlägget och kartbilden endast för sin
aktivt kopplade anmälan och den uttryckligen valda GPX-versionen. Servern
kontrollerar kontosession och koppling vid **varje** JSON- och bildläsning,
resolvar endast senaste explicita kontextrevision för just den rutten och
läser exakt fryst objektversion. Deltagarens browser får pixelpunkter,
segment, bildmått, verifierade kontrollpositioner och faktiska GPX-mätdata,
aldrig WGS84, rå GPX, objektlagringsnycklar, intern entry/resultat-ID eller
annan deltagares data. Karta och JSON är `private, no-store` och bildvägen
får inte tas via offentlig kart-URL.

JSON-svaret bär den opaka positiva kontextrevisionen. Bildbegäran måste ange
just den revisionen och servern avvisar den om en ombindning hunnit ske.
Det hindrar en äldre pixellinje från att visas på en nyare kartversion när
två separata HTTP-begäranden överlappar.

På läsning måste den bundna banversionen fortfarande motsvara den effektiva
publicerade resultatrevisionens banversion. En senare resultatkorrigering på
samma bana får behålla överlägget; en ändring till annan bana, försvunnet
aktivt resultat, saknad/mismatchad geometri eller objektversion ger ett
neutralt vänteläge utan karta eller linje tills administratören uttryckligen
binder om. En senare geometri- eller georeferensrevision ändrar inte en
gammal bindning tyst. Gamla poster finns kvar för spårbarhet men är inte
självständiga publika länkar. Påstående om verklig kartprecision kräver
separat fältacceptans; vyn märks som arrangörsvald versionskoppling och
GPX-spåret som ej GPS-verifierat.

Privat kontext skapar **inte** samtycke, offentlig kartrelease eller offentlig
ruttrelease. Deras återtaganden ska inte ta bort ägarens privata vy; däremot
stoppar återkallad anmälningskoppling eller kontosession varje ny läsning.
Anonym publik åtkomst följer oförändrat sin separata releasegräns.

## Konsekvenser och återställning

En additiv migration inför journal och constraints/FK mot befintliga
immutable manifest och revisionsidentiteter. Ingen gammal GPX får automatisk
kontext och ingen befintlig data skrivs om. Vid rollback stängs de nya
skriv-/läs-/bildvägarna och UI-ingången; journalen lämnas kvar för granskning
och återaktivering, inte raderas ur en miljö med tävlingsdata. En restore
måste bevara både journalen och exakt refererade objektversioner.

Riktade prov använder endast isolerad syntetisk PostgreSQL/PostGIS och
syntetiska bilder/GPX: två ruttversioner, fel race/entry, saknad/mismatchad
geometri, resultatbyte till annan bana, idempotent retry, spärrad koppling,
annat konto och anonym begäran. Browserprov på 390 px kontrollerar att samma
bundna bild används för pixellinjen. Fysisk mobil och kartprecision i fält
är separata, öppna acceptanser.

## Avvisade alternativ

- Automatiskt välja senaste karta, georeferens, resultat eller geometri:
  tyst versionsbyte kan ge en trovärdig men felaktig bild.
- Återanvända offentlig ruttpublication: den förutsätter separat samtycke
  och kartsläpp och skulle blanda ihop ägarens privata läsning med publikering.
- Använda GPX-/kart-ID eller `publicResultId` som behörighetsbevis: de är
  väljare och länkar, inte ägarautentisering.
- Härleda stämplingar från GPS-närhet: koordinater bevisar inte faktisk
  kontrollpassage eller officiell sträcktid.
