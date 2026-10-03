# ADR-0145: eventbunden medadministratör och återkallelse

- Status: Accepterad för TASK151
- Datum: 2026-09-23

## Kontext

ADR-0144 gav ett beständigt arrangörskonto och en immutable `OWNER`-grant för
ett nyskapat event. Den planerade A2-delen behöver ge en andra inloggad person
rätt att arbeta i samma events befintliga lopp, och låta ägaren dra tillbaka
rätten utan att skriva om historik eller stänga stationernas offlineväg.
Nuvarande uniknyckel på `(account_id, event_id, role)` förhindrar att en
återkallad person får en ny grant. `enterRaceAsUserAccount` och den centrala
delegeringskontrollen accepterar dessutom bara `OWNER`.

## Beslut

En aktiv `OWNER` får ge rollen `ADMIN` till **ett redan provisionerat internt
arrangörskonto** via dess exakta normaliserade inloggningsnamn, för **ett
uttryckligt event**. Det är direkt tilldelning, inte e-postinbjudan eller
självregistrering. Varken namn, klubb, Eventor-id, publik länk eller en äldre
racecredential bevisar kontoidentitet. Servern resolverar målet, och svar/lista
visar endast konto-id, inloggningsnamn, visningsnamn, roll och grantens tider.
Ägaren kan lista aktiva och återkallade `ADMIN`-grants för sitt event och
återkalla en exakt grant-id. En `ADMIN` kan inte ge eller återkalla kontorätt.
`OWNER` kan inte återkallas av denna A2-yta, och ägaren kan inte ge sig själv
en extra `ADMIN`-grant.

Aktiv `ADMIN` får se eventet under ”Mina tävlingar”, öppna ett av dess lopp via
samma konto-/sessionsbundna `MANAGE_RACE`-delegation som ägaren och utföra de
redan integrerade raceadministratörsåtgärderna. Rollen ger inte rätt att
styra andra event, ge kontoroller, använda Eventor-nyckel, komma åt privata
PM/kartor/rutter eller ändra stationscredential utanför befintlig policy.
Ingen separat adminprodukt eller ny resultatregel skapas. Operativa
start-/mål-/stationscredentials och deras offlinefunktion ändras inte.

### Historik, återtilldelning och retry

Grant och återkallelse förblir append-only. `ADMIN` läggs till i den befintliga
PostgreSQL-enumen. Den gamla `(account_id,event_id,role)`-unikheten ersätts av
en `OWNER`-specifik unikhet; historiska återkallade `ADMIN`-grants får finnas
kvar. Varje ny tilldelning efter återkallelse skapar en **ny grant-id**.
Applikationen låser eventraden exklusivt före kontroll av aktiv grant och
infogning/återkallelse. Därmed kan två skilda samtidiga requests inte skapa
två aktiva `ADMIN`-grants för samma konto/event. Ingen gammal grant återupplivas.

Varje GRANT/REVOKE har kanoniskt request-UUID och en immutable requestjournal
med actor, event, targetkonto, grant-id, action, eventuell orsak och tid.
Exakt samma request-id/actor/intent ger samma utfall även efter tappat svar;
ändrad actor, event, target, grant eller orsak med samma request-id är konflikt.
En ny request för en redan aktiv ADMIN eller redan återkallad grant ger
konflikt, inte en tyst ny tilldelning eller duplicerad audit. Efter en
återkallelse får en ny GRANT-request skapa en ny aktiv grant. Revisionerna
och actor-attributerad audit bevaras.

### Omedelbar behörighetsverkan

Revoke skriver den befintliga `event_administration_grant_revocation` och
dess trigger avancerar grantens MVCC-vakt i samma transaktion. Både ny
race-enter och **varje** befintlig delegerad race-request kontrollerar aktivt
föräldrakonto, föräldrasession, exakt event/race och oåterkallad `OWNER` eller
`ADMIN`-grant under relevant lås. En tidigare utställd session mister därför
rätt vid nästa request, inklusive skyddade läsningar i en äldre snapshot.
Legacy racecredentials saknar delegationslänk och fortsätter på sin gamla väg.

HTTP-rutter använder kontosession, exakt Origin, CSRF för mutation, strikt
kontrakt, `no-store` och begränsad body. Okänt event/target/grant ger ett
icke-läckande avslag. Ingen kontokatalog eller publik behörighetsprojektion
införs. UI:t ligger i befintlig kompakt `/organizer`-vy under exakt event,
med synliga svenska etiketter, textåterkoppling och explicit granskning av
inloggningsnamnet före tilldelning. Vid okänd commit behålls request-id och
intent för exakt retry eller uttryckligt avbrytande.

## Migration och återställning

TASK151 lägger additivt till enumvärdet och en immutable requestjournal.
Den ersatta globala grant-unikheten är ett medvetet undantag från ren
expand-only: ägarunikheten behålls, medan flera **historiska** ADMIN-rader
blir möjliga. Inga befintliga grants, spärrar, konton, sessioner eller audit
ändras eller raderas. Före aktivering måste migrationen och appens
eventradlås verifieras på isolerad PostgreSQL. Vid incident stängs de nya
grant-rutterna och aktiva ADMIN-grants spärras med bevarade journaler; rätta
framåt eller återställ verifierad full backup. Ta aldrig bort historiska
grants/revocations/audit för att backa funktionen.

## Inte i detta beslut

Organisation/medlemskap, publik registrering, e-postinbjudan, ägaröverföring,
rollhierarki med valbara behörigheter, klubbgemensamma rättigheter och
automatisk tilldelning av äldre event. Det kan kräva separata ADR:er.
