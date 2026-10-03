# TASK042: Diskvalificering och rättning med samma administratör

Status: klart avgränsat snitt 2026-09-12. ADR-0081 före implementation.

Anslut befintliga diskvalificerings- och återtagandetjänster till gemensam
MANAGE_RACE-session och kompakt administratörsarbetsvy. Ingen separat login.
Befintlig ADR-0031 gäller för tekniskt OK/MP-underlag, aktivt beslut över senare
ingest och exakt restaureringsrevision. Ingen fri resultatstatuseditor.

Berör application policy/audit, web HTTP/helpers/UI och riktade tester.
Ingen migration, ny dependency, hårdvara, extern API eller licensändring.
Acceptans: sann adminaktör och äldre begränsade roller, fryst intent, exakt
retry, senare teknisk revision bevarad, rättning från granskad källa och
oförändrade rådata/originalrevisioner. Riktad PG/HTTP/browser samt lint,
typecheck och build. Inte ett påstående om färdig produktion eller MeOS-paritet.

Verifierat: application/web lint, typecheck och build exit0. Policy2, PG2,
HTTP/helpers24 och browser6 godkända (34 olika riktade fall). Browser provar
avläsning → DSQ → senare avläsning → exakt återtagande, med tappat svar och
byteidentiskt retry vid båda besluten. Skärmbilder390/1366 granskade.
Se docs/status.md för exakta kommandon och initiala rättade körfel.

Kvar: direkt tekniskt OK/MP-underlag krävs; ingen DSQ utan avläsning eller
direkt på manuell restaurering. Fysisk mobil/hårdvara och produktion ej provade.
Nästa minsta snitt: kompaktare granskning av resultatbeslut, med begriplig
resultatpåverkan och utfällbara tekniska revisionsdetaljer.
