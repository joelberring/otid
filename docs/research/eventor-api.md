# Eventor Sverige/Testeventor – primärkällor

Granskat 2026-09-04 för TASK 006V. Inga autentiserade anrop, verkliga nycklar,
AGPL-källor eller tredjepartsimplementationer användes.

## Källor

- https://eventor.orientering.se/api/documentation
- https://eventor.orientering.se/api/schema
- https://eventor-sweden-test.orientering.se/api/schema
- https://eventor.orientering.se/faq?culture=en-GB
- https://eventor.orientering.se/Documents/Guide_Eventor_-_Get_data_via_API.pdf

## Verifierat underlag

Officiell FAQ pekar ut Testeventor på eventor-sweden-test.orientering.se.
Guiden anger en klubbnyckel med 32 tecken, skickad i HTTP-headern ApiKey.
GET /api/event/{eventId} returnerar Event; EventId hämtas från events-listan.
API använder Eventors egen modell, inte automatiskt IOF 3.0 EntryList.

Event har EventId, Name, klassificerings-/statusval och StartDate (Date,
valfri Clock). FinishDate och upprepade EventRace är valfria. EventRace har
EventRaceId, EventId eller Event-referens, Name, RaceDate (Date/valfri Clock),
statusval och enligt XSD WRSInfo. WRSInfo behövs inte i O-Tids minimala
projektion och dess faktiska förekomst behöver kontrolleras mot verkligt svar.

Ingen tidszon eller dokumenterad offsetkonvention hittades i Date/Clock.
O-Tid får inte härleda en startinstant från dessa fält utan egen explicit
policy. EventId och EventRaceId är olika externa identiteter. Ett flerloppsevent
får inte reduceras till första loppet utan användarens val.

## Avgränsning och osäkerhet

Offentliga API-/schemaresurser kunde läsas utan nyckel i underagentens audit.
Huvudagentens webbläsverktyg fick 403 på vissa officiella URL:er; dessa är inte
bevis för att autentiserad API-drift fungerar. Ingen liveimport har verifierats.
XSD:n har elementFormDefault=qualified men ingen targetNamespace: Event och
EventRace ligger i ingen namnrymd. EventId och EventRaceId är mixed text utan
numerisk typ eller längdregel; de bevaras som opaka externa textvärden.
Date/Clock är också text, med defaultformat YYYY-MM-DD respektive HH:MM:SS,
inte xs:date/xs:time. Event-svaret har direkta EventRace-barn, ingen
EventRaceList-wrapper. Egna fixtures får inte
presenteras som inspelade verkliga Eventorsvar.

Fast tillåten HTTPS-origin (inte certifikatpinning), nej till redirects, timeout, svarsstorlek,
nyckelkryptering och loggredigering är O-Tid-policy, inte påstådda API-krav.
