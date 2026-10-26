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
  (direktläge, läsning av systemdata och stationens klocka med `GET_TIME`),
  upptäcker bricka, läser block, avkodar och kvitterar (pip). En bricka som
  sitter i stationen när handskakningen börjar läses så snart den är klar.
  Svarar stationen inte på `GET_TIME` fortsätter sessionen utan klocka.
- `decodeCard` och `normalizeCard` ger bricknummer, start, mål, check, clear
  och stämplingar med absoluta tider.
- `FakeSiStation` är en falsk station som pratar samma protokoll, för tester och
  för webbens utvecklingsläge.

Råa ramar från varje utläsning följer med händelsen `card-read` (`frames`) och
ska sparas oförändrade tillsammans med avläsningen.

## Snabb utläsning (steg 53)

SI6 och SI10/11/SIAC läses block för block: block 0 först, sedan bara blocken som har stämplingar (32 per block). SI10 och
SI11 läser block 0, 4, 5 …; SIAC läser block 0, 1, 4, 5 … (block 1 som MeOS, för SIAC i beacon-läge); SI6 block 0, 6, 7.
En bricka med 20 stämplingar ger alltså två svar (SIAC tre) i stället för fem eller åtta. SI5 och SI8/SI9/pCard läses som
förut. Underlag: `docs/research/sportident-protocol-source-gate.md`.

- **Reserv:** svarar stationen NAK, med fel block, inte alls (tidsgräns), med block 0 från en annan bricka eller med block
  som inte går ihop med block 0 (en stämpling inom antalet är tom), läses samma bricka direkt med "alla block" som före
  steg 53 (`fast-read-fallback`). Avläsningen sparar då bara detekteringen och "alla block"-svaren, så att omläsning från
  rådata ger samma bild. Togs brickan ur mitt i läsningen blir det en misslyckad avläsning som förut.
- **Samma resultat:** blocken som läses är byte för byte desamma som i "alla block", och minnesbilden är början av samma
  bild. Räknaren begränsas till brickans största antal (128, SI6 64) precis som avkodningen gör.
- **Inställning:** avläsningssidan, under felsökningsloggen: "Snabb utläsning av SI10/11/SIAC" (på som förval, sparas i
  webbläsaren; gäller även SI6). Av = "alla block" för alla brickor. Utan handskakning läses alltid som förut.
- **Felsökningsloggen** (`notes`) skriver stationens inställningar vid anslutning (blockinställningen på systemvärde
  `0x33`, handskakning, hastighet), och för varje bricka utläsningssätt, antal svar och millisekunder, samt varför den
  snabba utläsningen gav upp.

| Bricka, stämplingar | Före: svar | Före: byte | Efter: svar | Efter: byte | 38 400 baud före → efter | 4 800 baud före → efter |
|---|---|---|---|---|---|---|
| SIAC, 0 | 5 / 8 | 694 / 1 105 | 2 | 291 | 181 / 288 → 76 ms | 1,4 / 2,3 → 0,6 s |
| SIAC, 1–32 | 5 / 8 | 694 / 1 105 | 3 | 436 | 181 / 288 → 114 ms | 1,4 / 2,3 → 0,9 s |
| SIAC, 33–64 | 5 / 8 | 694 / 1 105 | 4 | 581 | 181 / 288 → 151 ms | 1,4 / 2,3 → 1,2 s |
| SIAC, 97–128 | 5 / 8 | 694 / 1 105 | 6 | 871 | 181 / 288 → 227 ms | 1,4 / 2,3 → 1,8 s |
| SI10/SI11, 1–32 | 5 / 8 | 694 / 1 105 | 2 | 291 | 181 / 288 → 76 ms | 1,4 / 2,3 → 0,6 s |
| SI10/SI11, 33–64 | 5 / 8 | 694 / 1 105 | 3 | 436 | 181 / 288 → 114 ms | 1,4 / 2,3 → 0,9 s |
| SI10/SI11, 97–128 | 5 / 8 | 694 / 1 105 | 5 | 726 | 181 / 288 → 189 ms | 1,4 / 2,3 → 1,5 s |
| SI6, 1–32 | 3 / 8 | 420 / 1 105 | 2 | 291 | 109 / 288 → 76 ms | 0,9 / 2,3 → 0,6 s |
| SI6, 33–64 | 3 / 8 | 420 / 1 105 | 3 | 436 | 109 / 288 → 114 ms | 0,9 / 2,3 → 0,9 s |
| SI8/SI9 (oförändrat) | 2 | 291 | 2 | 291 | 76 ms | 0,6 s |

"5 / 8": stationen skickar datablocken respektive alla åtta. Byte = kommandon (8 byte) + svar (137 byte per block) +
kvittens, räknat i `packages/sportident/test/fast-read.test.ts`. Tiden är bara överföringen (10 bitar per byte). Till det
kommer stationens tid att läsa varje block ur brickan och fördröjningen per kommando, som inte går att mäta utan riktig
station; snabb utläsning har ett kommando per block i stället för ett för alla.

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

