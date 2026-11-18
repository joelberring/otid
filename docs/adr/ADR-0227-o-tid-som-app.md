# ADR-0227: O-Tid som app – GPS med låst skärm

- Status: Accepterad (ägaren 2026-11-16). A1 är under bygge; inget i den inbyggda delen är provat på en telefon.
- Datum: 2026-11-16
- Underlag: projektets dokument `claude/plan-app-och-livebevakning-2026-11-16.md` och
  `claude/plan-app-beslut-2026-11-16.md`.
- Förhållande till äldre beslut: häver parkeringen av deltagarappen i ADR-0168 beslut 2 för det här syftet och ersätter
  ADR-0151:s upplägg (separat Androidapp med konto). Principerna därifrån som behålls står under beslut 3.

## Kontext

Bingo, Sänka skepp och virtuella kontroller (ADR-0225, ADR-0226) körs i webbläsaren. Webbläsaren ger inga positioner när
skärmen är låst, så telefonen måste hållas tänd i handen. Ägaren vill ha en riktig app för iPhone och Android som följer
positionen med låst skärm, och senare livebevakning för ledare (steg A2–A4).

## Beslut

### 1. Ett skal runt den befintliga webben (mellanläget)

- En app, `apps/mobile`, byggd med Capacitor för iOS och Android. Den öppnar O-Tids publika adress i en webbvy; sidorna
  ligger kvar i `apps/web` och uppdateras med servern, utan ny granskning i butikerna.
- Appen är deltagarens: man går med i ett arrangemang med QR-kod eller kort kod och namn, som i dag. Inga konton i appen.
- Deltagarvyn ska gå att köra utan nät efter att deltagaren gått med. Loppet och arrangemangets data sparas redan i
  telefonen (ADR-0225); sidan själv sparas i telefonen i ett senare delsteg av A1 (se «Återstår»).
- Webbversionen i webbläsaren finns kvar oförändrad som reserv, med tänd skärm.

### 2. En inbyggd spårningsmodul med ett litet kontrakt

Modulen heter `OTidTracking` och nås i webbvyn som `window.Capacitor.Plugins.OTidTracking`. `apps/web` får inget
Capacitor-beroende; den läser bryggan om den finns och använder annars webbläsarens `navigator.geolocation`.

| Metod | Innehåll |
|---|---|
| `requestPermission()` | Ber om platstillstånd. Svar `{ location: "granted" \| "denied" \| "prompt", precise: boolean, notifications: "granted" \| "denied" \| "prompt" }`. |
| `start({ sessionId, stopAtMs, title, text })` | Startar spårningen för ett lopp. `sessionId` är loppets `runnerId`. Kräver att appen syns. Svar `{ lastSeq }`. Samma `sessionId` igen fortsätter journalen. |
| `stop({ sessionId })` | Stoppar spårningen. Journalen ligger kvar. |
| `status()` | `{ tracking, sessionId, lastSeq, stopAtMs, stoppedBy }` där `stoppedBy` är `null`, `"user"`, `"deadline"` eller `"system"`. |
| `read({ sessionId, afterSeq, limit })` | Punkter ur journalen efter `afterSeq`, högst `limit` (högst 2000). Svar `{ fixes, lastSeq }`. |
| `post({ url, body })` | Skickar `body` (JSON-text) med POST från den inbyggda sidan, med `Origin` satt till appens serveradress. Svar `{ status, body }`. Bara adresser under appens serveradress. |
| `signal({ kind })` | `"ok"`: kort vibration och ljud, även med låst skärm. |
| `purge({ sessionId })` | Tar bort journalen. Anropas av webben först när servern har kvitterat loppets sista version. |
| händelsen `fix` | En punkt, direkt när den kommer. |
| händelsen `stopped` | `{ sessionId, stoppedBy }`. |

En punkt: `{ seq, latitude, longitude, accuracyM, t, receivedAt }`. `seq` börjar på 1 och ökar med ett per punkt inom
loppet. `t` är positionens egen tid (GPS-tiden) i millisekunder, `receivedAt` telefonens klocka.

