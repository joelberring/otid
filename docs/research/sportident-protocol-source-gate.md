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
