# ADR-0144: kontobunden arrangör och eventadministration

- Status: Accepterad för TASK150:s första vertikala snitt
- Datum: 2026-09-23

## Kontext

CODEX_BRIEF:s målbild har användare, organisationer, medlemskap och
rolltilldelningar. Dagens ADR-0021 gav avsiktligt en separat åttatimmars
`CREATE_EVENT`-credential utan användaridentitet eller efterföljande rätt till
det skapade loppet. ADR-0020/0069/0117 ger racebundna, kortlivade
capabilities och en integrerad `MANAGE_RACE`-arbetsyta, men credentialetiketter
är inte verifierade personer. Den publika tävlingslistan är inte ”Mina
tävlingar”. En ny arrangör måste i dag få separata hemligheter för att skapa
och sedan administrera samma tävling.

Målplanens första snitt ska ge en vanlig inloggning, beständig
eventadministration, idempotent skapande och återöppning efter ny session.
Det får inte omtolka äldre credentials till användarkonton, göra gamla
event till någon annans egendom eller försvaga start-/mål-/stationsgränsen.

## Beslut

### Konto och initial provisionering

Inför en separat intern `user_account` med servergenererat UUID, unikt
normaliserat inloggningsnamn, kort visningsnamn och aktiv/spärrad status.
Ingen extern identitet eller Eventor-id används som PK eller som bevis på
kontroll över ett konto. Första arrangörskontot provisioneras endast från en
betrodd CLI med privat stdin-underlag. CLI genererar ett långt slumpmässigt
initialt lösenord och skriver det bara till en uttryckligt vald privat
0600-utdatafil; lösenord/hemligheter går aldrig i argv, logg, URL eller
databas i klartext. Samma betrodda väg kan rotera lösenordet och samtidigt
spärra tidigare kontosessioner. Ingen publik självregistrering eller
e-postleverans ingår i TASK150.

Verifieraren använder Node:s asynkrona `scrypt` med individuell slumpmässig
salt, versionsmärkt parametrisering minst `N=2^15, r=8, p=3`, en beräknad
nyckel om minst 32 byte och explicit tillräckligt `maxmem`; jämförelsen är
konstanttid. En databasbeständig, transaktionssäker spärr per normaliserat
inloggningsförsök begränsar även okända namn före dyr verifiering. Felaktigt
namn/lösenord ger samma yttre svar. Första snittet använder endast
maskingenererat lösenord; om användarvalda lösenord senare erbjuds krävs
blocklist-/återställningsbeslut. Se [källunderlag](../research/organizer-account-auth-2026-09-23.md).

En lyckad login skapar en egen opak, slumpmässig kontosession med enbart hash
av hemligheten i PostgreSQL. Fast serverstyrd maximal giltighet är åtta timmar;
ingen automatisk förlängning eller ”kom ihåg mig” införs. Produktionscookien
är host-only `__Host-` med `Secure`, `HttpOnly`, `SameSite=Strict` och
`Path=/`; explicit HTTP-loopback får separat namn. Skyddade mutationer kräver
exakt Origin och separat CSRF-bevis. Utloggning och kontospärr ger omedelbar
serverkontrollerad avvisning; browsern lagrar inte autentiseringshemligheter
i Web Storage. Konto och befintliga capabilitysessioner är olika trust
domains.

### Eventroll utan automatisk historisk ägare

En separat append-only `event_administration_grant` binder konto till event
med rollen `OWNER`; kommande snitt kan lägga till `ADMIN` och en separat
spärrjournal. Rollen betyder administrativ åtkomst, inte juridiskt ägande,
klubbmedlemskap eller rätt till Eventornyckel, karta och privat GPX som ligger
utanför redan godkända arbetsytor. Organisations-/medlemskapsmodellen
förblir en framtida explicit utvidgning; inga falska klubbrelationer skapas.

Ny kontobunden `POST /api/organizer/events` använder samma strikt validerade
event-/raceintent och exakta request-id-semantik som ADR-0021, men en separat
requestjournal bunden till **account-id**, inte legacy credential-id.
Kontosessionen autentiseras igen under transaktionslås. Event, första race,
OWNER-grant, requestjournal och kontoidentifierad audit committas atomiskt.
Exakt samma konto/request-id/normaliserade intent returnerar samma resultat;
ändrat konto eller intent konflikterar. `GET /api/organizer/events` väljer
endast aktiva grants för det inloggade kontot och minimerad event-/racemetadata.
En anonym eller annan inloggad användare får aldrig listan.