Kontraktet har `formatVersion: 1` i `status()`. Webben måste klara en äldre app, och appen en nyare webb: okända fält
ignoreras, och saknas bryggan eller en metod faller webben tillbaka på webbläsarens väg.

### 3. Journalen är källan; webben räknar

- Varje punkt skrivs till en journal på telefonens disk innan den lämnas till webbvyn. Journalen överlever att appen
  stängs av systemet och att telefonen startas om.
- Spelets regler ligger kvar i `packages/domain` (`bingoStep`, `judgePunches`). Webben spelar upp journalen: efter ett
  avbrott läser den punkterna efter den senaste hon räknat och räknar ikapp. Samma punkter ger samma lopp.
- Loppets läge skickas som i dag, hela läget tills servern kvitterat (ADR-0225). I appen går anropet genom `post`, eftersom
  Android stryper webbvyns egna nätanrop efter några minuter i bakgrunden.
- Journalen tas bort först när servern har kvitterat (AGENTS.md). Den ingår inte i telefonens automatiska säkerhetskopia.
- Från ADR-0151 behålls: start bara efter uttrycklig handling i synlig app, synlig notis under spårningen, inget generellt
  bakgrundstillstånd, ingen tyst omstart av platsinsamling, och avslag eller avstängd plats visas som att appen inte spårar.

### 4. Tillstånd per plattform

- iOS: «När appen används» med bakgrundsläget `location`. Inte «Alltid».
- Android: förgrundstjänst av typen `location` med fast notis. Inte `ACCESS_BACKGROUND_LOCATION`. Android 13+ ber om
  notistillstånd; utan det går spårningen men notisen syns inte i listan.

### 5. Maxtid

Spårningen stängs av sig själv vid `stopAtMs`. Webben sätter den till arrangemangets sluttid plus 60 minuter (ägaren
2026-11-16), och utan sluttid till fyra timmar efter start. Gränsen ligger i den inbyggda modulen så att den gäller utan
nät och även om webbvyn inte kör.

### 6. Delning och bevakning (A2–A4, inte byggt i A1)

Beslutat av ägaren 2026-11-16, byggs i A2 och A3:

- Deltagaren väljer delning: delar inte, bara ledare, alla inloggade, alla åskådare. Lägsta nivån av arrangörens tak,
  vårdnadshavarens samtycke och deltagarens val gäller. Förval «Bara ledare» på ungdomsträning, annars «Delar inte».
- Vilka ledare som ser livekartan ställs in per arrangemang (förval: ansvariga ledare och övriga ledare på arrangemanget).
  Varje öppning loggas. Larmen går bara till de ansvariga ledarna.
- «Jag behöver hjälp» skickar positionen även för den som inte delar. Inget sms.
- Spår raderas efter 7 dagar som förval, även i säkerhetskopian och arkivet.
- Före första användning med barn: konsekvensbedömning, biträdesavtal med klubben, samtycke från vårdnadshavare.

A1 ändrar inte vad servern lagrar: loppets läge och spår sparas som i ADR-0225. A1 provas med vuxna.

### 7. Utgivning

Personligt utvecklarkonto hos Apple och Google, knutet till ägaren. Googles stängda test (12 testare i 14 dagar) gäller.

## Konsekvenser

- Två nya byggkedjor (Xcode och Android Studio) som inte körs i CI. `apps/mobile` är med i arbetsytan för lint och
  typkontroll av sin TypeScript, men Kotlin och Swift byggs bara på ägarens dator.
- Ändringar i `OTidTracking` kräver en ny appversion; allt annat följer servern.
- Webben har två vägar för position. Webbläsarens väg ska bete sig exakt som före A1.

## Tillägg 2026-11-16 – första bygget

- `apps/mobile` finns med Capacitor 8.6.2 och modulen i Kotlin och Swift. Koden är **obyggd och oprovad**: varken Android-
  eller iOS-bygget går att köra utanför ägarens dator. Bygge och provlista står i `docs/app.md`.
- Arrangemang har ingen sluttid i O-Tid (bara datum och första start). Maxtiden är därför fyra timmar efter loppets start
  tills ett fält för sluttid finns; då gäller sluttid plus 60 minuter.
