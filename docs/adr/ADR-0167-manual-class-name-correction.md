# ADR-0167: rätta manuell klassrubrik utan identitetsbyte

- Status: Accepterad för TASK301
- Datum: 2026-10-03

## Kontext och beslut

TASK081/300 skapar manuella klasser med null extern identitet. Klassnamn är
visningsdata, inte identifierare. Administratören ska kunna rätta ett sådant
namn i den valda klassens befintliga inställningsyta, utan ny klass/bana.

Inför en MANAGE_RACE-läsning och mutation för exakt race/class-ID. Endast
klasser med både externalSource och externalId NULL får ändras. En manuell
klass på en importerad bana är fortsatt manuell. Importerade eller inkonsistent
externidentifierade klasser visas som ej rättningsbara här; ändra inte
IOF-importens ägarskap som en dold bieffekt. En framtida importerad rättning
behöver en explicit policy för omimport, inte matchning via namn.

Skyddad GET ger formatVersion1, raceId, classId, snapshotVersion, className,
courseVersionId och editable. HTTP-kontrakt valideras; externa ID:n behövs
inte i browsern. POST-intent är formatVersion1, requestId,
expectedSnapshotVersion, expectedClassName och className. Klass-ID kommer
från routen. Nytt namn trimmas till1–160 tecken; ingen ändring avvisas.
Förväntat namn är den exakta lästa strängen, inte en namnmatchad klass.

## Transaktion och historik

Återanvänd session/credential→race-lås och requestbundet advisory lock från
TASK300. Immutable journal kontrolleras före aktuell snapshot/name/eligibility.
Exakt retry binds till race, klass, aktör och normaliserat intent och ger
originalkvittens. Ändrat mål/aktör/intent eller stale ny request ger konflikt.

Uppdatera bara Class.name och höj race.snapshotVersion ett steg. Bevara
Class.id, CourseVersion, startregel, kapacitetsversion, extern identitet,
entries, starttider och resultatrevisioner. Återanvänd inte capacityVersion
för annan metadata. Journal/audit sparas i samma transaktion; ny additiv
migration0086 med immutable request/response och racebunden klass-/aktörs-FK.
Kvittens fryser request, classId/courseVersionId, föregående/nytt klassnamn,
snapshot före/efter och changedAt; replayflagga är uttrycklig.

Aktuella roster/resultat/historikvyer som redan slår upp klassens nuvarande
namn visar det nya namnet. Detta ändrar inte den historiska klassidentiteten
och gör inte tidigare transferhistorik till ett namn-snapshot (ADR-0078).
Publicerade startlistor och frysta finaliseringar använder fortsatt sina
lagrade visningsfält. Nytt underlag får annan snapshot/bas och kräver explicit
ompublicering/finalisering; inga gamla bytes skrivs om. Befintlig konservativ
markering av äldre resultatsnapshot kvarstår, ingen automatisk omräkning.

## UI, verifiering och återställning

Ett initialt stängt, tunt inlineområde i Före→Klasser använder exakt vald
klassrad. Läs eligibility före granskning; tydlig neutral text om importägda
klasser. Granska före explicit POST. Okänt utfall fryser samma begäran; parent
och namnfält låses. Lyckad kvittens återläser underlaget, inte nytt POST vid
misslyckad återläsning. Neutral gemensam typografi, inga nya stora kort eller
beroenden. Layout anpassas till mobil/dator med44 px åtgärder.

Utöka TASK081:s befintliga PostgreSQL-prov och TASK227:s enda syntetiska
browserfall. PG provar namnbyte/retry/stale/extern spärr och oförändrade
relationer. Browser provar granskning/ett lyckat namnbyte/återläst ID vid
390/1280 px; undvik dubblerad stor retriesvit. Små kontrakt-/routekontroller.

Vid återgång stäng skrivvägen. Radera aldrig en befolkad journal; rätta framåt
eller återställ verifierad full PostgreSQL-backup inklusive nya journalen.
Ingen migrering av manuell demo, produktionsaktivering, importerad namnpolicy,
bulkeditor, stafett, gaffling, GPS eller SPORTident ingår.

Domängränser och teknikval är oförändrade. Ingen resultatlogik i React/SQL.
