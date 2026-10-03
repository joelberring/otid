# TASK243: neutral och tät separat klassadministration

Status: genomförd 2026-09-27.

## Användarutfall

Den separata sidan `/admin/[raceId]/classes` ska kännas som samma
arbetsverktyg som `/manage`: lugn ljus/grå normalpalett, konsekvent
textstorlek och fler deltagarrader per skärmhöjd på dator. Namn,
klubb, aktuell klass, version, klassval och åtgärd ska fortfarande
kunna skannas i samma rad. Mobil ska inte få horisontellt sidspill och
behåller minst 44 px manöverdon.

## Avgränsat UI-beslut före implementation

Sidlokal stil på just klassadministrationssidan tonar ned normal header,
länkar, knappar, paneler och den tidigare gröna markeringen av ett
förvalt deltagarval. Den permanenta behörighetsförklaringen är neutral.
Okänd commit/retry är fortfarande en tydlig textmärkt gul varning;
fokus är blått. En bekräftad klassändring förblir uttryckligen märkt
med text och tecken, men behöver inte ett stort grönt fält.

Ändra inte global palett, andra administrationssidor, publik/station,
klassbytesregler, behörighet, kontrakt eller datalagring. Därför behövs
ingen ny ADR eller migration. Denna specifikation och
`docs/ui-workspace-design-2026-09-24.md` dokumenterar UI-beslutet.

## Riktad acceptans

Granska faktisk sida vid 320, 390 och 1280 px med syntetiska kandidater:
normal handling är neutral, osäker retry syns med text och gul markering,
fokus syns, all deltagarinformation finns kvar och sidbredden spiller inte.
Kör webblint, typecheck, berört UI-prov och build. En databasbunden
klassbytes-E2E körs endast mot uttryckligen isolerad PostgreSQL.

## Ingår inte

Nytt klassbyte, nya roller, bred global redesign, ändrade resultatstatusar,
stafett, GPS, USB eller fältacceptans.

## Utfall och kontroll

Klassidan har en sidlokal grafitgrå palett. Den ständiga behörighetsnoten
är en kort textrad, huvudytan och deltagarlistan har tunna avdelare i
stället för stora inramade kort. På dator ligger namn, klassval och
åtgärd i samma rad, under 120 px hög i det syntetiska provet;
mobilens klassval och åtgärd står
bredvid varandra med minst 44 px mål. Okänd commit behåller gul
textmärkt varning; fokusindikatorn är blå. Ingen klassbyteslogik ändrades.

Webblint, webbtypecheck, riktad E2E-TypeScript/ESLint och Next-build
gav exit 0. Befintligt klassadmin-UI-prov passerade 6/6. En riktig
Next-/Chromium-sida med syntetiska API-svar passerade 1/1 vid 320,
390 och 1280 px, inklusive osäkert PATCH-svar; skärmbilder granskades.
Det databasbundna klassbytesprovet kördes inte utan uttryckligen
isolerad PostgreSQL. Ingen verklig credential, tävling eller fysisk
touch provades.
