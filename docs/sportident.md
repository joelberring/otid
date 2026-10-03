# SPORTident i O-Tid

Avläsning sker med en avläsningsstation (BSM7/BSM8, SI-USB-läsare) i läget
**Readout** med **utökat protokoll** (extended protocol). Stationen kopplas in
via USB och läses i webbläsaren med Web Serial. Det fungerar i Chrome och Edge
på dator och i Chrome 148 eller senare på Android.

```text
Web Serial (device-transport) → ramar och protokoll (sportident) → bricka → normaliserad avläsning → resultatmotor (domain)
```

`packages/sportident` är ren TypeScript utan I/O:

- `FrameDecoder` tolkar bytes till ramar och klarar chunkgränser, skräp, fel
  CRC, saknad ETX och trunkering.
- `ReadoutSession` är en tillståndsmaskin. Värden skickar in mottagna bytes och
  tidsgränser och skriver ut de kommandon den returnerar. Den handskakar
  (direktläge och läsning av systemdata), upptäcker bricka, läser block,
  avkodar och kvitterar (pip).
- `decodeCard` och `normalizeCard` ger bricknummer, start, mål, check, clear
  och stämplingar med absoluta tider.
- `FakeSiStation` är en falsk station som pratar samma protokoll, för tester och
  för webbens utvecklingsläge.

Råa ramar från varje utläsning följer med händelsen `card-read` (`frames`) och
ska sparas oförändrade tillsammans med avläsningen.

## Avläsning i webbläsaren

Admin öppnar `/admin/<lopp>/readout` (länk "Öppna avläsning" i arbetsytan).
Adressen leder till ett statiskt appskal, `/readout/index.html#<lopp>`, som en
service worker cachar så att sidan startar även utan nät. Varje avläsning sparas
först i webbläsarens IndexedDB med råramarna, bedöms lokalt med samma
resultatmotor mot senast hämtade tävlingsunderlag och skickas sedan till
`POST /api/admin/races/<lopp>/administrator/readouts`. Kön raderas aldrig;
en post ändrar bara status när servern kvitterat den. Utgången adminsession
förnyas med kontoinloggningen. Knappen "Starta övningsstation" kör
`FakeSiStation` genom samma protokollkod, för övning och tester.

## Inställning av stationen

Ställ in med SPORTident Config+: läge *Readout*, *Extended protocol* på,
*Handshake* på (rekommenderat) och 38 400 baud. Äldre stationer kan bara
4 800 baud. Om stationen inte svarar på 38 400 ska värden försöka med 4 800.
Fel läge eller protokoll rapporteras som `station-misconfigured`.

## Tider

Brickorna lagrar 12-timmarstid. SI6 och nyare har dessutom AM/PM och veckodag.
`resolveSiTime` väljer den tolkning som ligger närmast före avläsningstiden,
med 10 minuters tolerans för att stationens klocka kan gå före datorns. Den
följer AM/PM och veckodag när de finns, och tävlingens tidszon (sommar- och
vintertid). Ett lopp kan därmed vara högst 12 timmar med SI5 och en vecka med
nyare brickor.

SI5 sparar stämpling 31–36 utan tid. De redovisas i `untimedPunchCodes` och
ingår inte i resultatbedömningen.

## Källor och licens

Implementationen är egen (ADR-0168). Underlaget är SPORTidents publika
dokumentation och öppna beskrivningar av protokollet. CRC:n är verifierad mot
publicerade ramar. Brickornas minneslayout är jämförd mot en oberoende öppen
avkodare, som bara användes vid utvecklingen och inte är kopierad in i
projektet. SPORTidents *PC Programmer's Guide* är begärd. När den kommer ska
implementationen stämmas av mot den.

## Stödmatris

Status: `untested` → `captured` (rådata från riktig station sparad) →
`decoded` (avkodning stämmer med fysisk bricka) → `field-verified` (provad
på tävling/träning).

| Bricka | Bricknummer | Läsning | Status |
|---|---|---|---|
| SI-Card 5 | 1–499 999 | `0xB1`, 1 block | untested |
| SI-Card 6 / 6* | 500 000–999 999, 16 711 680– | `0xE1 0x08`, block 0/6/7 | untested |
| SI-Card 8 | 2 000 000–2 999 999 | `0xEF` block 0, 1 | untested |
| SI-Card 9 | 1 000 000–1 999 999 | `0xEF` block 0, 1 | untested |
| pCard | 4 000 000–4 999 999 | `0xEF` block 0, 1 | untested |
| SI-Card 10 | 7 000 000–7 999 999 | `0xEF 0x08`, block 0/4–7 | untested |
| SIAC | 8 000 000–8 999 999 | `0xEF 0x08`, block 0/4–7 | untested |
| SI-Card 11 | 9 000 000–9 999 999 | `0xEF 0x08`, block 0/4–7 | untested |
| tCard, fCard | – | stöds inte | – |

| Station | Status |
|---|---|
| BSM7-USB | untested |
| BSM8-USB | untested |
| SI-USB-läsare | untested |
