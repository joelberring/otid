# ADR-0063: Tävlingszon vid starttidsrättning

- Status: Accepterad
- Datum: 2026-09-09

Starttidsadministrationens behöriga listkontrakt får obligatoriskt `timeZone`,
validerat med Intl som befintlig startlista. Applikationen hämtar eventets zon
via låst race i samma lästransaktion. Saknad/ogiltig zon avvisas, aldrig
fallback till enhetens zon. Server och webb driftsätts tillsammans; äldre
strikta klienter kräver omladdning, inte tyst nedgradering.

Vyn återanvänder startlistans formatterare för datum, sekunder, eventuell
millisekund och numerisk offset. Granskat försök fryser visningszonen i minnet
med sitt redan frysta intent, så reauth/omläsning inte byter dess presentation.
Zonen är presentationsmetadata, inte ett nytt mutationsfält. Begäran och
journal behåller kanonisk UTC. Inmatning kräver fortfarande explicit offset
enligt ADR-0039; ingen gissning av sommartid eller lokal väggtid införs.

Ingen migration, dependency, ny startregel eller automatisk omräkning.
Återställning sker genom samordnad återgång av server och klient; journaler
och lagrade tider är opåverkade. Ingen extern kod används.
