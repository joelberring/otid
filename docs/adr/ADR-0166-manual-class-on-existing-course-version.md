# ADR-0166: manuell klass på befintlig banversion

- Status: Accepterad för TASK300
- Datum: 2026-10-03

## Kontext

ADR-0103/TASK081 skapar en ny bana och klass atomiskt. Den interna Class-
modellen kan redan dela CourseVersion med andra klasser, men manuell
administration saknar en skrivväg för detta. Att skapa en kopia av samma
kontrollföljd för varje klass gör tävlingsupplägget onödigt svårt att överblicka.
IOF-import och förkortad bana är andra arbetsflöden, inte ersättningar.

## Beslut

Inför en explicit racebunden MANAGE_RACE-mutation som endast skapar en ny
manuell klass kopplad till en exakt befintlig CourseVersion i samma lopp.
Ingen bana, banversion, kontroll eller kontrollföljd skapas/kopieras/ändras.
ADR-0103:s befintliga atomiska ny-bana-flöde behålls oförändrat.

Request: formatVersion1, requestId, expectedSnapshotVersion, courseVersionId,
className och explicit startRule FIXED/PUNCH. Namn trimmas till1–160 tecken;
UUID och version följer befintliga kontrakt. Namn är aldrig identitet och
likalydande namn är inte en implicit retry. Ingen "senaste" banversion härleds.

Klassen får externalSource/externalId NULL, maxEntries NULL och
capacityVersion1. FIXED skapar inte starttider; PUNCH betyder den befintliga
regeln för startstämpling. Inga deltagare, resultat eller publiceringar ändras.
En ny klass ändrar roster/snapshot; frysta officiella resultat förblir historik
och får inte utvidgas automatiskt.

Både manuella och adaptermappade banversioner kan väljas, förutsatt att deras
interna Course tillhör samma race och kontrollföljden är giltig/icke tom.
Kontrollordning och upprepade koder lämnas orörda. Externa ID:n används inte.

## Samtidighet, kvittens och journal

Återanvänd autentisering/CSRF och låsordning från TASK081: session/credential,
race FOR UPDATE, requestbundet advisory lock. Kontrollera immutable journal
före aktuell snapshot. Samma request/race/aktör/normaliserade intent returnerar
originalkvittensen även efter senare snapshotändring; ändrat intent/aktör/race
är konflikt. Stale ny request eller fel race/banversion ger ingen delwrite.

Efter målvalidering skapas klass, race.snapshotVersion höjs exakt ett steg,
och journal/audit sparas i samma transaktion. Kvittensen fryser request,
classId, courseId/courseVersionId, bana/version som visningsdata, snapshot
före/efter och createdAt. Retry returnerar originalet, inte muterade namn.

Ny additiv manual_class_create_request-journal med scope-FK, MANAGE_RACE-
villkor och update/delete-barriär. Ändra inte gamla journalers form eller
banversionsbarriärer. Använd samma interna auditaktör som TASK081.

## UI och implementation

I Före → Klasser används ett kompakt initialt stängt formulär: klassnamn,
exakt banversionsval och startregel. Första målurvalet återanvänder redan
lästa banversioner från klassunderlaget, deduplicerade med ID, inte namn.
Likalydande mål får tydlig ordningsetikett. Saknat mål får väg till befintligt
ny-bana-flöde; ingen dold bankopia. Inga historiska versioner väljs automatiskt.

Granska före explicit bekräftelse. Frys samma request vid okänt HTTP-svar;
ny klickning får inte skapa ett nytt requestId förrän utfallet är klarlagt.
Sessionfel/spärr och parentens pågående skrivlås ska gälla även detta flöde.
Neutral typografi, tunna avgränsningar och44 px tryckytor på mobil.

Resultatlogik förblir i domain/application, inte React eller SQL. Inget nytt
teknikval, beroende, AGPL-material eller externa anrop behövs.

## Migration och återställning

Vid incident stäng skrivroute/UI. Befolkad journal raderas inte; rättning sker
framåt. Additiv migration och återställningsnot ska ingå före aktivering.
Verifiera PostgreSQL-beteende i ny isolerad syntetisk databas, inte demo/race.
Kontrollera att full DB-backup inkluderar nya tabellen och att eventuella
schema-/restore-allowlists inte lämnar journalen utanför.

## Ingår inte

Klassnamnsredigering, bulkupplägg, byte av befintlig klassbana, historisk
versionsväljare i UI, kapacitetsändring, lottning, importpolicy, stafett,
gaffling, GPS, SPORTident eller offlineadministration av tävlingsupplägget.
