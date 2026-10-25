# Säkerhet och integritet

Detta dokument kompletterar CODEX_BRIEF och befintliga ADR:er; det innebär inte
att hela produktionssäkerheten är färdig eller granskad.

## Grundgränser

Privata operativa vyer använder kontots host-only sessionscookie (httpOnly, SameSite=Strict),
CSRF/Origin och no-store. Publika projektioner väljer uttryckliga fält.
Kartor, GPS, dokument och API-nycklar är privata som standard. Servergenererade
interna IDs och immutable beslut används för spårbarhet, inte externa PK:n.

## Behörighet (ADR-0168 beslut 4, ADR-0172 beslut 3)

Det finns tre roller på en tävling och inga koder eller credentials som delas ut i appen:

- **Ägare och administratör** (konto med `OWNER`/`ADMIN` på eventet): allt i tävlingen.
- **Funktionär** (konto med rollen `FUNCTIONARY`): avläsning (avläsningspaket och inskickade
  avläsningar), direktanmälan av okänd bricka och, på avläsningssidan, koppling av en okänd bricka till en anmäld
  deltagare utan bricka eller utan avläsning (PLAN.md steg 29; arbetsytans koppling till valfri deltagare kräver
  administratör), förslag ur löpardatabasen, kvar i skogen
  (läsa, registrera och ta tillbaka återkomst), startläge, startlistor i arbetsytan och speaker.
  Funktionären når inte banor, klasser, anmälda, lottning, resultatändringar, fastställande,
  publicering, inställningar, import, Eventor, kartor, exporter eller listan över behörigheter.
- **Alla andra** läser publicerat innehåll utan inloggning.

Administratören lägger till ett befintligt konto med dess e-post under Inställningar → Personer med
behörighet; bara ägaren lägger till och tar bort administratörer. En borttagen behörighet gäller
direkt, även för öppna sessioner. Samma konto kan vara inloggat på flera enheter (en session per enhet).
Servern avgör rollen för varje adminroute på ett ställe (`apps/web/src/lib/race-roles.ts`) och
tjänsterna och databasen kontrollerar den igen. Borttaget i steg 18: funktionärskoder, stationsparning
och stationscredentials, egna inloggningar för kvar i skogen och incheckning, återställningskoder för
incheckningsappen, eventskapande med credential och "Mina resultat" (`/me`) med deltagarkoder.

## Eventor (ADR-0170 beslut 4)

Klubbens API-nyckel klistras in av tävlingens administratör och lagras per tävling
krypterad med AES-256-GCM. Tävlingens id och masternyckelns id autentiseras med
chiffret. Masternyckeln (`OTID_EVENTOR_MASTER_KEY`) finns bara i serverns miljö,
separat från databasen och dess backup. Nyckeln skickas aldrig tillbaka till
webbläsaren (bara "Nyckel sparad"), loggas inte och skrivs inte i auditloggen.
Eventor anropas med nyckeln i headern `ApiKey`, utan omdirigeringar, med tidsgräns,
storleksgräns och härdad XML-läsning. Basadressen är Eventor Sverige; bara driften
kan peka om den (`OTID_EVENTOR_BASE_URL`, för test). Fel visas som läge
("Eventor godkände inte nyckeln") utan innehåll från Eventor. Liveprov mot Eventor
med klubbens riktiga nyckel: klubbnyckeln, tävlingslistan och klubbens löpare (`cachedcompetitors` med
`organisationIds`) provade 2026-10-19; hela landets löpare och `/api/organisations` är inte provade.

## Löpardatabasen (PLAN.md steg 29)

- **Vad**: klubbens löpare (och, om administratören väljer det, tillagda klubbars eller hela landets) ur Eventors
  `cachedcompetitors`: Eventors person-id, förnamn, efternamn, födelseår, kön, klubb (Eventors id, namn, kortnamn) och
  SPORTident-brickor. Dataminimering: födelsedatum blir år, nationalitet, adresser, andra stämpelsystem och förvalda
  klasser läses inte. Dessutom Eventors organisationer (id, namn, kortnamn, typ) för klubbfältet.
- **Varför**: förslag vid okänd bricka i avläsningen (namn, klubb, klass och anmälda utan bricka), även utan nät, och i
  Ny deltagare; Eventors id följer med till IOF-exporten.
- **Var och hur länge**: en databas per Eventor-organisation (`runner_database*`), delad av klubbens tävlingar. Den
  ersätts helt i en transaktion varje gång den uppdateras och finns kvar tills den uppdateras eller raderas
  ("Radera löpardatabasen"). Auditposten har bara antal, aldrig namn eller brickor.
- **Vem**: administratören av en tävling vars sparade nyckel tillhör klubben uppdaterar och raderar
  (`requireRaceRole` ADMIN). Administratörer och funktionärer i klubbens tävlingar får förslag: avläsningspaketet har
  den egna och de tillagda klubbarnas löpare (högst 10 000) och klubbarna; resten söks på servern
  (`…/runner-database/search`, funktionär). Inget publikt svar läser tabellerna; route-testet (`race-roles.test.ts`) och
  integrationstestet `steg-29-lopardatabas` kontrollerar det. Paketet sparas i webbläsarens IndexedDB på avläsningsdatorn
  som resten av avläsningspaketet.

