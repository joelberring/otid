# ADR-0066: Exakt tidsgräns i allmän historikcursor

- Status: Accepterad
- Datum: 2026-09-09

TASK024 visade verkliga mikrosekunder i server_received_at. Den allmänna
historiklistan använder Date både för cursor och seek och kan då hoppa över
avläsningar inom samma millisekund vid sidbyte.

Ny listcursor v2 bevarar sex decimaler från PostgreSQL och jämför exakt
timestamptz i SQL, som entrycursorn i ADR-0065. Race och readout-id förblir
bundna. Den separata detaljcursorn v1, revisionsvattenmärket, API-sidformaten,
sortering och behörigheter ändras inte.

Gammal listcursor v1 avvisas med invalid-request: förlorade decimaler kan inte
återskapas från token. Operatören väljer befintlig Uppdatera uttryckligen för
ny första sida. Ingen tyst fortsättning vid en förskjuten gräns, inga dubbla
kompatibilitetsregler. Server och klient behöver inte ny DTO; cursorn är opaque.

Ingen migration, indexändring, dependency eller datamutation. Återgång bör
inte återinföra precisionstappet; stäng hellre äldre-sidor temporärt vid
incident. Rådata och historik förblir bevarade.
