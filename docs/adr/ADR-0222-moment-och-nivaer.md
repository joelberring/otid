# ADR-0222: Moment och nivåer på träningar

Status: beslutad 2026-11-09 (ägaren: "går det också att tagga träningar med vilka moment de innehåller och nivåer så att man
söka i arkivet?"; valen i beslut 1–3 är ägarens).

**Bakgrund.** Klubbarkivet (ADR-0194) har fria taggar och ett filter på en tagg. Ledarna vill hitta en gammal träning att
använda igen efter vad den övar och för vilken nivå den passar, och sätta det redan när terminen planeras (ADR-0221).

**Beslut.**
1. **Moment** är en fast lista med koder (Kartläsning, Ledstång, Kompass, Avståndsbedömning, Kurvbild, Vägval,
   Angreppspunkt, Detaljläsning, Förenkling, Kontrolltagning, Kartminne, Stråk, Korridor, Fönster, Natt, Sprint, Gafflingar,
   Fysisk träning), med namn på svenska och engelska i webbens texter. Egna ord är som förut taggar ("Egna ord").
2. **Nivå** är Svensk Orienterings färger, Grön–Svart (samma koder som banläggningens nivåstöd, ADR-0212), en eller flera per
   träning. I arkivet föreslås nivåerna ur banornas namn med nivåstödets tolkning av klassnamn ("Gul", "H12", "Lätt" …);
   ledaren väljer "Använd förslaget" eller sätter nivåerna själv.
3. **Planeringen:** moment, nivåer och egna ord sätts på den planerade träningen och följer med när träningen som skapades
   ur planen läggs i klubbarkivet ("Lägg i klubbarkivet").
4. **Sökningen** i arkivet: knappar för nivå (någon av de valda), moment och egna ord (alla valda). Fritextsökningen gäller
   också momentens namn på besökarens språk. Ett sparat filter med den gamla enda taggen läses som ett eget ord.

**Följder.** Migration 0110 lägger till `moments` och `levels` på `club_archive_entry` och `moments`, `levels` och `tags` på
`club_plan_session` (tomma listor som förval). En begäran som ändrar träningen i arkivet utan moment och nivåer lämnar dem
orörda. Nivån räknas inte ur kartan och banorna här; banläggningens nivåstöd gör det i banläggningen.
