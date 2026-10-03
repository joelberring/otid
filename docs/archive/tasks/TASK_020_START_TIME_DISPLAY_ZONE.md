# TASK020 – starttider i tävlingens tidszon

Berör contracts, application och web. ADR-0063 dokumenterar obligatorisk zon
från eventet och fryst presentationszon för granskat försök före implementation.
Visa aktuell och granskad tid som tävlingslokalt datum/tid med offset, oberoende
av mobilens zon. Behåll explicit offsetinmatning och exakt UTC-återförsök.

Acceptans: kontrakt avvisar saknad/ogiltig zon; formattering täcker sommar/vinter,
dygn och millisekunder; befintligt browserprov körs med annan enhetszon och
kontrollerar lokal visning samt oförändrad kanonisk request. Riktade tester,
lint/typecheck/build. Ingen ny startregel eller resultatlogik.

Status: implementerat och avgränsat verifierat.

Lint/typecheck för contracts/application/web och build för alla tre: exit 0.
Fyra kontraktstester, sex riktade webbtester och två browserprov passerade.
Tre befintliga starttidsintegrationstester passerade mot ny isolerad PostgreSQL
17; 125 andra tester valdes bort av namnfilter. Ingen full integrationssvit.
Browserns enhetszon är America/New_York, tävlingszon Europe/Stockholm.
Mobilbild granskad; kanonisk UTC-request och identiskt retry verifierade.

Antaganden: samordnad server/webbdriftsättning och aktuell Intl-zondata.
Fysisk mobil, produktionsdrift och mycket stora listor ej verifierade.
Ingen hårdvara, privat tävling eller gammal databas berörd.
