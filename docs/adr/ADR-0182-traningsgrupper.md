# ADR-0182: Träningsgrupper

Status: beslutad 2026-11-01 (PLAN.md steg 68, ägarens önskemål samma dag). Bygger på tävlingar, kopiering,
självanmälan och behörigheterna. Görs efter steg 67 och före steg 64–65.

**Bakgrund.** En klubb har grupper som tränar regelbundet, till exempel "Ungdom OK ÄÖ". I dag står varje träning för sig:
ledarna kopierar en tävling, lägger till varandra som admin och delar en ny länk varje gång. Det som är gemensamt vecka
efter vecka (ledare, kartor, banor, deltagare, länk) borde ligga på ett ställe.

**Beslut.**
1. **Grupp** (`training_group`) med namn, ledare och en fast sida. Tävlingar (träningar och mindre tävlingar) kan höra
   till en grupp. Ledarna har ADMIN på gruppens tävlingar utan att läggas till var för sig.
2. **Gruppsidan** visar kommande tillfällen, senaste resultat och arkivet; en fast länk och QR-kod. Varje tävling har
   kvar sin egen sida.
3. **Mallar och upprepning:** ny träning ur gruppens mall eller förra tillfället (klasser, banor, karta, tidtagning);
   upprepning (t.ex. varje tisdag en termin) skapar tillfällena i förväg.
4. **Kartbibliotek per grupp:** kartfiler och banläggningar (steg 59, 62) sparas i gruppen och kan användas igen.
5. **Deltagare** känns igen mellan tillfällena (självanmälan för gruppen, samma löpare igen).
6. **Säsongen:** närvaro per deltagare och valfri enkel poängserie.
7. **Allt som rör synlighet är inställningar per grupp**, med försiktiga standardvärden eftersom grupperna ofta är barn:
   - vem som ser gruppsidan: alla med länken (standard) eller bara inloggade medlemmar;
   - namn: förnamn (standard), fullt namn eller inga namn;
   - närvaro och statistik per person: bara ledarna (standard) eller medlemmarna;
   - sökmotorer och AI-indexering: alltid avstängt (som de publika resultaten).
8. **Klubb med flera grupper** kan läggas till senare utan att grupperna görs om.

**Konsekvenser.** Ledarna slipper upprepa samma arbete varje vecka, och föräldrar och ungdomar har en länk för hela
terminen. Behörigheterna får en nivå till (grupp → tävling), som måste hållas enkel att förstå.
