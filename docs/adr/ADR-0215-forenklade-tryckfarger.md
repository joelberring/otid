# ADR-0215: Förenklade färger för tryck – kartans egna färger som förval, Tryck hos BL med de tveksamma, resten under Avancerat

Status: beslutad 2026-11-07 (städrundan, grenen `b2-tryckfarger`; ägarens beslut i projektet, detaljerna nedan beslutade
utan honom eftersom han var bortrest). Ingen migration. Ändrar ADR-0211 beslut 6 (färgerna i ett flöde) och förvalet i
ADR-0183 (profilen "Tryckeri (som i filen)" när tävlingen inte valt någon). Ingen funktion tas bort.

**Bakgrund.** Ägaren: "Jag funderar på om färginställningarna är onödigt komplicerade då man ställer in inställningar per
lager istället för per färg? … orolig att folk ska göra fel". Före ändringen var förvalet "Tryckeri (som i filen)" med banan
överst (Purple Pens sätt), och normens färgordning (ADR-0211 beslut 3, 11 och 12) fick man kryssa i själv under "Redigera
färger". BL-läget visade hela förslaget med alla kartfärger, jämförelsen, lagren och tabellen för hand på en gång.

**Beslut.**

1. **Förvalet "Kartans egna färger".** En ny färdig profil `map-own` ("Kartans egna färger", först i
   `BUILT_IN_PRINT_PROFILES`, `MAP_OWN_PRINT_PROFILE_ID`): kartfilens färger och dekorfärger som i filen, banan i Purple Pens
   lila 20/100/0/0 med övertryck och `courseLayer: "REFERENCE"`, alltså normens ordning med filens relativa ordning bevarad på
   varje sida (normen ur kartan, numren i undre lila i skog). Den gäller när tävlingen inte har `printProfileId`. Att välja den
   sparar `printProfileId: "map-own"`; servern hittar den bland de färdiga profilerna som de andra.
   *Befintliga val ändras inte:* en tävling som har valt en profil (också "Tryckeri (som i filen)" med banan överst) behåller
   den och dess PDF är densamma. En tävling som *aldrig* valt något får normens ordning i nästa PDF; det är ägarens beslut 1
   ("används utan att användaren gör något"). Redan skrivna PDF:er skrivs inte om.
2. **Statusraden.** Överst i "Färger för tryck" en rad: "Färger: kartans egna, i normens ordning (32 färger, 3 över banan)"
   (färgerna som används i kartan; alla tills användningen är känd), "Färger: tryck hos BL (skog), 2 färger kvar att
   godkänna" / "alla godkända", eller "Färger: Egna inställningar (Avancerat) – <profilens namn>". "Visa" fäller ut normen och
   dess regel, banans färg och kartans färger över och under banan (samma lager som förhandsvisningen, `pressLayersFor`).
3. **Två lägen** som radioknappar: "Kartans egna färger" och "Tryck hos BL". BL väljer den senaste BL-tabellen för kartans
   norm (skog eller sprint, `blProfileIdFor`), eller tävlingens godkända kopia av den om den finns (som förut).
4. **Tryck hos BL visar bara de tveksamma färgerna** (`doubtfulRows`): färger utan säker rad i tabellen ("Bekräfta" eller
   "Tvetydig": ingen rad, en rad utan CMYK, andel som skiljer, flera rader, en utgången rad, eller tabellens sida mot kartans
   ordning) och, med normens ordning, färger där förslagets eller den valda BL-raden ligger på andra sidan banan än normen
   lägger färgen (raden får "BL:s tabell lägger färgen på andra sidan banan än normen; O-Tid följer normen"). En beslutad
   tveksam rad står kvar med sin status så att den kan ångras. De säkra godkänns med "Godta alla säkra (n)" i samma ruta.
   Oanvända färger behöver inget beslut (som förut). Jämförelsen före/efter och lagerbilden finns i hela listan (beslut 5).
5. **Avancerat.** Allt från ADR-0211 beslut 6 ligger under "Avancerat" (stängt som förval, också för egna inställningar och
   BL; innehållet ritas först när det öppnas): "Färgprofil" med alla profiler, statusmärket, "Ny profil", banans färg,
   färgordningen (norm, "Kontrollnummer och texter överst"), BL:s hela lista med jämförelse och lager, "Justera färger för
   hand", förhandskontrollen och "Mer" (JSON). Öppnas Avancerat i BL-läget ersätter hela listan de tveksamma.
6. **Egna inställningar** (`colorModeOf` = CUSTOM): allt som inte är `map-own` eller en BL-tabell utan egna rader per färg –
   "Tryckeri (som i filen)", "Kontorsskrivare", den äldre BL-versionen (regler utan tabell), en egen eller importerad profil,
   en ändrad kopia av `map-own` och en BL-kopia med rader för hand (`mapColors`). Den gäller tills man väljer ett av lägena;
   den ligger kvar i tävlingens profiler och kan väljas igen under Avancerat. Ingen radioknapp är vald.
7. **En skallista.** Fliken Utskrift ("Alla kontroller") hade en egen lista utan 1:3 000; den använder nu
   `COURSE_PRINT_SCALES` som banans egenskaper.

**Följder.** Den som aldrig ändrat färgerna får normens ordning (lila under svart, brunt 100 % och blått 100 % för linjer och
punkter, med övertryck) i stället för banan överst; "Tryckeri (som i filen)" finns kvar under Avancerat. E2E-specarna väljer
BL med radioknappen och använder "bl-doubtful" eller öppnar Avancerat för hela listan. Hjälpartikeln "Färger för tryck"
beskriver lägena.
