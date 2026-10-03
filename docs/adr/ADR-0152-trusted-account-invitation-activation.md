# ADR-0152: betrodd engångsinbjudan för nytt konto

- Status: Accepterad och syntetiskt implementerad för A3a:s första vertikala snitt; inte fältverifierad
- Datum: 2026-09-23

## Kontext

ADR-0144 ger ett serverbeständigt konto, `scrypt`-verifierare och vanlig
inloggning, men endast en betrodd CLI kan provisionera kontot. CLI skapar
ett långt initialt lösenord som operatören sedan måste lämna över. ADR-0145
kan ge event-ADMIN bara till ett redan existerande konto. ADR-0146 kräver en
**annan**, operatörsattesterad kod för att knyta ett inloggat konto till en
exakt anmälan. A3 ska göra kontoöverlämning användbar utan att överföra ett
återanvändbart kontolösenord från operatör till mottagare.

Systemet har varken verifierad e-postadress eller godkänd e-postleverans.
`loginName`, visningsnamn och en manuellt överlämnad kod bevisar inte juridisk
personidentitet. En generell publik registrering eller automatisk
anmälnings-/rolltilldelning skulle därför utöka dagens förtroendegräns.

## Beslut för A3a

En **betrodd server-CLI** får utfärda och återkalla en kortlivad, opak
kontoinbjudan för exakt ett ännu obefintligt, normaliserat `loginName` och
ett fast visningsnamn. Den får inte användas för att ta över eller återställa
ett existerande konto. Operatören ska kontrollera tänkt mottagare utanför
systemet och överlämna koden privat. Första snittet skickar ingen e-post och
påstår ingen verifierad adress. Inbjudan ger ingen event-, race-, entry-,
stations-, Eventor- eller ruttbehörighet. Efter aktivering kan eventägaren
använda ADR-0145:s redan separata ADMIN-tilldelning; deltagaren använder
ADR-0146:s separata kod för exakt anmälan.

CLI genererar 32 kryptografiskt slumpmässiga byte och kodar dem kanoniskt
som base64url. Endast SHA-256 av de ursprungliga 32 kodbyten, normaliserat
loginName, visningsnamn,
utfärdare, request-id, tider och avsikt lagras i PostgreSQL. Koden får bara
skrivas till en uttryckligt vald, ny privat 0600-fil utanför repositoryt,
aldrig till argv, standardlogg, URL, browserlagring eller databas i klartext.
CLI skriver det privata återförsöksunderlaget **före** databasmutationen;
efter okänd commit kan samma underlag/request-id säkert provas igen. En
förlorad kod kan inte återskapas från servern: kontrollera utfärdandet,
återkalla vid behov och utfärda en ny. Maximal giltighet är 48 timmar, med
serverkontrollerat klockslag.

Mottagaren öppnar en separat svensk `/activate`-vy på sin egen enhet, anger
loginName och engångskod och får där ett nytt 32-byte slumpat lösenord via
Web Crypto. Vyn kräver ett uttryckligt steg att kopiera/spara lösenordet i
en lösenordshanterare **innan** aktivering skickas. Hemligheten hålls bara i
sidans minne tills svaret eller användaren lämnar sidan; den läggs inte i
Web Storage, URL eller logg. Första snittet tillåter inte användarvalda
lösenord. Servern accepterar bara ett kanoniskt 32-byte base64url-värde och
lagrar verifieraren med ADR-0144:s befintliga `scrypt`-parametrar. Servern
kan inte bevisa att en alternativ klient använde säker slump; den betrodda
produktvägen gör det och loginspärren kvarstår. Aktivering görs online över
HTTPS (explicit loopback för utveckling), med strikt Origin, liten kropp,
`no-store` och neutrala fel. Den skapar inte automatiskt en session;
mottagaren loggar därefter in via befintlig kontoentré. Förlorat lösenord
kräver ännu betrodd rotation; självtjänståterställning är A3b.

### Beständig korrekthet

En additiv, per-loginName låsbar reservationsrad serialiserar utfärdande,
återkallelse och aktivering. En ospärrad, ej utgången inbjudan per namn får
finnas; ett nytt försök kräver uttrycklig spärr eller utgång. Befintligt
`user_account.login_name` avvisar utfärdande och aktivering. Separata
append-only journaler lagrar issue, redemption och revocation; den muterbara
reservations-/spärrgenerationen är endast synkmarkör, inte rättighetssanning.
Kodhash och utfärdande-request-id är unika. Högst en redemption per
inbjudan och ett nytt konto per redemption är databasconstraints. Konto,
första verifierarversion, autentiseringsvakt och redemption committas i
**samma transaktion**. Ingen äldre konto-, grant- eller claimrad skrivs om.

CLI-utfärdande/återkallelse och browseraktivering har egna UUID-request-id:n.
Exakt retry med samma aktör, inbjudan och normaliserad avsikt returnerar
samma id/resultat. Ändrad avsikt med samma request-id ger konflikt; en annan
redemption av redan använd kod får neutralt avslag och kan aldrig byta
kontolösenord. En varaktig spärr per normaliserat loginName begränsar
aktiveringsförsök, även för okända namn, före dyr verifiering. Okänd,
utgången, spärrad eller förbrukad kod får samma yttre svar utan konto- eller
inbjudningsmetadata. Operatören kan se endast icke-hemlig status för sin
inbjudan i betrodd miljö och återkalla en ännu inte förbrukad kod.

## Migration, återställning och gränser

Migrationen lägger endast nya reservations-, issue-, redemption-, revocation-
och throttle-rader med FK/unikhetskontroller och immutable journaltriggers.
Rollback i drift är att stänga ny CLI-utfärdning och aktiveringsroute, inte
att droppa historia. Full återställning följer befintlig verifierad
PostgreSQL-backup; förlorade privata koder kan inte återskapas efter restore
och måste spärras/ersättas. Befintlig CLI-provisionering och login fungerar
fortsatt oberoende. Aktivering ändrar inte stationsappens offlinekö eller
den publika, kontofria resultatvyn.

Detta är **endast A3a**. Det löser inte självregistrering, e-postleverans,
verifierad kontaktväg, återställning, vårdnadshavarrelation eller mobilappens
egna session. Första ägarkontot kan fortfarande behöva betrodd provisionering.
Nästa separat beslut kan låta en OWNER bjuda in en medadministratör från UI
och koppla eventgranten vid accepterad inbjudan; ett annat snitt måste lösa
kontorecovery. Ingendera rättighet ska uppstå genom namnmatchning.

## Avvisade alternativ

- Skicka det CLI-genererade kontolösenordet till mottagaren som ordinarie
  onboarding: operatören känner då en återanvändbar autentiserare.
- Öppen självregistrering eller e-postlänk nu: kontaktbevis, leverans,
  missbruksspärr och återställningsgräns saknas och skulle bredda snittet.
- Återanvända B1:s anmälningskod eller `publicResultId`: båda har annan
  säkerhetsbetydelse; kontot får ingen anmälningsrätt vid aktivering.
- Automatisk ADMIN/OWNER-grant utifrån loginName, visningsnamn eller
  inbjudningsinnehav: dessa är inte ett behörigt eventbeslut.

Underlag: [kontoinbjudningsförstudien](../research/account-invitation-2026-09-23.md),
ADR-0144–0146 och TASK150–153.