## Radiokontroller (ADR-0172 beslut 5)

Bara administratören ställer in radion (källa, enhetens id, radiokontroller); funktionären och besökare når inte
inställningarna. Radiostämplingarna sparas oförändrade med bricknummer, kontroll och tid. Publikt (resultatlistan,
sträcktidsanalysen, tävlingssidan) och för speakern visas bara namn, klubb, klass, kontroll, tid och placering för
anmälda löpare – aldrig bricknummer eller okända brickor. Okända brickor syns bara för administratören. Tjänsten anropas
utan nyckel, utan omdirigeringar, med tidsgräns och storleksgräns; loggarna har felkod och tävlingens id men inga
bricknummer eller namn. Stämplingarna tas bort med tävlingen.

## Konton och superadmin (ADR-0172)

Kontot identifieras med normaliserad e-post. Lösenord lagras som `scrypt`-verifierare (minst 8 tecken).
Inloggning spärras efter fem fel per e-postadress i 15 minuter, och efter 30 fel från samma IP-adress (oavsett konto) i 15
minuter; spärrarna går ut av sig själva och är aldrig permanenta (steg 46). Registrering, återställningsförfrågningar och
självregistrering räknas per IP-adress (och per e-post eller tävling). Nycklarna sparas bara som HMAC-SHA-256 med serverns
hemlighet (`OTID_THROTTLE_SECRET`, annars härledd ur `DATABASE_URL`), och rader äldre än två dygn tas bort vid nästa
skrivning (`application/src/account-throttle.ts`). Glömt lösenord svarar likadant
oavsett om adressen finns. Länken bär en slumpad engångsnyckel (bara hashen sparas), gäller en timme och
en gång, och alla kontots sessioner spärras när lösenordet byts. Länken ligger i adressens fragment
(`/recover#token=…`), så den hamnar inte i serverloggar, och sidan tar bort den ur adressfältet.
SMTP-fel loggas med felkod, aldrig med adress eller länk.

Superadmin sätts bara med kommando på servern. Varje superadminåtgärd kräver ett skäl och skrivs i en
append-only-logg utan främmande nycklar, så den finns kvar när kontot eller tävlingen är borttagen.
Borttagning av tävling eller konto tar bort alla rader som hör till, också råa avläsningar, i en
transaktion. Vilka personuppgifter som sparas står på `/integritet` (kontakt: `OTID_CONTACT_EMAIL`).

## Svarshuvuden och CSP (PLAN.md steg 46)

- Alla svar (`next.config.ts`): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` och
  `X-Frame-Options: DENY`. Ingen sida i O-Tid behöver bäddas in i en ram, så det finns inga undantag. Adminsidorna,
  kontosidorna och avläsningsskalet har `Referrer-Policy: no-referrer`.
- Next-sidorna (publika, admin och konto) får en strikt CSP med nonce från `src/proxy.ts`:
  `script-src 'self' 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
  (`lib/content-security-policy.ts`). Next sätter noncen på sina skript; därför renderas alla sidor vid förfrågan
  (rotlayouten väntar på `connection()`). Stilar, bilder och anrop begränsas inte (React sätter style-attribut och festens
  färger); allt laddas från samma värd. Utvecklingsläget har dessutom `'unsafe-eval'`.
- Avläsningsskalet och bardisken (`/admin/{id}/readout` → `/readout/index.html`) har en egen CSP utan inbäddade skript
  (`default-src 'none'`, bara egna filer, service worker) och `Permissions-Policy` med `serial=(self)` och `usb=(self)`.
- API-svaren har `default-src 'none'; frame-ancestors 'none'`.
- Playwright `sakerhetshuvuden` kontrollerar huvudena på en publik sida, en adminsida, avläsningen, fest-sidan och en API-rutt
  och att sidorna fungerar utan CSP-fel.

## Självregistrering och fest (PLAN.md steg 41, 46)

- Självregistrerade deltagare syns direkt i den publika startlistan, märkta "självreg." (kontraktets `selfRegistered`). Att
  vänta på arrangörens bekräftelse valdes bort: det skulle kräva ett nytt beslutsflöde och hindra löparen från att se sig
  själv. Missbruk begränsas av spärren (20 per IP och 10 minuter, 100 per tävling och dygn) och knappen "Stryk alla
  självregistrerade som inte läst ut" under Anmälda (förhandsvisning, bekräftelse, auditpost per deltagare).
- Fest: "Visa namn på den publika sidan" är av för nya fester. När namnen visas säger formuläret och fest-sidan det
  ("Dina köp visas med ditt visningsnamn på den här sidan."). Belopp, bricknummer och fullt namn visas aldrig publikt.
- Funktionären ser fullt namn och kan ladda ner festens köp som CSV; det är avsiktligt och står i hjälpen och under
  Personer med behörighet.
