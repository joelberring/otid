# ADR-0067: Versionsbunden rättning av deltagarnamn och klubb

- Status: Accepterad
- Datum: 2026-09-09

## Kontext

TASK026 kompletterar deltagarlistans klass-, brick- och starttidsrättning.
`entry` har egna givenName/familyName/organisationName, inte ett globalt
klubbregister. EntryList-import uppdaterar dessa fält och entryversion; race-
snapshot ökar. ADR-0028 fryser officiella resultatbytes och ADR-0043/0044
fryser publicerad startlista. Rättning får inte skriva om dessa dokument.

## Beslut

En ny separat racebunden `CHANGE_ENTRY_IDENTITY` ger rätt att läsa och rätta
endast förnamn, efternamn och deltagarens klubbtext. Namnet på capabilityn
innebär inte byte av person, extern identitet eller ägarskap. UI heter
”Namn och klubb”. Interna/external-ID:n, klass, brickor, starttid, rådata,
resultatrevisioner och manuella resultatbeslut är uttryckligen orörda.
Ingen återkoppling till Eventor och inget globalt klubbregister införs.

Den nya ytan följer befintlig racecredential/session/Origin/CSRF, med eget
prefix `otid_org_entry_identity_v1` och egna cookies. Access högst åtta timmar,
session högst en timme, strikt JSON högst 8 KiB. Befintliga behörigheter får
inte automatiskt denna rätt. Credentials lagras eller skickas inte i URL.

Request binder väntad entryversion, klass, racesnapshot och exakt föregående
tre textfält samt nya värden. Nya värden trimmas, men historiska/förväntade
värden normaliseras inte. För-/efternamn högst160 tecken; ny klubb högst200,
som befintlig registrering och station-package. Historisk/förväntad klubb
tillåter240 som klass/startlisteprojektion, så äldre värden kan rättas nedåt.
Det ursprungliga beslutets240 för ny text justeras här före serveracceptans:
granskning visade att201–240 annars skulle hindra signerat stationspaket.
Paketformatets gräns ändras inte. Null betyder uttryckligen ingen
klubb; tom ny klubbsträng är ogiltig och UI måste konvertera tomt fält till
null. Ingen namnmatchning, automatisk personfusion eller Unicode-omskrivning.

Låsordning: session → credential → race UPDATE → request advisory → entry
UPDATE. En faktisk ändring ökar entryversion och racesnapshot exakt ett.
Ändring, append-only journal med före/efter och actor-audit committar atomärt.
No-op, stale underlag eller versionsoverflow ger konflikt utan writes. Samma
request-id/actor/normaliserade intent återger tidigare svar även efter senare
ändring; annan actor, entry eller avsikt med samma id ger konflikt.

### Import och historik

Efter den första journalförda rättningen får en ny EntryList-import endast
ange samma tre aktuella värden för denna entry. Avvikelse avvisar hela
importen atomärt och hänvisar till explicit namn-/klubbrättning; även att
utelämna klubb när aktuell klubb finns räknas som avvikelse. Detta skydd gäller
hela den rättade fältgruppen. Entries utan rättningsjournal följer befintlig
importpolicy. Identisk tidigare importerad fil förblir content-idempotent och
skriver inget. Importens övriga regler ändras inte.

Journalen beskriver explicita rättningar, inte en fabricerad fullständig
personhistorik före införandet. Befintliga originalimporter bevaras. Privat
läsning av journal per deltagare ingår i rättningsvyn med begränsad sidning;
detta är inte avläsningshistorik eller en resultatrevision.

Historiken läses med samma rättningscapability och visar högst50 beslut per
sida (HTTP-default20), nyaste entryversion först. Cursor v1 binder race, entry
och exklusiv beforeEntryVersion; den innehåller inga namn eller credentials.
Entryversionens unika journalindex ger stabil seek utan tidsavrundning och
senare append påverkar inte äldre sidor. En känd entry utan journal ger tom
lista; okänd/annan races entry ger404 efter auth. Svaret innehåller request-id,
historisk klass, före/efter, versioner och beslutstid, inte actorcredential.
Journalen använder inte aktuella displayjoins och kan därför läsas oförändrad
efter senare rättning/import. Cursor är en scopebunden position, aldrig auth.

### Paket och publicering

Nästa signerade paket och levande listor använder rättad text. Installerade
paket, offlinekö, kvittenser och tidigare resultat ändras aldrig. Ingen
automatisk omräkning/publicering sker. Befintlig konservativ snapshotregel
kan kräva explicit omräkning före ny finalisering även för textändring;
TASK026 inför inte en alternativ aktualitetsmodell. Äldre Complete-XML och
publicerade startlistor förblir byteidentiska tills ett nytt explicit beslut
ger en ny version. UI måste förklara att publicerade kopior inte uppdateras.

### Kompakt UI

Deltagarlistans Rätta-meny erbjuder ”Namn och klubb” via ADR-0064:s flyktiga
navigationshint. Destinationen kräver egen auth, aktuell serverläsning och
explicit deltagarval. Sökning på namn/klubb/klass; ett kompakt formulär visar
före/efter innan bekräftelse. Osäkert svar fryser request och visar explicit
same-id-retry. Ingen ny offlinekö eller Web Storage. Authfel/logout döljer
persondata och sena svar får inte återöppna vyn.

## Migration och återställning

En additiv migration krävs för capability/actor, scopebundna constraints och
immutable rättningsjournal (update/delete spärras). Inga befintliga entries
skrivs om av migrationen. Privat journal innehåller nödvändig före/eftertext;
personnamn ska inte kopieras till tekniska loggar. Rollback stänger ny yta och
spärrar dess credentials, följt av additiv rättning eller verifierad full
backuprestore. Journaler och enumvärden får inte droppas i produktion.

## Acceptans och avgränsning

Riktade kontraktstest, PostgreSQL-prov för auth/CAS/exakt retry/importskydd/
immutabilitet samt browserprov för val/bekräftelse/tappat svar och kompakt
desktop/mobil. Befintliga exportbytes och resultat ska jämföras före/efter.
Ingen ny dependency, teknik, domängräns, extern kod eller licensändring.
MeOS används inte som kodkälla. Stafett, GPS, riktig USB och bulkredigering
ingår inte. Beslutet föregår implementation och är inte ett driftbevis.