**Rålogg:** knappen "Ladda ner rålogg" på avläsningssidan ger en JSON-fil med
all trafik till och från stationen sedan sidan öppnades (tid, riktning, hex)
och råramarna för loppets avläsningar. Filen innehåller bricknummer men inga
namn. Den används i steg 7 för att rätta avvikelser och blir testfixtures.

## Mac: drivrutin för stationen

En SPORTident-station med USB (BSM7/BSM8-USB) har en USB-seriell krets från Silicon Labs (CP210x). macOS visar den
som *SPORTident USB to UART Bridge Controller* (USB-id `0x10c4:0x800a`) men skapar ingen serieport utan drivrutin.

1. Hämta *CP210x VCP Mac OSX Driver* från Silicon Labs (silabs.com → Developers → USB to UART Bridge VCP Drivers) och
   installera den.
2. Tillåt drivrutinen: *Systeminställningar → Allmänt → Inloggningsobjekt och tillägg → Drivrutinstillägg* (slå på
   Silicon Labs). På äldre macOS: *Systeminställningar → Integritet och säkerhet*, "Tillåt" vid meddelandet om blockerad
   systemprogramvara från Silicon Laboratories. Starta om datorn om porten inte syns.
3. Kontrollera porten i Terminal: `ls /dev/cu.*` ska visa `cu.SLAB_USBtoUART` eller `cu.usbserial-…` när stationen sitter i.
   `cu.Bluetooth-Incoming-Port` och `cu.debug-console` finns på alla Mac och är **inte** stationen.
4. I Chrome eller Edge: "Anslut station" och välj porten med Silicon Labs/CP210x i namnet.

Windows hämtar drivrutinen själv i regel; Linux har den i kärnan (`/dev/ttyUSB0`, användaren behöver gruppen `dialout`).

## Inställning av stationen

Ställ in med SPORTident Config+: läge *Readout*, *Extended protocol* på,
*Handshake* på (rekommenderat) och 38 400 baud. Äldre stationer kan bara
4 800 baud. Om stationen inte svarar på 38 400 ska värden försöka med 4 800.
Fel läge eller protokoll rapporteras som `station-misconfigured`.

## Tider

Brickorna lagrar 12-timmarstid. SI6 och nyare har dessutom AM/PM och veckodag.
`resolveSiTime` väljer den tolkning som ligger närmast före referensen, med
två timmars tolerans för att en kontrollenhets klocka kan gå före. Referensen
är avläsningsstationens klocka (`GET_TIME` vid handskakningen, framräknad med
datorns gång sedan dess), i andra hand datorns klocka; avläsningen bär
`clockSource` och `clockOffsetMs` (stationens klocka minus datorns) och
avläsningsvyn varnar vid mer än fem minuters skillnad. Den följer AM/PM och
veckodag när de finns, och tävlingens tidszon (sommar- och vintertid). Ett lopp
kan därmed vara högst 12 timmar med SI5 och en vecka med nyare brickor.
Motsägelsefull tid ger `SiTimeError`, aldrig en gissad tid (PLAN.md steg 22).

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
| SI-Card 6 / 6* | 500 000–999 999, 16 711 680– | `0xE1` block 0, sedan 6/7 efter antal (reserv `0xE1 0x08`) | untested |
| SI-Card 8 | 2 000 000–2 999 999 | `0xEF` block 0, 1 | untested |
| SI-Card 9 | 1 000 000–1 999 999 | `0xEF` block 0, 1 | field-verified¹ |
| pCard | 4 000 000–4 999 999 | `0xEF` block 0, 1 | untested |
| SI-Card 10 | 7 000 000–7 999 999 | `0xEF` block 0, sedan 4–7 efter antal (reserv `0xEF 0x08`) | untested |
| SIAC | 8 000 000–8 999 999 | `0xEF` block 0, 1, sedan 4–7 efter antal (reserv `0xEF 0x08`) | untested² |
| SI-Card 11 | 9 000 000–9 999 999 | `0xEF` block 0, sedan 4–7 efter antal (reserv `0xEF 0x08`) | untested |
| tCard, fCard | – | stöds inte | – |

| Station | Status |
|---|---|
| BSM7-USB | untested |
| BSM8-USB | untested |
| BSM-USB, modell ej noterad (CP210x, macOS, Chrome) | field-verified¹ för SI9-avläsning |
| SI-USB-läsare | untested |

¹ 2026-10-19, ägarens pilot: två SI9-brickor lästa med en BSM-station på macOS i Chrome. Bricknummer, antal stämplingar
och stämplingarnas tider avkodades rätt (jämfört med brickorna). Stationens modell och firmware är inte noterade.
Inget annat är provat på riktig hårdvara: start-, mål- och checkstämplingens tider, andra bricktyper, 4 800 baud,
Windows och Linux är fortfarande `untested`.

² SIAC lästes med "alla block" på natt-KM 2026-10-20 (steg 34, stationen skickade alla åtta block). Snabb utläsning
(steg 53) är bara provad med den falska stationen och den brickans inspelade block.
