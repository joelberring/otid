# Säkerhet och integritet

Detta dokument kompletterar CODEX_BRIEF och befintliga ADR:er; det innebär inte
att hela produktionssäkerheten är färdig eller granskad.

## Grundgränser

Racebundna capabilities och global CREATE_EVENT har separata lagrings-/
behörighetsgränser. Privata operativa vyer använder host-only sessionscookies,
CSRF/Origin och no-store. Publika projektioner väljer uttryckliga fält.
Kartor, GPS, dokument och API-nycklar är privata som standard. Servergenererade
interna IDs och immutable beslut används för spårbarhet, inte externa PK:n.

## Eventor (TASK 006V under implementation)

Anslutning binds till namngiven skapandecredential. API-nycklar lagras endast
krypterade med AES-256-GCM och kontextbunden AAD enligt ADR-0046. Masterkey ska
levereras av driftens secret-hantering, separat från databas och dess backup.
Felsvar/loggar får inte innehålla nycklar, ciphertext eller råa upstreamsvar.
Nyckeln matas inte in i webbläsare eller chat. Syntetiska testnycklar får inte
förväxlas med användbara integrationstokens.

Den serverinterna envelope-funktionen finns nu med 32-byte masterkey, slumpad
12-byte nonce, 16-byte tagg och strikt canonical base64url. API-nyckeln måste
vara exakt 32 synliga ASCII-tecken utan whitespace; detta är O-Tids säkra
header-subset, inte ett påstående om en hexregel hos Eventor. Format, miljö,
connection, ownercredential och keyId autentiseras tillsammans. Fel är
generiska utan underliggande crypto-exception. Egna temporära nyckel- och
plaintextbuffertar nollställs; JavaScript-strängar kan däremot inte garanterat
raderas ur processminnet. Funktionen används nu av immutable anslutningslagring
och serverns HTTP-adapter. CLI läser API-nyckeln enbart från högst 34 bytes
privat stdin (32 tecken plus valfri LF/CRLF); nyckeln accepteras inte som argument.
Utfärdande/spärr journalför lokal operatörsetikett. Browsern får endast
connection-id/etikett/miljö och importerad minimal metadata. Inga credentials
sparas i Web Storage. Drift- och liveacceptansen återstår.

Endast fast Testeventor HTTPS-origin används under utvecklingssnittet; inga
redirects eller produktionsfallback. Produktion, nyckelrotation/restore,
behörighetslivscykel och liveimport behöver egna verifieringsbevis före drift.
