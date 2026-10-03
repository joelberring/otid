# ADR-0078: Läsning av journalförda deltagarändringar

Status: Accepterad. Datum: 2026-09-12. TASK039.

Gemensam MANAGE_RACE får en explicit read-only deltagarhistorik utan ny roll
eller inloggning. En applicationprojektion läser entry_class_change_request,
entry_transfer_request, entry_card_change_request, entry_start_time_change_request,
entry_identity_change_request och entry_registration_request. Resultatrevisioner,
lottning, import och avprickning ingår inte; UI anger avgränsningen, och ett
tomt svar betyder bara att dessa journaler saknar poster. Historik rekonstrueras
aldrig från nuvarande deltagarvärden.

Autentisering sker med protected read, REPEATABLE READ och race SHARE, sedan
kontrolleras entry i samma race. Varje källfråga är race/entry-bunden och hämtar
högst21 poster före given deltagarversion. Resultatet sorteras efter
entryVersionAfter fallande och returnerar20 med nextBeforeVersion. Registrering
har entryVersionAfter1; övriga journaler måste öka entry/snapshot exaktett.
Dubbla deltagarversioner över källor, orimliga framtida versioner, felklass-
relationer eller ogiltiga lagrade intents ger fel, aldrig fabricerad historik.
Sidgränsen är exklusiv positiv deltagarversion, inte offset; nya ändringar kan
visas genom explicit uppdatering från början utan att flytta gamla sidgränser.

Svar binder raceId/entryId, nuvarande entryVersion/snapshotVersion, generatedAt
och tävlingens tidszon. Poster har kind/requestId/changedAt/versioner och
typade fält (CLASS, START_TIME, CARD, GIVEN_NAME, FAMILY_NAME, ORGANISATION)
med före/efter. Klassnamn är aktuella uppslag av journalens klass-ID, vilket
anges i UI; namn/klubb/brickor/tider kommer från journalens frysta värden.
Ingen aktörscredential, rådata eller API-hemlighet exponeras. Starttidsvärden
bevarar millisekundprecision; finare lagrad starttid får inte tyst avrundas.
Journalens ändringstid serialiseras däremot med PostgreSQL:s mikrosekunder,
så normala defaultNow-tidsstämplar inte orsakar en onödig historikspärr.

GET /administrator/entries/:entryId/changes tillåter endast valfri
beforeVersion (positiv int32);20 är fast sidstorlek. Strict kontrakt/no-store
och faktisk MANAGE_RACE-preflight gäller. Ingen cookie-fallback till äldre
funktionsroller. UI begär explicit sida, validerar scope och cursorgräns och
raderar gammal sidvy innan läsning. Auth/logout/entrybyte aborterar och rensar;
sent svar kan inte återöppna historik. Ingen beständig browserlagring.

Ingen migration, ny dependency, resultatregel eller licensåteranvändning.
Återställning är att stänga den nya läsvägen; historiska journaler ändras inte.
