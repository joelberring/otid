# ADR-0220: Gästkonto för demoläget

Status: beslutad 2026-11-09 (ägaren: "gör demoläget vid tillfälle", idéerna 2026-11-08). Avviker från AGENTS.md "Skapa inga
andra rolltyper" genom en tillfällig kontosort; tävlingsrollerna är oförändrade.

**Bakgrund.** Startsidan länkar redan till en publicerad demotävling (`OTID_DEMO_RACE`), men det visar bara de publika sidorna.
Ägaren vill att den som är nyfiken ska kunna klicka runt i arbetsytan utan att skapa konto. En delad demotävling skulle
ändras av alla samtidigt, och en kopia av en riktig tävling skulle sprida riktiga namn till okända besökare.

**Beslut.**
1. **"Prova arbetsytan"** på startsidan (bara utan inloggning och med `OTID_GUEST_DEMO=1`, av som förval) skapar ett
   gästkonto (`user_account.guest_expires_at`, migration 0108) och en egen övningstävling med samma påhittade löpare som
   `pnpm demo` (`seedDemoRace`), och loggar in gästen i arbetsytan. Spärr per IP och timme (`OTID_GUEST_DEMO_PER_HOUR`,
   förval 5). Den som redan är inloggad med ett eget konto loggas inte ut.
2. **Gäster nekas som förval.** `authorizeUserAccountSession` svarar "unauthorized" för ett gästkonto om anroparen inte
   uttryckligen sätter `allowGuest`. Det gör bara tävlingens rollkontroll (`requireRaceRole`), banläggningens
   (`requireCourseSettingAccess`), förhandsvisningen av de publika sidorna, frågan "vem är inloggad?" och utloggningen. Alla
   kontosidor (klubbar, grupper, kartprojekt, AI, Google, nya tävlingar, Mitt konto) är därmed stängda, också nya sådana.
3. **Inget syns utåt:** gästen kan inte publicera tävlingen, inte skapa banläggningens kartlänk och inte mejla inbjudningar.
   Tävlingen syns bara som förhandsvisning för gästen själv.
4. **Ett dygn:** efter `guest_expires_at` gäller sessionen inte, och underhållet (en gång i timmen) tar bort kontot med
   tävlingen (`deleteAccountWithOwnedEvents`). "Avsluta provet" loggar ut direkt.
5. Inga riktiga personuppgifter: tävlingen har bara påhittade namn. Det gästen själv skriver in tas bort med tävlingen.

**Följder.** En ny kontosida behöver inget särskilt för gäster. En ny tävlingsfunktion som når utanför tävlingen (publicering,
delningslänkar, mejl) behöver ta ställning till `principal.guest`.
