# Säkerhet och integritet

Detta dokument kompletterar CODEX_BRIEF och befintliga ADR:er; det innebär inte
att hela produktionssäkerheten är färdig eller granskad.

## Grundgränser

Racebundna capabilities och global CREATE_EVENT har separata lagrings-/
behörighetsgränser. Privata operativa vyer använder host-only sessionscookies,
CSRF/Origin och no-store. Publika projektioner väljer uttryckliga fält.
Kartor, GPS, dokument och API-nycklar är privata som standard. Servergenererade
interna IDs och immutable beslut används för spårbarhet, inte externa PK:n.

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
med klubbens riktiga nyckel återstår.

## Konton och superadmin (ADR-0172)

Kontot identifieras med normaliserad e-post. Lösenord lagras som `scrypt`-verifierare (minst 8 tecken).
Inloggning spärras efter fem fel per adress i 15 minuter; registrering och återställningsförfrågningar
räknas per IP-adress (och per e-post) och timme, med nycklarna hashade. Glömt lösenord svarar likadant
oavsett om adressen finns. Länken bär en slumpad engångsnyckel (bara hashen sparas), gäller en timme och
en gång, och alla kontots sessioner spärras när lösenordet byts. Länken ligger i adressens fragment
(`/recover#token=…`), så den hamnar inte i serverloggar, och sidan tar bort den ur adressfältet.
SMTP-fel loggas med felkod, aldrig med adress eller länk.

Superadmin sätts bara med kommando på servern. Varje superadminåtgärd kräver ett skäl och skrivs i en
append-only-logg utan främmande nycklar, så den finns kvar när kontot eller tävlingen är borttagen.
Borttagning av tävling eller konto tar bort alla rader som hör till, också råa avläsningar, i en
transaktion. Vilka personuppgifter som sparas står på `/integritet` (kontakt: `OTID_CONTACT_EMAIL`).
