# ADR-0116: Produktions-Eventor är en explicit, read-only profil

- Status: Accepterad för TASK101
- Datum: 2026-09-19

## Kontext

ADR-0046 och ADR-0114 begränsar medvetet dagens anslutningar till svensk
Testeventor. Det är korrekt för syntetisk acceptans, men gör inte den redan
implementerade, granskade importkedjan användbar för en verklig arrangör.
Produktions-Eventor har en annan fast origin och kan innehålla verkliga namn-
och klubbuppgifter. Att bara byta adapterns URL skulle blanda miljöer i
krypterings-AAD, provenans, unika externa identiteter och operatörens UI.

Eventors officiella API-dokumentation listar `event/{eventId}`,
`eventclasses?eventId=…` och `entries?eventIds=…`; läsning använder den
serverförvarade ApiKey-headern. De används här endast som interopreferens.

## Beslut

Inför den beständiga, slutna profiltypen:

```text
testeventor-se | production-se
```

Varje profil väljer en fast HTTPS-origin i serveradaptern:

| Profil | Tillåten origin | Syfte |
|---|---|---|
| `testeventor-se` | `https://eventor-sweden-test.orientering.se` | syntetisk testacceptans |
| `production-se` | `https://eventor.orientering.se` | arrangerarägd produktionsläsning |

Ingen request, browser eller CLI får ange en URL. Båda profiler använder samma
begränsade `Event`, `EventClassList` och individuella `EntryList`-projektion,
samma bodygränser, timeout, redirectförbud, strikta XML-policy och SHA-256 över
mottagna bytes. Parsern utökas inte för team, flera klasser, brickor, avgifter,
kontaktuppgifter, starttider eller andra fält som TASK098 redan avvisar.

Profilen lagras immutable på anslutning och importprovenans, ingår i den
krypterade nyckelns AAD och är del av den befintliga miljöscopade unika externa
eventidentiteten. En Testeventor-nyckel kan alltså inte öppnas som produktion,
och samma externa event-id i de två miljöerna är olika provenans.

En produktionsanslutning provisioneras endast genom samma betrodda CLI som
dagens anslutning, men med ett uttryckligt profilanrop. ApiKey matas fortsatt
endast på stdin från privat fil; den får aldrig förekomma i argv, URL, UI,
HTTP-svar, audit, logg eller repository. Samma anslutningsägare med
`CREATE_EVENT` och samma racebundna `IMPORT_IOF`-grantmodell återanvänds.
Det inför ingen ny browserbehörighet och ger inte fri åtkomst till andra
anslutningar.

Produktionsprofilen är **read-only**: den får enbart skapa ny intern
event/race-provenans enligt ADR-0046 och nya, explicit mappade individuella
Entries enligt ADR-0114. Den kan aldrig skriva tillbaka till Eventor, göra
uppdaterings-/avanmälningssynk, ändra lokal Entry, fabricera DNS, lägga till
brickor/starttider eller publicera något automatiskt. En verklig livekörning
kräver att ägaren själv provisionerar en privat anslutning och aktivt väljer
import; TASK101 gör inga externa anrop.

## Konsekvenser

- Schema- och migrationstypen måste utökas additivt och behålla äldre
  Testeventor-provenans exakt oförändrad.
- Adapter- och applikationsnamn blir profilneutrala, medan UI alltid visar den
  säkra, lagrade profiletiketten. Det får inte stå bara "Eventor" när anslutningen
  avser Testeventor.
- Produktnamn, klubb och deltagarnamn från en uttryckligen genomförd import är
  fortsatt privata tävlingsdata. Råa Eventor-svar sparas inte.
- Produktionens API- eller personuppgiftsvillkor kan kräva en separat operativ
  överenskommelse. Avsaknad av sådan ger inte rätt att använda någon nyckel,
  men blockerar inte syntetiskt profilarbete.

## Migration och återställning

Migrationen utvidgar endast den befintliga miljö-checken från ett till två
whitelistade värden. Den skriver inte om anslutningar, envelopes, journaler,
event, race eller entries. Rollback är att stänga production-provisioneringen
och spärra berörd anslutning; redan immutable provenans raderas aldrig.
Backup hanterar kryptotext men aldrig masterkey enligt ADR-0046 och ADR-0115.

## Avvisade alternativ

- En konfigurerbar origin eller proxy: möjliggör SSRF och bryter miljöbeviset.
- Att återanvända `testeventor-se` för produktion: gör AAD och provenans falsk.
- Produktnyckel i browser eller valfri race-admin: läcker ägarens rättighet.
- Bred Eventor-synk eller extern skrivning: större separat domänsnitt.
- Att göra en riktig API-läsning under implementation: använder verkliga
  persondata/credential utan ett uttryckligt operativt beslut.
