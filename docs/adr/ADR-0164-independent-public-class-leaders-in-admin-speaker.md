# ADR-0164: separat publik klassledarbild i administratörens speakerläge

Status: accepterad för TASK216, 2026-09-27. Skriven före implementation.

## Kontext

ADR-0058:s privata speakerfeed visar högst 25 senast registrerade publicerade
resultatunderlag. Den är varken full klasskohort eller målgångsordning. Att
beräkna en ledare eller tid efter ledaren från den vore fel. En komplett
privat beräkning vid feedens femsekunderspollning skulle behöva lösa alla
historiska resultat och beslut i ett lopp; den lasten är inte mätt eller
fältaccepterad. Den befintliga publika resultatprojektionen räknar redan
klassplacering med `rankClassResults` efter serverns effektiva, publicerade
historiska resultat och spärrar blandade banversioner.

## Beslut

Administratörens inbäddade speakerflik får en **separat, användarstyrd**
klassledarbild från loppets befintliga publika resultat-GET. Den hämtas först
vid uttryckligt tryck på ”Visa klassledare” och uppdateras endast på begäran.
Inga nya privata rättigheter, resultatberäkningar, routes eller databasskrivare
införs. Svaret måste valideras som aktuellt publikt format 7; annat format,
fel eller timeout ger ett begripligt fel utan påhittad ledare. Endast
`RANKED`/`OK` med `position === 1` och `timeBehindMs === 0` visas. Delad
förstaplats visar båda. Tiderna är publicerade **sluttider**, inte passage-
eller radiotider. Vid blandade banversioner eller utan godkänd sluttid finns
ingen säker klassledare att visa.

Panelen visar när webbläsaren tog emot svaret och upplyser om att publik
HTTP-cache kan göra det några sekunder äldre. Den har egen fel-/inaktuell-
markering. Feedens serverläsningstid och panelens mottagningstid får inte
likställas. Publika ledarrader kopplas **inte** till de 25 privata feedraderna
via namn, klubb, klass eller tillfälligt slotnummer. De två svaren kan avse
olika tidpunkter, och identiska visningsnamn är möjliga. Ingen signalfärg
sätts därför på en feedrads sluttid. Ledarpanelens textetikett och diskreta
signalaccent gäller bara dess uttryckligen rankade rader.

Svaret behålls enbart i komponentminne, rensas vid loppbyte och vid
administratörens sessionsfel, och läggs inte i lokal beständighet. Mobil får
en läsbar, kompakt rad per ledare; större skärmar en tät tabell utan nya stora
kort. Separat `VIEW_SPEAKER_BOARD`-vy ändras inte i detta snitt.

## Konsekvenser och senare väg

Detta är en korrekt men manuell ögonblicksbild över **publika** klassledare,
inte live- eller fullständigt speakerläge. Publicering, manuella beslut och
den publika projektionens befintliga tak styr täckningen. En framtida
automatiskt uppdaterad privat ledar-/passagefeed kräver ett eget mätt och
versionsbundet läskontrakt med komplett klasskohort, samma snapshot för
ledare och händelser, samt last-/återanslutningsacceptans. Den får inte
smygas in i ADR-0058:s 25-raderspollning.

Ingen migration eller rollback av data behövs; UI-delen kan tas bort utan
historikändring. Riktad klientlogik, lint/typecheck/build och ett syntetiskt
browserfall räcker för detta läsande snitt. Utan isolerad PostgreSQL görs
inget påstående om ny server- eller prestandaacceptans.
