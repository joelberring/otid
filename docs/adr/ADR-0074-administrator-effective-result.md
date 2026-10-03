# ADR-0074: Gällande resultat vid vald deltagare

- Status: Accepterad
- Datum: 2026-09-12
- Uppgift: TASK033

Ny enskild-entry-läsning kräver exakt MANAGE_RACE och använder central
resolveStoredResultHeadStates samt parseStrictStoredResultRevision. Senaste
PUBLICERADE revision väljs, inte omräkningslistans absoluta revisionshuvud.
Repeatable-read och race SHARE binder entry, resultat och beslutshistorik.
Ingen ny resultatregel, rollåtgärd, migration eller publik endpoint behövs.

Tre lägen skiljs åt: NO_PUBLISHED_RESULT, NO_ACTIVE_RESULT efter återtagande
och ACTIVE_RESULT. Aktivt svar visar effektiv status/orsak/tid, resultatets
historiska klass och snapshot, senaste valda publicerade revisionsnummer samt
nuvarande entryklass/version/snapshot. Historiskt klassbyte får inte märka om
ett gammalt resultat till den nya klassen. Ingen ranking härleds för en entry.

governingDecision är NONE, DNS, CHECKIN_DNS, DSQ, APPROVAL, DNF, OOC eller NT.
Den anger endast det beslut som styr det resolverade resultatet, inte hela
beslutshistoriken. Resolvern förbjuder samtidiga aktiva overlays. Avpricknings-
DNS särskiljs från manuellt DNS. Återtagna beslut anges aldrig som aktiva.
Konflikt/ogiltig provenance ger fel, inte fabricerat resultat. NT/DNS/DNF
visar ingen löptid. Befintligt speakerresultatkontrakt återanvänds för statuspar.

GET /administrator/entries/{entryId}/effective-result använder samma privata
cookiegräns och no-store. Svaret innehåller inga rådata, credentials eller
beslutspayloads. En liten remsa vid deltagarval visar gällande resultat,
eventuellt styrande beslut och lästid. Den är senast lästa serverkunskap,
inte en automatisk livebevakning eller slutlig finalisering.

Läsning sker inom arbetsvyns befintliga abortbara operation vid val och efter
bekräftad mutation. Scope/entryversion/klass/snapshot binds före visning.
Vid nytt försök, byte, logout eller läsfel döljs gammalt underlag; läsfel får
inte ersätta en lyckad mutationskvittens. Okänd mutation får aldrig kvitteras
utifrån sammanfattningen. Inget nytt beständigt lager eller polling införs.

Återställning: stäng nya läsrouten/vyn; historik är orörd. Acceptans: PG för
ingen/aktiv/återtagen och DSQ över ny teknisk revision, historisk klass,
scope/auktorisering; browser visar resultat efter omräkning i samma session.
Riktad lint/typecheck/test/build, inga verkliga tävlingar eller dependencies.