Äldre `POST /api/events` och dess `CREATE_EVENT`-session fortsätter vara ett
separat, tillfälligt bootstrapflöde under övergången. Historiska event och
event skapade via äldre credential får ingen OWNER-rad genom denna migration.
Senare övertagande kräver egen granskad, auditerad uppgift; varken matchande
namn, e-post, credentiallabel eller tidigare skapandejournal räcker.

### Samma login in i befintlig administration

Från ”Mina tävlingar” kan en aktiv OWNER välja exakt ett race i sitt event.
En skyddad `enter`-mutation kontrollerar kontosession och grant under lås,
skapar en kortlivad racebunden, konto-/sessionskopplad `MANAGE_RACE`-
delegation och sätter den befintliga administratörssessionens cookies utan
att visa ett bearer-token i browsern. Den går till befintlig `/manage`, inte
till en ny kopia av administrationsfunktionerna. Delegationen får högst en
timmes giltighet och högst kontosessionens återstående tid.

Varje användning av en sådan delegations session ska i den **gemensamma**
race-capabilityautentiseringen även bevisa aktivt föräldrakonto, oåterkallad
föräldrasession och aktuell eventgrant för just racets event. Saknas länken
gäller befintlig legacy-autentisering oförändrad. Kontoutloggning/spärr eller
senare grantspärr avvisar en delegerad race-session vid nästa request utan
att behöva gissa vilka cookies som finns på andra enheter. Audit ska kunna
härleda konto-id från den immutable delegationslänken; äldre credentialaudit
skrivs inte om. `MANAGE_RACE`-delegation är inte `PAIR_STATION`, Eventor-
credential, PM-/kartrelease eller publik åtkomst utöver de redan explicit
tillåtna integrerade administratörshandlingarna.

Precis som ADR-0037:s racecredentialgrind behöver konto och eventgrant var
sin liten muterbar MVCC-generation. Append-only spärr av konto, session eller
grant samt lösenordsrotation avancerar rätt generation i samma transaktion.
Skyddad läsning låser generationen och avvisar/återförsöker inte tyst en gammal
`REPEATABLE READ`-snapshot. Själva spärr- och verifierarjournalerna förblir
immutable; generationen är bara en synkmarkör, inte behörighetssanning.

### UI och publik gräns

Ny kontoentré och ”Mina tävlingar” ligger separat från den publika startsidan.
Den visar bara kontots tävlingar och tydliga tom-/fel-/utloggad-tillstånd.
Efter skapande kan samma inloggning öppna det nya loppet. Svensk enkolumnsvy
vid 390 px behåller synliga etiketter, stora tryckytor och textlig återkoppling
om okänd commit/exakt retry. Publika start-/resultatvyer fortsätter kräva
varken konto eller installation. Stationsappens offlinepaket och kö ändras inte.

## Migration, återställning och stegvis införande

TASK150 använder en additiv migration för konto, verifierare, loginspärr,
session/spärr, eventgrant, de två MVCC-vakterna, kontobunden createjournal och delegerad
racecredentialkoppling. Äldre tabeller, credentials, sessioner, event och
resultat lämnas orörda. Nya authrutter ska vara avstängbara separat; vid
incident stängs de, aktiva kontosessioner spärras och en korrigerande migration
görs. Inga identitets-/auditjournaler droppas i en databas med data. Full
återställning kräver verifierad backup. Den exakta låsordningen och
constraints dokumenteras i migration/TASK150 innan serverwriter aktiveras.

## Konsekvenser och avvisade alternativ

- En beständig personidentitet och administrativ eventroll tillkommer utan
  att resultat- eller tävlingsformat ändras. Den första kontoprovisioneringen
  kräver betrodd drift; självanmälan och inbjudan blir separata snitt.
- `CREATE_EVENT` som permanent konto eller automatisk upphöjning av en
  äldre credential avvisas: ADR-0021 ger uttryckligen ingen race- eller
  personrätt och hemligheten kan ha överlämnats operativt.
- Matcha befintliga event via namn/skapanderequest avvisas: det bevisar inte
  dagens rätt till tävlingen.
- En separat ny adminprodukt eller en global wildcardroll avvisas: befintlig
  avgränsad `MANAGE_RACE`-arbetsyta återanvänds.
- Enbart cookieexistens, klientlagrad roll eller in-memory loginspärr avvisas:
  behörighet, spärr och retry måste vara serverbevisade och tåla omstart.
- Extern identitetsleverantör, nytt backend-ramverk och full klubbmodell
  avvisas för TASK150 eftersom första arrangörsflödet inte kräver dem.
  Senare behov kan prövas i ett nytt ADR utan att ändra dagens identiteter.
