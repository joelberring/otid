# TASK160: OWNER bjuder in ett nytt konto för senare ADMIN-tilldelning (A3b)

Status: avgränsad i ADR-0153 före kod och syntetiskt verifierad 2026-09-23.

## Användbart utfall

Eventägaren kan från ”Medadministratörer” skapa en engångskod för ett nytt
konto, lämna den privat till avsedd person, följa status och spärra koden.
Mottagaren aktiverar själv kontot i befintlig `/activate`. Först när ägaren
**separat** granskar och ger ADMIN med A2 kan mottagaren öppna eventet.
Det ska gå på mobil och dator utan att ge en kod eller ett namn implicit
eventbehörighet.

## Gör endast detta

1. Additiv migration 0083 med immutable koppling från A3a-issue/revocation
   till exakt event och actor; Drizzle-schema, migrationsjournal och
   rollback-/restore-not. Ingen gammal grant eller invitation skrivs om.
2. Strikta owner-issue/list/revoke-kontrakt och atomiska
   applicationtransaktioner som återanvänder A3a:s kodhash-/reservation-/
   spärrregler och A2:s aktuella OWNER-kontroll. Exakt retry är aktörs-
   och intentbunden. Ingen auto-grant i aktivering.
3. Smala HTTP-rutter med kontosession, Origin, CSRF, `no-store`, begränsad
   body och neutrala negativa svar. OWNER:s UI genererar kod lokalt,
   visar den endast i minnet för privat kopiering och kan efter omladdning
   bara se status/spärra/utfärda på nytt. Befintlig direkt-ADMIN-tilldelning
   för redan skapade konton finns kvar.
4. Riktade kontrakts-, isolerade PostgreSQL- och ett 390 px-browserflöde:
   OWNER issue → mottagaren aktiverar → kontot saknar ADMIN → OWNER ger
   uttryckligen ADMIN → mottagaren öppnar bara rätt event.

## Negativa acceptansfall

- ADMIN, annan events OWNER och anonym användare kan inte issue/list/revoke.
  Fel event-ID läcker inte namn, konto eller kod.
- Exakt request-retry ger samma ID; ändrad aktör/event/loginName/displayName/
  hash med samma request-id avvisas. Samtidiga olika issue för samma namn
  ger högst en aktiv inbjudan.
- Borttappad browserkod återhämtas aldrig från servern. Pending kan spärras;
  återförsök med samma revoke-intent är idempotent. Utgången/spärrad/
  förbrukad kod ger A3a:s neutrala aktiveringsfel.
- Ingen ADMIN- eller entry-grant skapas före eller av kontoaktiveringen;
  OWNER måste göra A2:s explicita tilldelning. A2:s spärr stoppar tidigare
  race-session på nästa request.
- Vyn på 390 px har inga horisontella scrolls, läsbara steg och tryckytor
  för handskar; kod eller lösenord hamnar inte i URL/Web Storage/testlogg.

## Ingår inte

E-post/SMS, verifierad personidentitet, publik självregistrering,
självtjänstrecovery (A3c), automatiska grants, OWNER-överföring,
anmälningskoppling, GPS, SPORTident, stafett eller produktionspilot.

Kör endast berörd lint/typecheck, riktade tester och build. PostgreSQL-
provet måste använda en uttryckligt vald isolerad migrerad testdatabas;
inga riktiga credentials eller tävlingsdata får användas. Redovisa exakta
resultat och kvarvarande antaganden. TASK160 är inte hela A3.

## Verifierat 2026-09-23

Migration 0083 kördes på en ny isolerad PostgreSQL17/PostGIS-instans.
Riktade kontrakts-/schema-/HTTP-/UI-prov: 4 filer och 13 tester gröna.
Applicationens syntetiska PostgreSQL-prov: 1/1 grönt, inklusive separat
ADMIN-grant efter kontoaktivering och idempotent spärr. Ett riktigt HTTP-/
PostgreSQL-browserflöde på 390 px: 1/1 grönt. Berörda paketens lint,
typecheck och build passerade med lokala binärer; Next-bygget krävde en
syntaktisk, avsiktligt okontaktbar byggtids-`DATABASE_URL`. Pnpm-wrappern
försökte nå registry och användes därför inte som grönt prov. Den tillfälliga
testinstansen och browserns underdatabaser togs bort efter kontrollen.

Inte verifierat: faktisk kodöverlämning till rätt person, fysisk mobil,
produktions-TLS/drift, verklig tävling eller recovery. Kontrakten tillåter
lista upp till 10 000 men applikationens avsiktligt snäva vy avvisar fler än
500 inbjudningar för ett event; en större arrangör kräver separat paginerings-
snitt. Samtidiga olika issue för samma login skyddas av A3a:s reservation
och eventlås men prövades inte som separat parallelltest i detta snitt.
