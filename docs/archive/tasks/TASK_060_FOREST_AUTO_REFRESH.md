# TASK060: valbar automatisk uppdatering av kvar-i-skogen

Status: implementerad 2026-09-12 enligt ADR-0095; riktad acceptans passerad.

Lägg en checkbox i befintlig adminrapport. När vald, hämta senaste rapport
var15 sekund medan rapporten är öppen och användaren inte arbetar med en
begäran, granskning, journal eller fältredigering. Manuell uppdatering behålls.
Inget ska störa exakta retries eller få gammalt underlag att se färskt ut.

Berör web UI/i18n och en liten deterministisk behörighetskontroll för tick.
Ingen ändring i domain, contracts, application eller databas.

Riktad acceptans: ett enhetsprov för alla pausvillkor och ett browserfall
med styrd klocka för uppdatering, paus under granskning, nätfel/gammaldata,
avstängning och logout. Återanvänd befintlig isolerad browsermiljö; ingen
ytterligare databasmatris. Web lint/typecheck/build.

Utfall: valbar checkbox, avstängd från början och återställd vid logout.
Timer återstartas efter render/inaktivitet, läser DOM-synlighet/fokus och
gemensamma pending/busy-refs. Öppen journal pausar läsningen. Samma GET,
felhantering och gammalmarkering som manuell uppdatering används.

Ett enhetsprov passerade (186ms), ett browserfall med styrd klocka passerade
(7,0s). Web lint/typecheck/build och browserns TS/ESLint exit0. Browsern
verifierar uppdatering, paus under granskning, nätfel, avstängning och logout.
Övriga pausvillkor täcks av enhetsprovet och kodkopplingen, inte separata
browserfall. Ingen verklig mobilbakgrundskörning eller produktion verifierad.
