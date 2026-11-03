# ADR-0204: Importen till klubbarkivet i webbläsaren

Status: beslutad 2026-11-03 (grenen `arkiv-webbimport`, ingen migration, ägarens önskemål samma dag). Ändrar ADR-0194 beslut 6–7
(importen körs bara på ägarens dator med kommandot och en importnyckel).

## Bakgrund

Kommandot `pnpm archive-import` kräver Git, Node och pnpm. Ägaren: det är för svårt för folk i klubbarna. Gamla träningar ska
kunna importeras genom att välja mappar och filer i webbläsaren. Ägarens regel från ADR-0194 står kvar: filerna går direkt från
datorn till den egna servern, och filer som importen inte använder (resultat, startlistor, bilder med personuppgifter) ska aldrig
lämna datorn.

## Beslut

1. **Samma läsning och plan i webbläsaren.** `@o-tid/club-archive` läser en abstrakt källa (`scan-core.ts`: filer med sökväg,
   storlek och `open()` som bitar; sha256 som en fabrik). Kommandot ger filsystemet och node:crypto (`scan.ts`, `zip.ts`);
   webbläsaren ger File/Blob, zip-filer via `Blob.slice` och `DecompressionStream("deflate-raw")`, CRC i JavaScript och sha256
   med WebCrypto (`browser.ts`). Zip-formatet (`zip-format.ts`), planen, rapporten, omgångarna och uppladdningen (`upload.ts`)
   är gemensamma och importerar inget från Node; ett test följer importerna från `index.ts` och `browser.ts`. Samma filer ger
   samma plan och rapport ur disken och ur webbläsaren (enhetstest). Kommandots beteende och utskrifter är oförändrade.
2. **Inget annat än kartfiler och banfiler läses eller skickas.** Läsningen sker i webbläsaren; en PDF eller ett foto öppnas
   inte (bara namnet och storleken räknas, och förhandsgranskningen listar dem som "Skickas inte"). En kartfil över
   `CLUB_ARCHIVE_MAP_MAX_BYTES` läses inte heller (`TOO_LARGE_MAP`, bara i webbläsaren) och förhandsgranskningen säger vilken.
3. **Inloggningen i stället för nyckeln.** Webbläsaren anropar `/api/organizer/clubs/{id}/import/check|content/{sha256}|batch`
   med kakan, exakt Origin och CSRF som arrangörens andra skrivningar, och rollen administratör eller ägare (`requireClubRole`).
   Tjänsterna (`importCheck`, `importMapContent`, `importBatch`) är desamma och tar antingen nyckeln eller inloggningen
   (`ImportCaller`). `/api/club-import/` tar fortfarande bara nyckeln. Caddy släpper 80 MB också till den nya kartvägen.
4. **Förhandsgranska, sedan Importera.** Förhandsgranskningen är `--dry-run`: träningar (nya och de som finns, via valfria
   `importKeys` i kontrollfrågan, svaret `knownEntries`), kartor och versioner (att ladda upp och de servern har), banfiler,
   utrymmet mot kontots kvot, det som inte skickas och det att titta på; "Ladda ner rapporten" ger kommandots rapport. Importen
   går i kommandots ordning (kartfilerna, kartornas versioner, träningarna i omgångar om 25) med förlopp och kan avbrytas; den
   är idempotent, så "Importera" igen fortsätter efter ett avbrott eller en stängd flik.
5. **Kryssrutan "Ta inte med ledarens namn ur [hakparenteser]"** är kommandots `--utan-ledare` (samma text och samma förval).
6. **Fliken Import** börjar med importen i webbläsaren; kommandot och importnyckeln ligger hopfällda under "För den som kan Git:
   kommandoraden".

## Följder

- Kartfilen skickas som Blob (strömmade förfrågningar finns bara i Chrome); en post i en zip-fil packas upp i minnet först.
  Hashningen samlar filen i minnet (WebCrypto räknar inte bit för bit), så en karta tar som mest ungefär dubbla gränsen.
- Väljer man en årsmapp direkt (inte mappen ovanför) försvinner året ur sökvägen, precis som i kommandot; hjälpen och fältet
  säger att mappen med årsmapparna ska väljas.
