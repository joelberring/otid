# ADR-0147: kontobunden följning av offentliga resultat

- Status: Accepterad för TASK153
- Datum: 2026-09-23

## Kontext

Den publika resultatlistan har redan lokala favoriter i webbläsarens
`localStorage`. De synkas inte mellan enheter. ADR-0146:s deltagarkoppling
intygar kontroll över en exakt anmälan och får inte användas för att följa
andras resultat. `publicResultId` är en offentlig navigationsidentitet,
aldrig behörighet eller bevis på ägarskap. B2 kräver att ett inloggat konto
kan följa ett redan publicerat resultat på mobil och hitta samma val på dator,
medan anonym användning förblir kontofri.

## Beslut

Följning är en **egen kontopreferens**, inte en resultatrevision, deltagarclaim,
personprofil eller ny rätt till privat data. Målet identifieras av paret
`raceId` + `publicResultId`. Servern accepterar `FOLLOW` bara om exakt paret
just nu finns i den validerade offentliga resultatprojektionen. En tidigare
följd post får alltid avföljas av kontot även om resultatet senare är
otillgängligt. Okända och aldrig publicerade paret ger samma neutrala avslag.

En additiv append-only-journal sparar `accountId`, race/resultatparet,
önskat läge, globalt unikt request-id, monoton sekvens och tid. Sammansatt
FK binder paret till befintlig `entry(race_id, public_result_id)` men varken
entry-id eller annan intern identitet lämnar API:t. Mutation autentiserar
bibliotekets befintliga `user_account`-session med Origin/CSRF och låser kontot
för att ordna samtidiga kommandon. Exakt retry med samma konto, mål och läge
returnerar samma journalhändelse; återanvänt request-id med ändrad aktör
eller avsikt ger konflikt. Senaste händelsen per konto/mål anger aktivt läge.
Högst 1000 aktiva följningar per konto tillåts i detta snitt så att privata
listan och uppslag mot offentlig projektion förblir avgränsade.

Den skyddade listan returnerar endast aktiva följningar för kontot och
hämtar varje aktuell rad via **samma** validerade offentliga V7-projektion
som anonyma besökare får. När ett resultat avpubliceras eller saknas blir
`result: null`; servern lämnar inga tidigare namn, statusar, tider,
sträcktider, interna IDs eller privata data från en gammal projektion.
Paret, event-/loppsnamn och ett otillgängligt-tillstånd får visas för just
kontot så att användaren kan avfölja; en senare återpublicering visas igen
utan att journalen skrivs om. Läsning är `no-store` och verifierar sessionen
vid varje request. Publika API:er får inga följarmetadata.

Den befintliga favoritknappen i publik resultatlista används för samma enkla
handling. Utloggad fortsätter den att skriva enbart till lokal `localStorage`.
Inloggad visar den serverns kontoval och skriver enbart via det privata API:t.
Vid oklar nät-/sessionsstatus får UI inte påstå att ett lokalt val är synkat;
fel visas och åtgärden kan provas igen med samma request-id. Lokala favoriter
importeras **inte tyst** vid inloggning och raderas inte vid utloggning.
”Mitt resultat” kan visa en kompakt separat lista med följda offentliga
resultat; den blandas inte med egna verifierade anmälningar. UI och texter är
svenska och fungerar på 390 px utan horisontell scroll.

## Drift, migration och verifiering

Migration 0080 är additiv, utan bakfyllnad eller ändring av befintliga
favoriter/resultat. Journalen är immutable med FK, unik request-id och
index för kontobunden senaste-händelse-läsning. Vid incident kan de nya
privata följvägarna stängas; offentlig resultatlista och lokala favoriter
fungerar fortfarande. Återställning görs från verifierad PostgreSQL-backup,
inte genom att radera/skriva om historiska journalhändelser.

Riktade kontrakts-, PostgreSQL-, route-/UI- och ett browserprov täcker
kontoseparation, exakt retry/ändrat intent, samtidig följ/avfölj, återtaget
publikt resultat, ny publicerad revision, anonym lokal favorit och samma
kontoval efter ny browserkontext. Syntetisk browser/DB är inte fysisk
mobil- eller fältverifiering.

## Avvisade alternativ och kvarvarande luckor

Att återanvända deltagarclaim, personnamn, bricknummer eller publik länk som
ägarskapsbevis avvisas. Att lägga följning i publik resultatrad avvisas
eftersom det skulle skapa kontodata i anonym cache. Automatisk sammanslagning
av gammal lokal lista avvisas: den kan vara en delad enhets val och får inte
oombett knytas till ett konto. Explicit import och offline redigering av
kontoföljning är framtida separata val. Självregistrering/återställning från
ADR-0146 kvarstår som införandelucka.