- Androids säkerhetskopia är avstängd för hela appen, inte bara journalen, eftersom webbvyns lagring också har positioner.
- `start` avvisas vid ungefärlig plats. På iOS används inte `title` och `text` (ingen notis; systemets blå markering visas).
- `server.url` får bara vara schema och värd; med en sökväg kopplas bryggan inte in på Android.
- Öppet: om plinget hörs med låst skärm på iOS (kan kräva bakgrundsläget `audio`, som i så fall är ett nytt beslut), och om
  webbvyns JavaScript stryps med släckt skärm på Android så att plinget kommer sent. Journalen är hel i båda fallen.

## Tillägg 2026-11-18 – flikrad för inloggade i telefonbredd (förslag B)

Ägaren godkände 2026-11-18 «förslag B»: inloggade O-Tid på telefon ska kännas som en app och ge en väg tillbaka till
huvuddelarna från alla vanliga inloggade sidor, också i appskalet (översynens D3). Ingen ny funktion och ingen ändrad datamodell.

- **Flikraden** (`components/app-tabs/`, `lib/app-tabs.ts`): Hem (`/organizer`), Kartor (`/organizer/map-projects`), Banor
  (`/organizer#lagg-banor`, öppnar panelen Lägg banor), Träningar (`/organizer#dina-tavlingar`, listan Dina tävlingar), Klubb
  (`/organizer#mina-klubbar`, där man också går med i en klubb). Det finns inga egna listsidor för banor, träningar och klubbar;
  inga nya sidor byggdes. Aktiv flik har `aria-current="page"`, accentfärg och fetare text: Hem i navet, Kartor i kartprojekten,
  Klubb i klubbytor och grupper, Träningar i arbetsytan (`/admin/…`), ingen på Mitt konto och superadmin.
- **Var:** de inloggade delarnas layouter (`/organizer`, `/admin`, `/konto`, `/superadmin`) ritar `SignedInTabBar`, som visar raden
  bara för ett inloggat konto (samma sessionskontroll som startsidan). Publika sidor (`/t`, `/g`, `/fest`, listor, startsidan,
  löparlägena) har den aldrig. Inte heller kartredigeraren, banläggningen med undersidor, speakern, stationerna, avläsningen
  eller klubbens utskrift av terminsplaneringen (`appTabsHidden`). Bara under 640 px (sidornas brytpunkt) och inte i utskrift;
  datorvyn är oförändrad (jämförd pixel för pixel i 1280 px).
- **Skärmens kant:** raden har `padding-bottom: env(safe-area-inset-bottom)` (eller Capacitors `--safe-area-inset-bottom`) och
  sidan lika mycket luft nertill. `viewport-fit=cover` läggs inte till: iOS-skalet håller redan webbvyn ovanför hemstrecket
  (`OTidRootViewController`), och i Safari utan `cover` slutar sidan ovanför det. Med `cover` hade alla sidor hamnat under kameran
  i liggande läge. Provas i TestFlight och på Android (kanter, D5).
- **Mitt O-Tid i telefonbredd:** egen låg överrad (loggan som länk till startsidan, sidnamnet, språket, hjälpen, kontot; layoutens
  sidhuvud döljs där), de fyra valen som 2 × 2 med ikon och kort rad, Mina klubbar/grupper/kartprojekt som täta rader med pil,
  «Ny klubbyta»/«Ny grupp» som textknapp i rubrikraden och «Ny här?» längst ned. Superadmin står i kontomenyn i telefonbredd.
  «Till Skapa träning eller tävling» och raden «O-Tid · Arrangör» visas inte i telefonbredd (valet Skapa träning eller tävling
  leder till samma ställe; loggan står i stället).
- Webbändring: kräver serveruppdatering, ingen ny appversion.

## Återstår i A1

- Bygga och prova på riktiga telefoner (iPhone och minst två Android-märken): en timme med låst skärm, pling efter 15
  minuter, 10 minuter utan nät, batteri. Stödet anges som `untested` tills det är gjort.
- Deltagarvyn sparad i telefonen så att appen startar utan nät.
- Sänka skepp med låst skärm behöver inget (positionen tas när telefonen tas fram).
