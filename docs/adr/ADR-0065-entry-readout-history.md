# ADR-0065: Deltagarbunden avläsningshistorik

- Status: Accepterad
- Datum: 2026-09-09

## Kontext

TASK024 ska leda från deltagarlistan till rätt historik. Befintlig discovery
väljer 50 readouts före identitetsuppslag. Klientfiltrering missar därför
avläsningar utanför laddade sidor. Bricknummer kan återanvändas och är inte
deltagaridentitet. Befintlig detalj använder första CARD_READOUT-revisionen;
discovery använder ingestutfallets revisions-id och kan sakna legacyidentitet.

## Beslut

En separat GET `/api/admin/races/{raceId}/entries/{entryId}/readouts` återanvänder
VIEW_READOUT_RESULT_HISTORY och dess cookies/privata no-store-gräns. Den
förändrar inte gamla discovery-/detaljkontrakt. Inga mutationsrättigheter ges.
Endpointparametrarna transporteras i behörigt API-anrop, inte browseradress,
query/hash eller beständig navigeringshint. Operativa HTTP-loggar måste
behandlas som privata och inte exponera dessa identifierare publikt.

Transaktion: befintlig protected-read-auth → race SHARE → entrykontroll inom
samma race → explicit sidprojektion, REPEATABLE READ och inga writes.
Okänd/annan-race entry ger 404 först efter auth, aldrig fabricerad tom person.

Filtrering sker i SQL före sidgränsen. För varje readout väljs första revision
för exakt race/readout och cause=CARD_READOUT, ORDER BY revision,id LIMIT 1.
Först därefter jämförs dess entry-id med vald deltagare. Entryvillkor inne i
första-revisionsuppslaget vore fel: en senare annan bindning kan då väljas.
Ingen aktuell eller historisk brickassignment används. Identitet i utdata
kommer från samma ursprungliga bindning; namn är aktuellt visningsnamn.

Separat strikt cursorformat binder typ/version, race, entry och seekparet
(serverReceivedAt,readoutId). Ofiltrerad/annan-entry/annan-race cursor avvisas.
Högst 50 rader per sida och keysetordning serverReceivedAt DESC/readoutId DESC
behålls. Ingen automatisk klientgenomsökning av alla racesidor. Ny ingest
syns vid explicit uppdatering enligt discoverymodellens befintliga begränsning.
Ny cursor bevarar PostgreSQL:s sex decimalsiffror för mottagningstid, även om
JavaScript Date bara har millisekunder. Seek jämför den bundna tidssträngen i
PostgreSQL, inte en avrundad Date. Gamla discoverycursorn ändras inte här.

Response har explicit entryidentitet även när listan är tom och en nästlad
validerad historiksida. Varje rad måste ha samma entry-id/visningsnamn och race.
Ogiltigt lagrat serverutfall får inte döljas eller fabriceras. Historikdetaljen
och dess revisionsvattenmärke fortsätter via befintlig endpoint.

Okänd readout utan ursprunglig CARD_READOUT-koppling tillskrivs inte deltagaren
enbart genom senare omräkning. Manuella resultat utan avläsning ingår inte i
denna discovery; UI ska förklara begränsningen, inte kalla detta all historik.

## Införande och acceptans

Ny projektion i application, nya strikta contracts och route samt UI inom samma
vertikala snitt. Ingen domänmotor, status, dependency eller mutation ändras.
Eventuellt indexbehov avgörs från SQL-plan/PG-prov; kräver additiv migration och
restore-not om index införs. Ingen index-/schemaändring beslutas i förväg.
Återgång stänger den nya routen/genvägen; gammal historik och data bevaras.

PG ska bevisa träff bakom 51 andra readouts, flera egna sidor, stabil bindning
efter brickbyte, ingen senare falsk bindning, cursor-scope, auth och noll writes.
Browser ska bevisa separat behörighet, tydlig tom sida, explicit vidare sidning
och att adressen inte innehåller deltagar-id. Ingen production/hårdvaruclaim
innan motsvarande acceptans genomförts.
