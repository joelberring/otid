# TASK023 – klassbyte via deltagarlistan

Avgränsning före implementation: utöka TASK022:s flyktiga engångshint till
befintligt classes-flöde. ADR-0064:s samma-flik-/behörighetsgräns gäller även
CHANGE_ENTRY_CLASS. Ingen ny behörighet, endpoint, lagring eller domänregel.
Ingen ny ADR behövs för ytterligare mottagare enligt samma beslut.

Målflödet kräver egen auth/listmatchning och knappen Välj länkad deltagare.
Valet begränsar listan till exakt entry och återställer dennes ogranskade
målklass till aktuell klass. Visa alla deltagare tar bort begränsningen.
Busy eller okänt ändringsförsök låser hintval/visningsbyte. Klassbytets
befintliga målklassval och Byt klass-kommando/immutable retry är oförändrade;
ingen extra automatisk mutation eller påstådd separat förgranskning införs.

Berört paket: web. Tester: hint race/mål/engångsregel, browser med separat auth,
explicit entryval, ingen PATCH före Byt klass, omladdning utan hint; befintliga
klassklient-/UI-prov, lint/typecheck/build. Ingen server-/PG-ändring.

Status: implementerat. Webblint/typecheck/build exit 0. Riktade tester:
3 filer, 16 passerade (962 ms). Separat browser-tsc/ESLint exit 0.
Hela genvägssviten: 6 passerade (16.7 s), klass/brick/starttid i 1366/390 px.
Klassprovet verifierar separat auth, uttryckligt fokus på rätt entry, oförändrad
aktuell målklass, inaktiv Ändra klass-knapp tills ny klass valts, Visa alla och
ingen hint efter omladdning. Inga PATCH-anrop görs av genvägen.

Ingen server/PG-ändring, full integrations-/hårdvarusvit ej körd. Fysisk mobil,
produktion och stora listor ej verifierade. Samma flik/mjuk navigering krävs.
