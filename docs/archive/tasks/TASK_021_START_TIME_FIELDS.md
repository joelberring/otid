# TASK021 – separata starttidsfält

## Avgränsning före implementation

Webbens befintliga starttidsrättning får datum-, tid- och explicit UTC-offsetfält
i stället för hel ISO-inmatning. Tid accepterar HH:mm, HH:mm:ss och valfria
1–3 millisekundsiffror efter sekunder. Saknade sekunder blir uttryckligen :00.
Datum och offset krävs; ingen enhetszon, dagens datum eller sommartid gissas.
Z och ±HH:mm följer befintligt kontrakt. Val av deltagare/sökändring rensar alla
ogranskade fält. Granskat försök låser dem och fryser samma UTC-request som förr.

Berört paket: apps/web och befintligt syntetiskt browserprov. Ingen ändring av
API, domänregler, lagring eller resultat. ADR-0039/0063 behålls; ingen ny ADR
behövs för uppdelad presentation av samma explicita offsetinmatning.

## Acceptans

Riktade tester för minuter, sekunder/millis, offset/dygn och ogiltiga datum.
Browserprov i smal/bred vy: sammansatt tid→exakt UTC, rensat utkast, låsta
fält och identiskt återförsök. Lint, typecheck och build. Ingen ny PG-omkörning
för oförändrad server; föregående TASK020 verifierade integrationen.

## Resultat

Implementerat. Webblint, typecheck och build exit 0. Riktade Vitest-prov:
3 filer/7 tester, exit 0 (1.95 s). Separat browser-tsc och ESLint exit 0.
Två browserprov passerade (8.3 s), mobil 390 px och desktop 1366 px,
enhetszon New York/tävlingszon Stockholm. Ogiltig offset ger inget försök;
11:00 +02:00 skickas som 09:00:00.000Z och retry har identisk body/nyckel.
Datum/tid/offset rensas vid sökbyte och låses under granskat försök.
Mobilbild granskad: datum på egen rad, tid/offset bredvid varandra.

Antaganden: operatören anger uttryckligen rätt datum och offset; ingen
automatisk DST-tolkning eller förifyllnad införs. Fysisk mobil/date-picker,
produktion och mycket stora listor är inte verifierade. Servern är oförändrad;
ingen ny integrations-/hårdvaruomkörning. Testservern avslutad.
