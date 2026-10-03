# ADR-0154: betrodd engångsåterställning av ett befintligt kontolösenord

- Status: Accepterad för A3c/TASK161 före implementation
- Datum: 2026-09-23

## Kontext och förtroendegräns

A3a:s inbjudningskod får endast skapa ett **nytt** konto. A3b:s eventägare
får bjuda in ett nytt konto men får inte återställa en annan persons globala
konto. Ett konto kan redan äga flera event, ha ADMIN-grants och separata
anmälningskopplingar. `loginName`, klubb, eventroll, inbjudningskod eller
publikt resultat bevisar inte att den som begär reset är samma person.
Systemet har ännu ingen verifierad e-post/telefon eller accepterad global
supportroll. ADR-0153 har redan löst namnkonflikten: A3c är recovery.

Den befintliga betrodda `rotateUserAccountPassword` appenderar en verifierare
och spärrar äldre sessioner genom versionskontroll. Som mottagaråterställning
är den otillräcklig: den genererar ett återanvändbart lösenord hos operatören,
och ett osäkert retry roterar igen utan requestjournal. Den behålls som
separat betrodd incidentväg, inte som A3c:s normala användarresa.

## Beslut

En **betrodd serveroperatör** får efter identitetskontroll utanför O-Tid
utfärda en kortlivad engångskod till exakt ett befintligt, aktivt konto.
Operatören måste ange både kanoniskt `accountId` och normaliserat
`loginName`, en operatörsetikett och en begränsad anledning. Servern
kontrollerar att ID och namn fortfarande betecknar samma konto. Detta
förfarande är en operativ attest, inte ett kryptografiskt bevis på person.
En event-OWNER, ADMIN, funktionär eller annan användare får ingen reset-
behörighet av sina befintliga rättigheter. Ingen publik begäran kan utfärda
kod; den offentliga ytan tar endast emot en redan privat överlämnad kod.

CLI:n genererar 32 slumpbyte, sparar endast SHA-256 i en immutable issue-
journal och skriver kod + exakt requestintent till en ny privat 0600-fil
**före** databasmutationen. Giltighetstiden är serverbestämd till 24 timmar
och högst en ospärrad, ej förbrukad och ej utgången kod per konto får finnas.
Vid osäkert svar ger samma request-id, konto, operatör, anledning, hash och
expiry samma issue-id; ändrat intent ger konflikt. Förlorad kod hämtas aldrig
från servern: läs privat status, spärra pending och utfärda ny. Operatören
överlämnar bara konto-/inloggningsnamn och kod via en separat privat kanal.
Varken URL, argv, standardlogg, databas i klartext eller browserlagring får
innehålla koden. Stulen enhet eller pågående kapning kräver den separata
omedelbara betrodda konto-/sessionsspärren; enbart kodutfärdande stänger
inte gamla sessioner före inlösen.

Mottagaren använder en kompakt svensk `/recover`-vy på egen enhet. Den
anger `loginName` och engångskod, låter Web Crypto skapa ett nytt 32-byte
base64url-lösenord och kräver synlig spara-/kopiera-bekräftelse före POST.
Koden och lösenordet hålls bara i sidminnet, med exakt request-id/intent
för retry efter okänt svar. En ny `POST /api/account/recovery` kräver
exakt Origin, liten kropp och `no-store`, men ingen gammal kontosession.
Okänt namn, fel/utgången/spärrad/förbrukad kod, bytt verifierarversion
och ändrat retry-intent ger samma neutrala yttre fel utan kontometadata.
Ingen ny session eller auto-login skapas; mottagaren loggar in normalt.

Inlösen låser ett beständigt per-login gissningsskydd och den exakta
kontoraden, verifierar hash och att kontot inte är spärrat, att koden är
pending och att kontots aktuella verifierarversion är samma som vid issue.
Den appenderar nästa `scrypt-v1`-verifierarversion och en immutable
redemptionjournal i **en** transaktion. Samma redemption-request och
kanoniska kod-/lösenordsintent återger samma version; annan avsikt avvisas
utan ny verifierare. Samtidig inlösen, spärr, ny issue eller betrodd rotation
får inte ge två vinnare. Gissningsspärren gäller även okända namn och
består över omstart. `user_account_auth_guard`/kontoradlås och befintlig
versionskontroll gör alla äldre kontosessioner och deras race-delegeringar
ogiltiga efter commit. Ny login med nya lösenordet krävs.

Återställning ändrar **inte** konto-ID, loginName, eventägarskap,
ADMIN-grants, anmälningskopplingar, följval, ruttsläpp eller rå-/resultatdata.
Alla sådana rättigheter kontrolleras fortfarande genom sina egna aktuella
regler efter ny login. Inbjudans eller återställningens kod är aldrig ett
event-/entry-bevis. Operatörens globala access är redan en driftgräns och
får inte ges åt eventägare bara för att de kan bjuda in nya konton.

## Persistens, test och återställning

Migration 0084 är additiv: immutable issue-, revoke- och redemptionjournaler
med unika request-/kod-/inlösen-ID:n, exakt konto-/verifierarversionsbindning
och en separat beständig loginbaserad återställningsspärr. Vid ett
misslyckande rullas verifierarversion och redemption tillbaka tillsammans;
tidigare historia skrivs aldrig över. En begränsad betrodd status/spärrväg
visar inga kod- eller lösenordsbyte. Ingen racebunden auditrad fabriceras
för en global kontoåtgärd; recoveryjournalen är dess egen spårbarhet.

Kör riktade kontrakts-, CLI-, PostgreSQL-, route- och 390px-browserprov
mot en uttryckligen isolerad syntetisk databas. Prova särskilt exakt retry,
ändrat intent, fel/utgången/spärrad/förbrukad kod, samtidighet, gissnings-
spärr, äldre konto-/race-sessioners avslag, ny login och oförändrade
grant-/claim-ID:n. Browserprov bevisar inte privat verklig överlämning,
fysisk mobil eller produktionsdrift.

Rollback i drift: stäng ny issue-/revoke-CLI och recovery-POST, behåll
journaler/verifierarversioner och fortsätt med den separata betrodda
incidentrutinen. Återställ bara från verifierad full PostgreSQL-backup;
droppa inte recoveryhistorik. Efter restore kan förlorade koder inte
återskapas och måste spärras/ersättas. Stationsavläsning, offlinekö och
publika resultat är oberoende av detta kontoflöde.

## Avvisade alternativ och kvarvarande gräns

- Eventägare återställer ADMIN eller deltagare: en eventroll bevisar inte
  global kontoidentitet och kontot kan ha andra event-/entryrättigheter.
- Publik reset via loginName eller inbjudningskod: namn och nykontokod är
  inte autentisering för befintligt konto.
- E-post/SMS-länk: verifierad adress, leverans och incidentprocess finns inte.
- Återanvänd `rotateUserAccountPassword` som mottagarflöde: operatören får
  då nytt permanent lösenord och retry saknar idempotens.

Detta är en **manuellt attesterad** recoveryresa, inte verifierad identitet,
självbetjänt kodutfärdning eller hela A3:s fältacceptans. Ett senare beslut
krävs för säker självbetjäning eller delegerad support utan server-CLI.
