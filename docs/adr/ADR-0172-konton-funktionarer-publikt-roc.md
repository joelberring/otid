# ADR-0172: Konton, superadmin, funktionärer, publik yta och radio via ROC

Status: beslutad 2026-10-05 av ägaren (Joel). Ändrar ADR-0168 beslut 4
(behörighet) och kompletterar ADR-0170.

## Bakgrund

Efter steg 16 finns allt för att genomföra en tävling, men ytan runt omkring är
inte klar för riktig användning: vem som helst kan skapa konto med ett
användarnamn, glömt lösenord kräver ett kommando på servern, ingen kan städa
bort skräp, startsidan visar alla tävlingar med adminlänkar och funktionärer
loggar in med koder som enligt ADR-0168 skulle ha tagits bort. Det finns inga
mellantider från skogen. Klubbar i Sverige får radiostämplingar via ROC.

## Beslut

### 1. Konton
- Alla får skapa konto och tävlingar (öppen registrering), med spärr mot
  upprepade försök.
- Kontot identifieras med e-postadress. Lösenord som i dag (hashat, minst 8 tecken).
- Glömt lösenord: länk via e-post när servern har e-post inställd (SMTP i miljön).
  Utan e-post kan superadmin skapa en återställningslänk. Det gamla
  kommandoradsflödet med koder i fil tas bort.
- Inloggning med Google eller Eventor kan läggas till senare. Inte nu.

### 2. Superadmin
- En systemroll som sätts från servern med ett kommando, aldrig i appen.
- Superadmin ser alla konton och tävlingar och kan dölja eller ta bort en
  tävling, spärra eller ta bort ett konto och skapa en återställningslänk.
  Varje sådan åtgärd loggas med vem, när och varför.
- Ägaren av en tävling kan själv ta bort den. Ett konto kan tas bort av sin
  användare.

### 3. Funktionärer
- Ny roll på tävlingen: **Funktionär**, kopplad till ett vanligt konto via
  e-post. Admin lägger till och tar bort funktionärer under Inställningar.
- Funktionären får: avläsning, direktanmälan av okänd bricka, kvar i skogen,
  startlista och incheckning vid start, speaker. Funktionären får inte ändra
  banor, klasser, anmälda, resultat eller inställningar.
- Flera enheter kan vara inloggade på samma konto samtidigt. Det räcker för
  klubbar som vill köra ett gemensamt funktionärskonto.
- Kontrollen görs i en gemensam serverfunktion bredvid `requireRaceAdmin`.
- Koder, credentials och egna inloggningar för funktionärer, stationer,
  kvar i skogen och incheckning tas bort. Startpersonalens app använder samma
  kontoinloggning.

### 4. Publik yta
- En ny tävling är dold tills admin publicerar den. Checklistan visar steget.
- Startsidan visar publicerade tävlingar under Pågår nu, Kommande och Senaste,
  med sök. Besökare ser inga adminlänkar.
- Varje tävling har en publik tävlingssida med kort adress och QR-kod att
  skriva ut: startlista, resultat, sträcktidsanalys och speaker när den är
  publik.
- Sidan "Mina resultat" (`/me`) tas bort tills deltagarkonton tas upp i planen.

### 5. Radiokontroller via ROC
- Tävlingen kan kopplas till ROC (eller OResults, som har samma protokoll)
  med enhetens id. Servern hämtar nya stämplingar med `lastId` regelbundet
  under tävlingen. Rader: stämplings-id; kontrollkod; bricka; tid.
- Radiostämplingar sparas oföränderligt och idempotent (källa + stämplings-id),
  skilda från avläsningar. De ger mellantider live och underlag för speakern.
  Avläsningen i mål avgör fortfarande resultatet.
- Admin väljer vilka kontroller som är radiokontroller.

## Konsekvenser

- Migrationer: e-post på konto, superadminflagga, spärr/borttagning, rollen
  Funktionär, publicerad tävling, ROC-koppling och radiostämplingar.
- Borttaget: användarnamn som inloggning, återställningskoder i fil,
  funktionärskoder, stationsparning och stationscredentials, separata
  inloggningar för kvar i skogen och incheckning, `/me` och dess API.
- `PLAN.md` får steg 17–21.

## Tillägg 2026-11-12: superadmin bekräftar en e-postadress i appen (grenen `claude/r3-b`, migration 0115)

Ägaren: superadmin ska kunna bekräfta ett kontos adress på `/superadmin`, inte bara med `node superadmin.mjs verify` (ADR-0186
beslut 9). Listan visade redan "Obekräftad adress".

