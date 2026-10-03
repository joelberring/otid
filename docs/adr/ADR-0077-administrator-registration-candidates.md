# ADR-0077: Dubblettvarning i gemensam direktanmälan

- Status: Accepterad
- Datum: 2026-09-12

TASK036 tillämpar ADR-0068:s redan beslutade kandidatsökning i TASK035:s
gemensamma administratörsvy. Kontrakt och ren matchningsfunktion återanvänds.
Application-läsningen använder REGISTER_ENTRY med skyddad lästransaktion och
CSRF, race SHARE och exakt snapshot. MANAGE_RACE har redan denna åtgärd enligt
ADR-0076. Ingen ny roll, migration eller skrivregel införs.

POST /api/admin/races/{raceId}/administrator/registration-candidates är en
skrivfri privat sökning med admincookies, Origin/CSRF, auth före4KiB-body och
strikt svarsscope. Inga namn i URL/loggar. Alla entries upp till10000 valideras
mot samma race/klass; trasig relation eller övergräns får aldrig ge partiell
lista. Historiskt brickägarskap, även inaktivt, kontrolleras. Exakt totalantal
och högst20 träffar enligt ADR-0068; inga extra person- eller resultatfält.

Granska anmälan fryser hela registreringsintentet, söker i samma gemensamma
klientoperation och visar före/efterpanelen först med giltigt scope/snapshot.
Panelen visar kandidater och orsaker. Namnträff kräver uttrycklig checkbox
att anmäla en annan person. Brickträff spärrar ny anmälan; den kan inte
åsidosättas. Operatören kan lämna oskickad granskning och välja en befintlig
träff i samma arbetsvy. Val ger inte automatisk överföring av utkastets data.

Ändrat formulär eller nytt underlag kräver ny granskning/sökning. Fel är inte
noll träffar. När POST-registrering redan skickats och svar saknas måste
befintlig exakt retry fungera utan omsökning eller ny checkbox; egna nyss
skapade entryn får inte blockera återförsöket. Ingen beständig lokal kö eller
automatisk personsammanslagning. Serverregistreringens CAS/kort/platsregler
förblir auktoritativa. API kan fortsatt skapa skilda personer med samma namn.

Acceptans: riktig PG med normaliserat samma namn, annan klass/klubb, historisk
bricka, stale/auth/trasig relation och läsning utan writes; HTTP scope/body;
browser namncheckbox, brickspärr, välj befintlig och retry utan ny sökning.
Riktad lint/typecheck/test/build och desktop/mobil. Endast syntetisk testdata.

TASK028:s separata begränsade operatörs-HTTP/UI aktiveras inte av detta snitt;
den gemensamma tjänsten är återanvändbar där senare. Ingen dependency,
teknikändring, extern källa/licens eller resultat-/hårdvaruändring.
