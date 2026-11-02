# ADR-0190: Banläggningens kvarstående luckor mot Purple Pen

Status: beslutad 2026-11-02 (grenen `banlaggning-egenskaper`). Bygger på ADR-0180 (banläggning i webben) och ADR-0181
(samarbete och fältläge).

## Bakgrund

Efter steg 62–68 gick det fortfarande inte att ändra stigning, fast längd, poäng per kontroll, poängbana och banornas
ordning i editorn (modellen och .ppen hade dem redan). Ångra försvann vid omladdning, och banorna kunde bara lämna O-Tid
som .ppen eller genom "Överför till tävlingen".

## Beslut

1. **Banans egenskaper.** `UPDATE_COURSE` tar `kind` (vanlig eller poängbana) och `null` för att ta bort stigning, fast
   längd, undertitel och utskriftsskala. En poängbana kan inte ha gafflingar (som Purple Pen); etiketten "Nummer" blir
   "Kod" när banan blir poängbana och etiketter med poäng tappar poängen när den blir vanlig. Ny åtgärd `SET_POINTS`
   (poängen för en vanlig kontroll på en poängbana, 0–9999, 0/null = inga; touch `courseControl:<id>:points`).
   Ordningen är `UPDATE_COURSE.order` = plats i listan (1 = först), de andra numreras om 1, 2, 3 …; flytta upp och ned
   för vald bana, dra i listan på datorn.
2. **Ångra en flytt rör bara ordningen.** `PUT_OBJECTS` får `courseOrder` (bana → plats). `objectPatch` lägger en bana som
   bara bytt plats där i stället för hela banan, och en bana som finns behåller sin plats när hela banan sätts. Därmed
   flyttar ångra av ett namnbyte inte tillbaka en bana som någon annan flyttat, och ångra av en flytt tar inte bort
   någon annans namnbyte. Touches för `courseOrder` är `course:<id>:order`.
3. **Utskrift och tävlingen.** Beskrivningens huvud och `$(CourseLength)`/`$(CourseClimb)` hade redan fast längd och
   stigning; utskriftens rubrik visar nu "4,3 km, 85 m" (poängbana: bara stigningen). Banfilsjämförelsen ger en egen rad
   när bara längden eller stigningen ändrats (`SET_COURSE_MEASURES`, fält `LENGTH`/`CLIMB`, räknar inte om resultat), och
   längd och stigning sparas för en befintlig bana bara när dess rad är vald. Ny ordning i dokumentet ger inga rader
   (banorna matchas på id och namn); ordningen avgör bara vilken bana en klass som står på två banor får, som i Purple Pen.
   En borttagen stigning tas inte bort i tävlingen (en banfil utan `Climb` ska inte nollställa).
