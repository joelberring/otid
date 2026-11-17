/**
 * Översynen av första kartan 2026-11-17: kopplingen till Lantmäteriet – kontots läge, beskedet när en hämtning inte går och
 * produkterna att beställa. Produkternas namn stavas som i koden (`map-project-laser.ts`, `map-project-lantmateriet.ts`).
 * Samma ord i guiden, steg 1, laserkörningarna, projektsidan, Mitt konto och hjälpartikeln «Så kopplar du Lantmäteriet».
 */
export const lantmaterietSv = {
  howTo: "Så kopplar du Lantmäteriet",
  account: "Mitt konto",
  /** Kontots läge innan man tryckt (guidens första delsteg och projektsidans Nästa steg). */
  needs: "Laserdatan till grundkartan hämtas från Lantmäteriet med ditt eget konto där.",
  status: {
    connected: "Lantmäteriet: kopplat. Uppgifterna prövas första gången du hämtar.",
    missing: "Lantmäteriet: inte kopplat än.",
    unreadable: "Lantmäteriet: uppgifterna behöver sparas igen.",
    server: "Lantmäteriet: kan inte kopplas på den här installationen."
  },
  /** Beskedet när det syns att hämtningen inte kan gå, eller när Lantmäteriet sa nej. */
  problems: {
    missing: "Lantmäteriet är inte kopplat än: ditt konto i O-Tid har inga uppgifter till Lantmäteriet. Lägg in dem under Mitt konto, ladda om den här sidan och försök igen.",
    unreadable: "Uppgifterna till Lantmäteriet går inte att använda längre, eftersom serverns nyckel har bytts sedan de sparades. Spara dem igen under Mitt konto och försök igen.",
    server: "Den här installationen av O-Tid kan inte spara uppgifter till Lantmäteriet. Kontakta den som driftar O-Tid. Under tiden går OpenStreetMap och egna filer att använda.",
    rejected: {
      laser: "Lantmäteriet sa nej till hämtningen. Antingen stämmer inte uppgifterna, eller så är Laserdata Nedladdning, skog inte beställd för ditt konto på Geotorget; "
        + "O-Tid kan inte se vilket. Kontrollera båda och försök igen.",
      ortho: "Lantmäteriet sa nej till hämtningen. Antingen stämmer inte uppgifterna, eller så är produkten inte beställd för ditt konto på Geotorget: Ortofoto Nedladdning, "
        + "eller för äldre bilder Ortofoto historiska Nedladdning. O-Tid kan inte se vilket. Kontrollera och försök igen."
    }
  },
  /** Produkterna (Mitt konto). */
  products: {
    heading: "Produkter att beställa på Geotorget",
    help: "Varje produkt beställs för sig. Bara laserdatan behövs för att ta fram en första karta med guiden.",
    columns: { product: "Produkt", use: "Används till", first: "Första kartan" },
    needed: "Behövs",
    optional: "Valfri",
    rows: [
      { product: "Laserdata Nedladdning, skog", use: "Grundkartan i guiden: kurvor, branter, kärr och grönt.", first: true },
      { product: "Ortofoto Nedladdning", use: "Flygbilder att rita efter (Ortofoto från Lantmäteriet).", first: false },
      { product: "Ortofoto historiska Nedladdning", use: "Äldre flygbilder; en egen produkt.", first: false },
      { product: "Marktäcke, Byggnad och Fastighetsindelning", use: "Läses med laserdatan när kontot har dem: mark, hus och tomter.", first: false }
    ]
  }
};