- **Åtgärden `VERIFY_EMAIL`** går genom samma väg som Spärra, Återställningslänk och Ta bort (`POST /api/superadmin/actions`,
  `performSuperadminAction`): exakt Origin, sessionskakan, CSRF och `requireSuperadmin` i samma transaktion som ändringen.
  Vanlig administratör får 403, utloggad 401. Knappen "Bekräfta adressen" visas bara för obekräftade adresser och öppnar samma
  bekräftelse som de andra åtgärderna (skäl som loggas). En redan bekräftad adress ger 409 `CONFLICT` ("Adressen är redan
  bekräftad") och ingen loggrad.
- **Vad den gör:** samma som kommandot (`markAccountEmailVerified`): adressen blir bekräftad och kontots bekräftelselänkar
  förbrukas (de visar sedan "redan bekräftad"). Lösenordet ändras inte. Bekräftelsetexten säger därför att superadmin bara ska
  göra det när adressen är personens och personen själv valt lösenordet (ADR-0205 beslut 1: annars kan någon som registrerat
  någon annans adress få behörigheterna); vid tvekan är återställningslänken rätt väg. Det egna kontot får också bekräftas.
- **Loggen:** varje bekräftelse loggas med vem, mot vilket konto och varför; kommandot loggas nu också, med utföraren
  "Serverkommando" som `grant` och `revoke`.
- **Migration 0115:** listan över åtgärder i `superadmin_action_action_check` (från 0000) ersätts av ett formvillkor, som spärrens
  scope i 0087 (migrations/README.md). Listan står i `superadminActionKindSchema` i contracts, och `logAction` vägrar andra värden.
- Tester: `adr-0172-accounts.test.ts` (superadmin kan, vanlig administratör, utloggad och saknad CSRF nekas, redan bekräftad,
  okänt konto, loggen och kommandots loggrad, formvillkoret).


## Tillägg 2026-11-17: "Har du en kod?" på startsidan (grenen `oversyn-startsidan`)

Översynen av användbarheten (ägaren): det gick inte att gå med med kod, startsidan talade bara till publiken och i appen
(ADR-0227) kom målningen och listorna före det deltagaren behöver.

- **Kodfältet** står överst, före sökningen. Formuläret skickas med GET till `/kod` (route handler, fungerar utan JavaScript),
  som slår upp koden på servern (`resolveJoinCode`) och svarar 303 till `/t/<kod>`, `/fest/<kod>` eller `/g/<kod>`, annars till
  `/?kodfel=saknas#kod` ("Koden hittades inte …") eller `/?kodfel=forsok#kod`. Koden står aldrig i adressen tillbaka.
- **Tolkningen** (`normalizeJoinCode` i domain): gemener, inga blanksteg, telefonens tankstreck blir bindestreck, och ur en hel
  adress tas koden efter /t/, /fest/ eller /g/ (värden används aldrig). Tävlingens kod är sex tecken `[2-9a-hjkmnp-z]`
  (`RACE_SHORT_CODE_PATTERN`, samma som databasens villkor), gruppens `GROUP_CODE_PATTERN`.
- **Inget mer avslöjas än de publika sidorna:** en tävling räknas bara när `publicRaceGate` ger PUBLIC eller PREVIEW, så en
  opublicerad eller dold tävling svarar som en okänd kod. Missar delar gruppsidans spärr (`GROUP_CODE_IP`, 30 i timmen per
  IP-adress, ADR-0189 beslut 8); därefter svarar också en riktig kod "för många försök". `/kod` står i `PUBLIC_PATHS` och i Caddyfilens `@public` (publikens
  pool, `publicDb`); Caddy behöver `dc restart caddy` på servern för att ta den nya raden (docs/drift.md), till dess går `/kod` till `web`.
- **Arrangörens väg:** raden "Kom igång som arrangör" (till `/organizer`) under sökningen för den som inte är inloggad. Rutorna
  under "Mer än tidtagning" är länkar (demotävlingen, filmen om kartritningen, Om O-Tid eller `/organizer`). Texten om hur O-Tid
  är byggt finns redan på Om O-Tid; länken till koden flyttades dit.
- **Ordningen:** på smal skärm står målningen (hel, oförändrad) efter Pågår nu; på datorn bredvid rubriken som förut.
- **I appen:** ett litet skript med sidans nonce märker startsidan med `data-otid-app` när bryggan finns, före första ritningen;
  kodfältet blir då större med accentkant, och arrangörens rad döljs. Inget ändras i `apps/mobile`.
- Tester: `packages/domain/test/join-code.test.ts`, `packages/application/test/integration/startsidan-kod.test.ts`,
  `apps/web/src/lib/join-code.test.ts` och `tests/e2e/startsidan-kod.spec.ts`.

## Tillägg 2026-11-17, senare: koden syns för arrangören, och fältet bara i appen (grenen `oversyn-kod`)

Ägaren förstod inte vad "kod" var: ordet användes ingen annanstans, och arrangören såg bara en länk och en QR-kod.

- **Koden i klartext** (`AppCode` i `public-link-share.tsx`, texten "Kod för appen" / "Code for the app"): en liten, dämpad rad
  utan ram eller rubrik där länken eller QR-koden delas – Publicera i arbetsytan, festens panel, träningsgruppens ledarvy,
  tävlingssidans och gruppsidans sidfot, och under adressen på QR-arken (`/t/<kod>/qr`, `/g/<kod>/qr`, `/fest/<kod>/qr`), där
  den är tydligt underordnad QR-koden och adressen. Hjälpen (Publicera) säger att koden skrivs i "Har du en kod?" i appen.
- **Kodfältet syns bara i appen** (`data-otid-app`), i samma storlek som andra fält (den extra framhävningen är borttagen). I en
  vanlig webbläsare döljs det med CSS, utom med beskedet (`?kodfel=…`) och när adressen pekar på det (`/#kod`, `:target`), så
  att `/kod` aldrig landar på en sida utan förklaring. `/kod` är oförändrad. På smal skärm står målningen kvar efter Pågår nu
  (sökningen och dagens tävlingar syns utan att rulla; målningen är hel).
- Tester: `tests/e2e/startsidan-kod.spec.ts` (webb, app via bryggan, beskedet), och koden hos arrangören i `publikt.spec.ts`,
  `fest.spec.ts` och `traningsgrupp.spec.ts`.
