# ADR-0064: Deltagargenvägar utan utökad översiktsbehörighet

- Status: Accepterad
- Datum: 2026-09-09

ADR-0020 tillåter inte deltagaruppgifter under VIEW_RACE_OVERVIEW. Därför
leder översiktens befintliga startlistelänk till den gemensamma sökbara
deltagar-/startlistan under oförändrad VIEW_START_LIST (ADR-0042).
Ingen lista bäddas in under översiktens credential.

Varje rad kan öppna brickrättning och, endast vid FIXED, starttidsrättning.
Källan lämnar endast race-id, entry-id och målflöde som en engångshint i
webbflikens flyktiga modulminne. Inga namn, klubbar, bricknummer eller tider
kopieras. Ingen URL/query/hash, Web Storage, cookie eller serverlagring används.
Hård omladdning tappar hinten; då används vanlig deltagarsökning.

Målflödet konsumerar hinten en gång och validerar kanoniska id samt race/mål.
Den är aldrig autentisering eller mutationsintent. Först när målflödets egna
behöriga lista innehåller samma entry visas namn/klass och en uttrycklig
väljknapp. Saknad entry ger ingen förvald ersättare. Ett granskat/busy försök
kan inte ersättas av hinten. Request, versionsvillkor och granskning är orörda.
Källans gamla/osäkra underlag erbjuder inga genvägar.

Inga nya API:er, capabilities, migrations eller dependencies. Återgång tar
bort genvägarna; tidigare rättningsflöden och lagrad historik påverkas inte.
Begränsning: samma flik, mjuk navigering; ingen beständig återupptagning.

TASK023 tillämpar samma beslut på klassbyte (CHANGE_ENTRY_CLASS): hintval
visar exakt den deltagarens rad, med oförändrat målklassval/Byt klass-kommando.
Det ger ingen implicit klassändring eller utökad VIEW_START_LIST-behörighet.

TASK026 tillämpar samma flyktiga hint på namn-/klubbrättning. Destinationen
entry-identity kräver egen CHANGE_ENTRY_IDENTITY enligt ADR-0067 och explicit
val; startlistebehörigheten utökas inte. Ingen persondata kopieras i hinten.
