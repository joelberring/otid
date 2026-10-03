# ADR-0153: ägarutfärdad kontoinbjudan med separat ADMIN-beslut

- Status: Accepterad för A3b/TASK160 före implementation
- Datum: 2026-09-23

## Kontext och dokumentkonflikt

A3a/ADR-0152 låter endast betrodd server-CLI utfärda en engångskod till ett
nytt konto. A2/ADR-0145 låter aktiv event-OWNER ge ADMIN endast till ett
**redan existerande** konto. Det lämnar ett manuellt operatörssteg mellan
eventägaren och en ny medadministratör. Målplanen och TASK159 kallar nästa
ägarstyrda inbjudningssnitt A3b och recovery A3c. ADR-0152 råkar kalla
recovery A3b. Konflikten är registrerad i `docs/status.md`. Här används
namnen **A3b ägarstyrd inbjudan** och **A3c recovery**; ingen
återställningsrätt följer av namnbytet.

## Beslut

En aktiv, inloggad `OWNER` får från sitt exakta events befintliga
”Medadministratörer”-panel utfärda en kortlivad kontoinbjudan till ett
normaliserat `loginName` som ännu inte finns. Inbjudan är kopplad till
eventet och utfärdarens konto i en immutable journal för spårbarhet och
privat status/spärr. Den är **inte** en ADMIN-grant. Mottagaren använder
A3a:s oförändrade `/activate`, väljer sitt eget lösenord och får ett konto
utan event- eller anmälningsrätt. När status är `REDEEMED` måste en då
behörig OWNER granska mottagaren och uttryckligen använda A2:s befintliga
ADMIN-tilldelning. Samma panel gör stegen begripliga, men skapar aldrig en
grant vid kontoaktivering, namnmatchning eller bara kodinnehav.

Detta extra godkännandesteg är avsiktligt: koden lämnas manuellt utan
verifierad e-post/personidentitet och kan levereras fel. Kontoinnehavaren
får inte tävlingsadministration genom ett sådant misstag. En OWNER som
förlorat sin rätt kan inte utfärda/spärra nya inbjudningar eller ge ADMIN;
redan utställd kontokod kan däremot fortfarande skapa ett **rättighetslöst**
konto tills den spärras av betrodd operatör. A2:s rättighetskontroll är
alltid färsk när ADMIN senare tilldelas.

### Kod, transport och retry

OWNER:s browser genererar 32 kryptografiskt slumpmässiga byte med Web Crypto,
kanoniskt base64url och ett UUID-request-id. Den sänder endast SHA-256 av
kodbyten, normaliserat loginName, visningsnamn och exakt event-id över en
kontosessionsskyddad POST med Origin, CSRF, liten kropp och `no-store`.
Servern bestämmer giltighetstiden (högst 24 timmar i detta snitt, under
A3a:s absoluta 48-timmarsgräns) och lagrar bara hash. Klartextkoden visas
en gång i ägarens sidminne för privat överlämning; den finns inte i URL,
Web Storage, analytics, serverlogg eller läs-API. Ägaren ansvarar för att
kontrollera tänkt mottagare utanför systemet. Ingen e-postfunktion eller
verifierad kontaktväg införs.

Exakt samma request-id, aktör, event, loginName, visningsnamn och kodhash
återger samma inbjudnings-ID/status. Ändrad avsikt är konflikt. Browsern
behåller exakt intent och kod i minnet vid osäkert svar. Om sidan lämnas
förloras koden: ägaren kan se icke-hemlig status, spärra en ännu ej inlöst
inbjudan och därefter utfärda en ny, men inte återskapa klartexten. En
förbrukad inbjudan kan inte spärras; ett redan skapat konto eller ADMIN-
grant måste hanteras med sina separata befintliga spärrvägar.

### Persistens och lås

Migration 0083 lägger additivt till immutable event-/actorbundna issue- och
revocationjournaler som pekar på A3a:s befintliga issue/revocation. Den
befintliga per-loginName-reservationen, unik kodhash, at-most-once-
redemption, beständig gissningsspärr och konto-/verifierartransaktion
återanvänds. Inga äldre issue-/redemption-/grant-rader ändras. Inbjudans
event-bindning får inte härledas ur operatorLabel eller klientens visade
eventnamn.

OWNER-skrivningar verifierar aktuell kontosession och CSRF, låser sedan
eventraden och aktiv OWNER-grant före per-loginName-reservation/inbjudan.
Revoke låser samma ordning. A3a:s kontoaktivering låser inte event och kan
inte skapa grant, så ingen event↔login-låscykel införs. Issue/revoke,
eventjournal och race-audit committas atomiskt. Requestjournalerna binder
aktör, event, exakt invitation-id och intent för säkert återförsök. En
annan OWNER kan granska/spärra en pending inbjudan för samma event, men
retry av en ursprunglig mutation är fortfarande bundet till dess aktör.

Läsning av inbjudningsstatus är endast för aktiv OWNER på exakt event och
visar begränsad lista med loginName, visningsnamn, tid, status och ID, aldrig
kod/hash. Okänt event, inbjudan eller obehörig aktör ger neutralt avslag.
ADMIN kan inte utfärda, läsa listan eller spärra. Publikvy, deltagarkonto,
station/offlinekö och äldre CLI förblir oförändrade.

## Alternativ och konsekvenser

Automatisk ADMIN-grant vid inlösen avvisas för detta snitt. Den skulle göra
en manuellt överlämnad kontokod till eventbehörighet, kräva en ny
förtroende-/samtyckesgräns i `/activate` och en låsordning för event och
konto vid inlösen. Den kan beslutas separat om användarprov visar att det
uttryckliga OWNER-steget är ett verkligt hinder. Den nu valda tvåstegsvägen
är något mindre snabb men återanvänder A2:s beprövade granskning och
återkallelse. Självregistrering, e-post, recovery, ägarbyte och automatisk
entry claim ingår inte.

Rollback i drift: stäng nya OWNER-issue/list/revoke-rutter, använd betrodd
A3a-status/spärr för koder som redan utfärdats och behåll journaler/audit.
Rätta framåt eller återställ verifierad full PostgreSQL-backup; droppa inte
historik eller gamla konton. Om browserkoden gått förlorad kan den inte
rekonstrueras från hash efter restore.
