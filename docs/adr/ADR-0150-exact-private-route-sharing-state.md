# ADR-0150: faktisk delningsstatus för en exakt privat GPX-version

- Status: Accepterad för TASK156
- Datum: 2026-09-23

## Kontext

ADR-0148/0149 ger ett konto med aktiv koppling till en exakt anmälan en privat
faktavy och en separat, explicit versionsbunden kartvy. ADR-0126 lagrar
deltagarens samtycke per immutable GPX-manifest. ADR-0127 kräver dessutom
administratörens exakta rutt- och kartsläpp samt giltigt publicerat resultat,
georeferens och historisk bangeometri vid varje publik läsning. Ett tidigare
`RELEASE` eller `GRANT` kan därför finnas kvar i journalen utan att rutten
faktiskt är offentlig nu. Deltagaren kan inte se denna skillnad på sin privata
ruttsida i dag.

## Beslut

Den befintliga kontoskyddade detaljläsningen för ett **valt** `routeUploadId`
får en strikt validerad delningsprojektion. Läsningen kräver fortfarande aktiv
kontosession och exakt, ej återkallad anmälningskoppling. Den ändrar ingen
samtyckes-, release-, resultat- eller kartjournal och ger ingen ny skrivrätt.

Projektionen redovisar tre skilda fakta för samma immutable ruttmanifest:

1. `consent`: senaste samtyckesbeslutet är `GRANT` med manifestets nuvarande
   SHA-256, annars `NOT_GRANTED`.
2. `adminRelease`: senaste ruttrelease för anmälan avser exakt detta manifest
   och dess SHA-256 **och** senaste kartrelease avser exakt den bundna kartans
   manifest och SHA-256, annars `INACTIVE`. Detta beskriver journalernas
   aktuella administrativa släpp, inte publik åtkomst i sig.
3. `publicRoute`: `AVAILABLE` endast om samma interna gate som den faktiska
   publika ruttläsningen godkänner den exakta ruttversionen **och** hela
   projektionen går att producera. Då får svaret bära dess redan offentliga
   `publicResultId` för en länk. I alla andra fall är den `UNAVAILABLE` utan
   publik länk. Klienten får inte härleda detta från samtycke eller släpp.

Alla tre läses i en transaktion med loppets läslås och anmälans aktiva
kontokoppling. Ny publik ändring kan naturligtvis ske efter svaret; klick på
länken måste alltid passera publikens gate igen. Svaret får inte exponera
intern entry/claim/grant, rå GPX, koordinater, objektlagringsreferenser,
hashar eller administratörsidentitet. Det är privat `no-store`.

Sidan visar svensk korttext om att den valda versionen alltid finns kvar
privat för behörigt konto, att samtycke inte ensamt publicerar den och att
återtagande stoppar publik åtkomst men inte originalet. Den erbjuder ingen
samtyckesknapp i denna TASK: dagens separata route-upload-session behåller
sin beslutsgräns. En senare förbättring av kontobundet samtycke kräver ett
eget beslut, inte en tyst utvidgning av anmälningskopplingen.

## Konsekvenser och återställning

Ingen migration krävs. Det privata detaljkontraktet versionshöjs eftersom
delningsfältet blir obligatoriskt. Äldre klienter som förväntar sig version 1
måste uppdateras tillsammans med vyn; det är en intern kontovy, inte en
publicerad integrationsstandard. Vid rollback återgår bara läsprojektionen
och UI. Alla immutable beslut och privata GPX-versioner lämnas orörda.

Riktade prov täcker två versioner för samma anmälan, samtycke utan släpp,
exakt publik version, annat släppt manifest, återtaget samtycke/ruttsläpp/
kartsläpp, saknat publicerat resultat eller kompatibel geometri samt fortsatt
privat läsning efter publik återtagning. Ett kompakt mobilbrowserfall provar
text/länk på 390 px. Syntetiska prov är inte fysisk mobil- eller fältacceptans.

## Avvisade alternativ

- `published = consent && release`: ignorerar kart-, resultat-, geometri- och
  projekteringsgränsen i faktisk publik läsning.
- Visa senaste release oavsett GPX-version: kan märka fel privat version som
  offentlig.
- Ge kontokopplingen rätt att skriva samtycke: den är ett annat bevis än den
  nuvarande deltagarbundna upload-sessionen och ändras inte här.
