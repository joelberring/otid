# ADR-0097: gemensam admin för explicit konfliktgranskning

Accepterad 2026-09-12 för TASK063. Utvidgar ADR-0056:s aktörsgräns,
utan att ändra KEEP_CURRENT_STATE eller dess domänvillkor.

MANAGE_RACE får läsa och granska exakt set av ogranskade konflikter för vald
deltagare med samma adminsession. Obligatorisk orsak och separat bekräftelse.
Återanvänd befintlig sourceHash, låsning, retry och rena domänplan. Aktuell
motsägelse mellan start, återkomst och DNS får fortfarande inte döljas.
Ingen start-/resultatrevision ändras av granskningsbeslutet.

Migration0047 ska utvidga endast review-headerns capability-check till
FINISH_FOREST_WATCH eller MANAGE_RACE. Behåll composite actor/race/capability-
FK, scopebundna medlems-FK och immutable-triggers. Spara verklig cap/aktör;
audit för admin är RACE_ADMIN_ACCESS_CREDENTIAL, aldrig falsk målpersonalroll.
Historiska validatorer måste läsa båda innan admin får skriva.

Granskningsunderlag får inte slå upp källor i personalrosterns filtrerade
enhetslista: den utelämnar avsiktligt onlineadmin. Läs etiketter från verkliga
källor i samma lopp efter befintlig scope-/kvittensvalidering. Detta behövs
även när målpersonal granskar en konflikt från en administrativ rättning.
Källorna ska inte därför läggas till i äldre offlineklienters enhetskontrakt.

Admin-UI visar aktuell grund och originalkonflikter, fryst intent och exakt
retry. Historiken behåller CONFLICT men visar separat att rapporten granskats;
ett gammalt beslut täcker aldrig en senare konflikt. Auto-uppdatering pausar
under granskning/okänt utfall. Inga nya recovery- eller offlinerättigheter.

Återgång: stäng nya adminskrivvägen först och behåll historiska läsvalidatorer.
Narrowa inte capability-check medan adminbeslut finns. Återställning kräver
verifierad backup, inte radering av journal/header/items. Ingen ny teknik,
resultatstatus eller domängräns.
