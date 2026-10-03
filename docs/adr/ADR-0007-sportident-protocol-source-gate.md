# ADR-0007: Källgrind för SPORTident-protokoll

- Status: Accepterad
- Datum: 2026-08-30

## Kontext

TASK 002 kräver en streamingparser för SPORTident-ramar med bland annat
längdfält, CRC, DLE/escaping, ACK/NAK och återhämtning efter fel. De befintliga
projektunderlagen anger vilka egenskaper som ska testas men definierar inte
protokollets byteformat.

SPORTidents officiella utvecklarsida anger att lågnivåprotokollet dokumenteras
i *PC Programmer's Guide*. Guiden och SPORTidents kommunikationsbibliotek
tillhandahålls endast på begäran. De publika produkt- och Config+-sidorna
bekräftar att legacy- och extended-läge finns samt vissa baudlägen, men inte
ramstruktur, CRC-parametrar eller escapingregler.

Att fylla luckorna från minnet, från syntetiska bytes eller från AGPL/GPL-kod
skulle göra parsern obevisad och strida mot projektets licens- och
interoperabilitetsregler.

## Beslut

Ingen SPORTident-specifik frameparser, CRC-funktion, DLE-avkodning,
ACK/NAK-tillståndsmaskin, probe eller kortavkodning implementeras innan följande
underlag finns:

1. en auktoritativ protokollspecifikation för den faktiska stationen och dess
   protokollläge,
2. dokumentversion och licensvillkor som medger en självständigt skriven
   interoperabilitetsimplementation i detta projekt,
3. exakta regler för framing, length, escaping, CRC och ACK/NAK,
4. minst en oberoende request/response-testvektor med förväntad CRC,
5. faktisk hårdvaruinventering och senare verkliga, privata captures.

Det är tillåtet att bygga rena, protokollneutrala kontrakt eller testharnessar
som inte gör anspråk på SPORTident-semantik. Sådant arbete får inte skapa en
aktiv "SPORTident CRC", avgöra frame completion eller höja hårdvarustatus över
`untested`.

När grinden är öppnad ska `packages/sportident-protocol` vara ren TypeScript och
endast äga inkrementell framing. Paketet får inte importera transport,
normalisera kort eller beräkna resultat. Wire-fel ska ge återhämtningsbara
events; API-fel får kasta. Råbytes och dubletter ska bevaras, timeout ska matas
med monoton tid utifrån och en giltig men okänd kommando-ram ska vara en explicit
raw-unknown-typ.

## Käll- och licenshantering

Den självskrivna protokollnoten i
`docs/research/sportident-protocol-source-gate.md` är projektets nuvarande
evidensregister. MeOS, Oxygen och andra AGPL/GPL-implementationer används inte
som kod- eller strukturkälla. SPORTidents guide eller bibliotek får inte
vendlas, citeras utförligt eller omformas till kod innan villkoren är klara.

## Konsekvenser

- TASK 002:s transport, capture och deterministiska replay kan fortsatt
  verifieras utan parser.
- Parserdelen är uttryckligen `NO-GO`, inte "syntetiskt verifierad".
- Officiellt dokumenterade serieparametrar kan användas i en framtida probeplan,
  men inga obelagda protokollkommandon skickas.
- TASK 002 kan inte uppfylla sin definition av lyckad spike innan fysisk
  hårdvara, officiellt protokollunderlag och oberoende facit finns.

