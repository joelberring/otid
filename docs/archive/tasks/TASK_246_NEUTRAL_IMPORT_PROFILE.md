# TASK246: lågmäld importsida med rätt Eventorprofil

Status: genomförd 2026-09-27.

## Användarutfall

Den befintliga importvägen från Före tävlingen ska ha samma neutrala,
informationstäta uttryck som tävlingsarbetsytan. IOF-fil och Eventorbidrag
ska fortfarande vara separata handlingar, men normalfallet ska inte domineras
av gröna knappar, stora kort eller gul varningsdekor. Efter en auktoriserad
Eventorförhandsvisning ska användaren se om underlaget kommer från Testeventor
eller Eventor Sverige – produktion innan klassmappning och import.

## Arkitektur och avgränsning före implementation

ADR-0114 behåller racebundet `IMPORT_IOF`-bidrag och explicit en-till-en-
klassmappning. ADR-0116 kräver att UI visar den lagrade, säkra profilen.
Servern härleder därför profilen från den återauktoriserade anslutningen,
aldrig från formulär, fritt URL-fält eller Eventors XML. Endast den aggregerade
förhandsvisningens privata respons får ett slutet `environment`-värde;
eftersom det är ett obligatoriskt wire-fält får just den responsen
`formatVersion: 2`. Begäran, commit, journal, idempotens och provenans
förblir oförändrade. En äldre/ogiltig preview avvisas i browsern, utan
gissad profiletikett. Ingen Eventornyckel, anslutnings-id eller persondata
läggs i svaret.

Stilen avgränsas till `/admin/[raceId]/imports`. Befintliga mobila
44 px-tryckmål och synliga fokusmarkeringar behålls. Varm gul/röd signal
används bara för verkligt osäkert återförsök/fel, med textstöd. Inga
globala publik-, station- eller speakerstilar ändras. ADR-0116 omfattar
profilbeslutet och ingen ny ADR, migration eller domänändring behövs.

## Riktad acceptans

- Normal importsida: neutral duk, tätare rubriker, avdelare i stället för
  dominerande kort, mindre desktopkontroller; mobilens tryckmål kvar.
- Förhandsvisningen visar rätt lagrad profil för båda tillåtna profilerna,
  men ingen profil före verifierad förhandsvisning.
- Saknad, okänd eller extra hemlig profilinformation avvisas av kontraktet.
- IOF-/Eventorbehörighet, commit och återförsök fungerar som tidigare.
- Riktade kontrakts-/webbprov, lint, typecheck, build och ett syntetiskt
  browserprov räcker; ingen riktig Eventorläsning eller tävlingsdatabas.

## Ingår inte

Ny Eventorfunktion, synk, automatisk klassmappning, ändrad behörighet,
speakerledare, resultatregler, verklig API-nyckel eller generell redesign.

## Utfall och verifiering

Importsidan har nu samma ljusa/grafitgrå grund som `/manage`, smala
avdelare och kompakt text. På bred skärm ligger IOF- och Eventorvägen
parallellt, på mobil i en kolumn med minst 44 px fält/knappar. IOF:s
osäkra återförsök har fortsatt gul textstödd signal. Eventorpanelen har
en neutral rubrik före preview och visar därefter `Verifierad källa` med
exakt profilen från den återauktoriserade anslutningen. Den privata
preview-responsen är v2; request och commit är fortsatt v1.

Kontraktstest **3/3**, riktade webbtest **7/7** och syntetiskt
Next-/Chromium-prov **2/2** passerade. Kontraktslint/typecheck,
application-typecheck, webblint/typecheck, E2E-TypeScript/ESLint,
kontraktsbygge och Next-produktionsbygge gav alla **exit 0**.
Browserbilder vid 390/1280 px granskades utan sidspill. Första
browserstarten nekades av sandlådans loopbackport (`EPERM`, exit 1);
samma syntetiska prov passerade efter tillåten loopbackkörning och
igen efter desktoplayoutjusteringen.

Provet använder syntetiskt API-svar och ingen tävlingsdatabas.
Det styrker inte verklig Eventoranslutning, riktig credential,
produktionsbehörighet eller användbarhet på fysisk mobil.
