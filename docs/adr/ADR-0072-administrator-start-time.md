# ADR-0072: Starttidsrättning i gemensam administratörsvy

- Status: Accepterad
- Datum: 2026-09-12
- Uppgift: TASK031

CHANGE_ENTRY_START_TIME ansluts uttryckligen till MANAGE_RACE enligt ADR-0069.
Befintlig tjänst, kontrakt och immutable journal återanvänds. FK stödjer redan
administratörens credential; audit anger verklig RACE_ADMIN_ACCESS_CREDENTIAL
eller den gamla begränsade aktören. Ingen migration eller ny teknik behövs.

Reglerna i ADR-0039/0063 bevaras: endast FIXED, nullable gammal tid men ny
explicit offsetbunden tid krävs. Klass, startregel, rådata och resultat ändras
inte. Ingen borttagning till null, ingen tidsluckereservation eller automatisk
omräkning. Version/snapshot ökar en gång och exakt historiskt retry är
aktörsbundet, före kontroll av dagens tillstånd.

Tidskontraktet har högst millisekundprecision. SQL-kontroll ska avvisa finare
lagrad precision i läsunderlag, aktuell entry inför write samt journalens
tidigare/nya tid inför retry. JavaScript Date får inte tyst avrunda det som
jämförs eller kvitteras. Giltig historisk kvittens får fortfarande återges
även om dagens entry senare har en finare tidsstämpel. Ingen historik rättas
automatiskt; listfel/konflikt kräver separat avsiktlig hantering.

Ny PATCH /administrator/entries/{entryId}/start-time använder samma admincookie,
rollkontroll före body, Origin/CSRF och 4KiB-gräns som övriga adminmutationer.
Kvittensen binds till hela normaliserade intentet: race/entry/klass/request,
gamla/nya tiden och båda tidigare versioner; kontraktet kontrollerar ökningar.

Arbetsvyn har en deltagare och en åtgärdsväljare: Klassbyte, Brickbyte, Starttid.
Endast aktuellt formulär visas för att minska scroll. Alla delar delar session,
avbrutna anrop och ett enda pendingintent (inklusive kapacitet). Byte av vy
får rensa osparade fält men aldrig ett skickat okänt intent. Fryst starttids-
granskning behåller tävlingszonen enligt ADR-0063. Ingen ny beständig klientkö.

Vid incident stäng den nya routen/rollåtgärden; bevara journal och tidigare
begränsade flöden. Riktad PG-regression täcker roller, precision, exakt retry
och oförändrad klass/resultat. Browser provar hela gemensamma arbetskedjan i
två bredder och att PUNCH inte erbjuder skrivning. Inga externa källor,
dependencies, verkliga tävlingar eller hårdvarupåståenden ingår.
