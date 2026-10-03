# TASK019 – sökbar deltagarväljare för fast starttid

## Avgränsning före implementation

Endast webbens befintliga starttidsadministration: sök på namn och klass i
behörigt underlag, behåll serverordning och kräv uttryckligt deltagarval.
Sökändring rensar ogranskat deltagarval/tidsutkast. Ett granskat försök låser
sökningen och behåller exakt begäran, versionsvillkor och idempotensnyckel.
Bekräftelse/återförsök placeras före redigeraren för mindre scroll.

Berört paket: apps/web samt avgränsade browserprov. Inga nya startregler,
tidskonverteringar, API-kontrakt eller databasändringar. Befintlig gräns för
fast starttid och separat omräkning behålls. Ingen AGPL-kod används.
Ingen ny ADR behövs för denna rena presentationsändring.

## Acceptans

- Unicode-/skiftlägesnormaliserad namnsökning och klassökning utan automatval.
- Synligt antal, tomträff och rensa sökning; sökning rensas vid authförlust.
- Sökning kan inte ändra ett granskat eller okänt försök.
- Offsetinmatning normaliseras av befintligt kontrakt; identiskt återförsök.
- Smal och bred browser, riktade enhetstester, lint, typecheck och build.

## Resultat

Implementerat. Webbens lint, typecheck och build: exit 0. Riktade Vitest-prov:
2 filer, 5 tester passerade (sökning och befintliga route handlers).
Browserprov i 1366×768 och 390×844: 2 passerade. Testets separata TypeScript
och ESLint: exit 0 efter rättad unsafe-member-access i testassertionen.

Browsern använder verklig lokal Next-server men syntetiska HTTP-svar, ingen
databas. Den kontrollerar uttryckligt val, rensat tidsutkast, saknad starttid,
Unicode/klass/tomträff, authförlust och identiskt återförsök efter HTTP 500.
Inmatning med +02:00 skickas som kontraktets kanoniska UTC. Mobilbild granskad:
ingen horisontell overflow, återförsök före redigeraren.

Serverns befintliga FIXED-filter och mutationsspärr lästa, inte ändrade.
Ingen ny PostgreSQL-, produktions- eller hårdvaruacceptans ingår. Full
workspace- och integrationssvit återkördes inte för denna presentationsändring.
Nuvarande explicita ISO-/offsetinmatning och UTC-visning är oförändrade;
tävlingens lokala tidsvisning är nästa separata användbarhetssteg.
