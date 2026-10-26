# SPORTident-protokoll: källgrind

- Granskad: 2026-08-30
- Beslut: `NO-GO` för protokollspecifik implementation

## Auktoritativa källor

| Källa | Vad den styrker | Begränsning |
|---|---|---|
| [SPORTident Developers](https://www.sportident.com/support/developers) | Lågnivåprotokollet dokumenteras i *PC Programmer's Guide*. Guiden och `.NET Core Communication library` finns på begäran. | Ingen publik framing-, CRC- eller escapingdefinition och inga publika licensvillkor för guiden. |
| [SPORTident legal information](https://www.sportident.com/legal-information) | SPORTident behåller upphovsrätten till publicerat material. | Text, tabeller, kod eller dokumentstruktur ska inte kopieras; be om uttryckliga villkor. |
| [BSM8-USB](https://docs.sportident.com/products/stations/bsm8) | USB-ansluten BSM8 använder normalt 38400 baud och kan ställas till 4800 baud för kompatibilitet. | Definierar inte övriga serieparametrar, framing eller säkra kommandon. |
| [Config+ User Guide](https://docs.sportident.com/user-guide/config-plus) | Legacy protocol finns; SPORTident rekommenderar det bara för äldre programvara. RS232-master/printout kan använda 4800 eller 38400 baud. | Definierar inte skillnaderna mellan protokolllägena på bytenivå. |
| [BS7/8/9 firmware history](https://docs.sportident.com/products/stations/bs7-8-9-firmware) | Legacy och extended är skilda lägen. Historiken nämner en beep-instruktion `0xF8`. | En kommandobeteckning är inte tillräcklig för säker framing, svar eller användning. |
| [RFC 20 - ASCII](https://www.rfc-editor.org/rfc/rfc20.html) | Generiska kontrolltecken: STX `0x02`, ETX `0x03`, ACK `0x06`, DLE `0x10`, NAK `0x15`. | Styrker inte SPORTidents användning eller semantik. |

Inga MeOS-, Oxygen-, AGPL- eller GPL-källor användes i granskningen.

## Saknade implementeringsfakta

| Område | Saknat underlag |
|---|---|
| Ram | Exakt start/slut, vilka varianter som har ETX och resynkregler. |
| Längd | Position, bredd, byteordning, vad fältet räknar och maxvärde. |
| DLE | Vilka bytes som escapear, transformation och om length/CRC räknas före eller efter escaping. |
| CRC | Polynom, init, reflektion, xor-out, byteordning, täckt intervall och officiella testvektorer. |
| ACK/NAK | Fristående eller inramat, när det krävs samt timeout/retry/sekvens. |
| Legacy/extended | Exakta frame- och kommandoskillnader. |
| Probe | Säkra request/response-kommandon och stationsspecifika övergångar. |

En akademisk eller tredjepartsbeskrivning kan ge forskningsledtrådar men ersätter
inte den auktoritativa definitionen för denna implementation. Tredjepartskod får
inte användas som genväg runt licensgrinden.

## Underlag som ska begäras

Från SPORTident behövs:

1. aktuell *PC Programmer's Guide* för den faktiska stationen och extended
   protocol,
2. dokumentets version och datum,
3. bytefält för framing, ACK/NAK, DLE, length och CRC,
4. minst en officiell request/response-vektor med CRC,
5. villkor som medger självständigt skriven open-source-interoperabilitet,
6. besked om egna fältbeskrivningar och syntetiska testvektorer får publiceras,
7. version och villkor för SPORTidents kommunikationsbibliotek.

Att kontakta leverantören är extern kommunikation och sker inte utan uttrycklig
auktorisering från projektägaren.

## H1: implementeringsinventering 2026-09-22

En skrivskyddad kontroll av den befintliga koden bekräftar att råtransporten
är färdig och avsiktligt stannar före protokollgränsen:

- desktop- och Androidadaptrarna kan fånga och återspela immutabla råbytes,
  men tolkar ingen SPORTident-frame;
- den lokala stationskön och ingestkontraktet accepterar i dag endast
  simulatorns normaliserade JSON-payload;
- ingen fysisk station, korttyp, Androidenhet eller golden vector är
  inventerad som verifierad; hårdvarumatrisens samtliga rader förblir därför
  `untested`.

En parser, ett bredare stationpayload-kontrakt eller en normaliseringsadapter
är alltså inte nästa säkra kodändring. H1 återstår tills det konkreta
underlaget ovan har erhållits och dokumenterats. Först då ska en separat ADR
låsa den självskrivna, versionssatta wire-specifikationen och den beständiga
normaliserade readout-gränsen före implementation.

## Acceptans efter upplåsning

Före parserkod ska denna not ersättas eller kompletteras med en självskriven,
versionssatt protokollspecifikation. Oberoende golden vectors ska låsa ramfält,
CRC och escaping innan implementationen skrivs. Parsern ska därefter testas med
alla enskilda chunkdelningar, seedad multipartitionsfuzzning, brus, trunkering,
CRC-fel, dubletter, flera ramar per chunk och deterministisk återspelning.

Syntetiska parserfixtures höjer aldrig en station/kort-rad över `untested`.

## Steg 53: snabbare utläsning av SI6 och SI10/11/SIAC (2026-10-26)

Fråga från ägaren: nyare brickor tar längre tid att läsa än äldre. Före steg 53 läste O-Tid SI10/11/SIAC med
`0xEF 0x08` ("alla block"). Stationen svarar då med block 0, 4, 5, 6, 7 eller, beroende på inställning, alla åtta block,
128 byte vardera, oavsett hur många stämplingar brickan har. SI9 läses med två enskilda block (0 och 1) och är därför
ungefär hälften så stor att föra över. Källorna nedan lästes för förståelse; ingen kod är kopierad (MeOS och sireader är
GPL, sportident.js MIT).

| Källa | Vad den gör/säger |
|---|---|
| [MeOS, `code/SportIdent.cpp`](https://github.com/melinsoftware/meos/blob/11dbad72b972353b4bcf7fa00535263c18616c7d/code/SportIdent.cpp) (commit 11dbad7, 2026-09-12), `getSI9DataExt` | Utökat protokoll med handskakning: läser block 0 med `0xEF 0x00`, tar antalet stämplingar ur byte 22 (högst 128) och läser sedan enskilda block i ordningen 1, 4, 5, 6, 7, så många som behövs: `2 + ceil(antal/32)` block. Block 1 läses med kommentaren "Block 1 added, to handle SIACs using Beacon". SI8/SI9/pCard: block 0 och 1. Väntar 50 ms efter varje kommando. |
| MeOS, `getSI6DataExt` | SI6 läses block för block i ordningen 0, 6, 7, 2, 3, 4, 5 med `0xE1 <block>` och slutar när sista stämplingsplatsen i ett block är tom (0xEE). |
| MeOS, inkommande `0xEF`/`0xE1` utan begäran | "Programmera stationen utan AUTOSEND": MeOS kräver handskakning för SI6 och nyare. |
| [sportident.js](https://www.npmjs.com/package/sportident) 2.0.3 (MIT), `ModernSiCard.ts`, `SiCard6.ts` | Läser sida 0, sida 1 (kortägaren) och sedan sida 4, 5, 6, 7 bara så länge antalet stämplingar (byte 0x16) kräver det, 32 per sida. SI6: sida 0, 1 och sedan 6, 7 efter antalet (byte 0x12). Svarets sidnummer kontrolleras mot det begärda. |
| [sireader 1.1.3](https://pypi.org/project/sireader/) (GPL, Gaudenz Steinlin m.fl.), `read_sicard` | Läser SI10 med `0xEF 0x08` och fem svar, med kommentaren "Reading out SI10 cards block by block proved to be unreliable and slow". SI8/SI9 block för block. Systemvärdet på offset `0x33` (`O_SI6_CB`) är en bitmask för vilka block stationen skickar vid "alla block": `0x00`/`0xC1` = block 0, 6, 7; `0x08`/`0xFF` = alla åtta. Det förklarar natt-KM 2026-10-20 (steg 34). |
| [per-magnusson/sportident-python](https://github.com/per-magnusson/sportident-python) | Utökad version av sireader (GPL). Sidan säger inget om blockläsning av SI10. |
| SPORTidents *PC Programmer's Guide* / `Communication.c` | Inte offentliga ([Developers](https://www.sportident.com/support/developers): "på begäran"). Inte lästa. |

Slutsatser för O-Tid:

- Två oberoende program (MeOS, som används på de flesta svenska tävlingar, och sportident.js) läser SI10/11/SIAC block för
  block efter antalet stämplingar i block 0. sireaders varning är från 2014 eller tidigare och säger inte vilken
  station eller firmware det gällde. Därför: snabb utläsning på som förval, med automatisk reserv till "alla block" och
  en inställning för att stänga av den.
- SIAC läser block 1 före stämplingarna, som MeOS. Varför "Beacon" kräver det står inte; blocket kostar ett svar och tas
  med för säkerhets skull. SI10/SI11 hoppar över det (de har inget beacon-läge).
- Stationens blockinställning (`0x33`) påverkar bara "alla block", inte enskilda blockläsningar. Den läses vid
  handskakningen och skrivs i felsökningsloggen. Läget utan handskakning (autosend) läses som förut, eftersom stationen då
  själv skickar det den är inställd på.
- SI8/SI9/pCard läses redan block för block (0 och 1). SI9 med högst 18 stämplingar skulle klara sig med block 0, men
  vinsten är ett svar och SI9 är den enda bricka som är provad på riktigt; den läses som förut. SI5 är ett svar.
- Den verkliga tiden beror också på hur lång tid stationen tar att läsa varje block ur brickan och på USB-fördröjningen
  per kommando, som inte går att mäta här. Felsökningsloggen skriver därför utläsningssätt, antal svar och millisekunder
  per bricka, så att snabb och hel utläsning kan jämföras med riktiga brickor.
