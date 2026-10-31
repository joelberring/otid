/** Steg 61: kartor till starten – tryckantal, kartbuntslistan och baksidorna. */
import type { MapPrintChangeDto } from "@o-tid/contracts";

const variantName = (code: string | null) => code ?? "ingen variant";
const maps = (count: number) => count === 1 ? "1 karta" : `${count} kartor`;

export const mapBundlesSv = {
  title: "Kartor till starten",
  pageHelp: "Kartorna trycks i Purple Pen eller OCAD. Här står hur många kartor varje variant behöver, i vilken ordning de ska ligga vid starten och vilken löpare som får vilken karta.",
  back: "Tillbaka till arbetsytan",
  loading: "Läser in kartorna …",
  loadError: "Kartorna kunde inte läsas in. Försök igen.",
  retry: "Försök igen",
  link: "Kartor till starten",
  linkHelp: "Tryckantal per variant, kartbuntslistan och baksidor per löpare.",
  views: { COUNTS: "Tryckantal", BUNDLE: "Kartbuntslista", BACKS: "Baksidor" },
  // Tryckantal
  countsTitle: "Tryckantal per variant",
  countsHelp: "Löpare med varianten, lediga starttider (så att efteranmälda får en karta) och reserv.",
  reserve: "Reserv per variant",
  reserveKinds: { PERCENT: "procent", COUNT: "kartor" },
  reserveSave: "Spara reserven",
  reserveSaved: "Reserven är sparad.",
  reserveError: "Reserven kunde inte sparas. Försök igen.",
  reserveInvalid: "Ange ett heltal mellan 0 och 1000.",
  course: "Bana", variant: "Variant", runners: "Löpare", vacancies: "Lediga tider", reserveColumn: "Reserv", print: "Att trycka",
  noVariant: "–",
  total: "Totalt",
  missingVariantTitle: (count: number) => count === 1 ? "1 löpare saknar variant och får ingen karta än" : `${count} löpare saknar variant och får ingen karta än`,
  missingVariantHelp: "Fördela gafflingarna under Klasser först.",
  // Kartbuntslistan
  bundleTitle: "Kartbuntslista",
  bundleHelp: "Kartorna i den ordning de ska ligga vid starten.",
  orderLabel: "Ordning",
  order: { TIME: "Per starttid", CLASS: "Per klass och variant (masstart)" },
  number: "Nr", name: "Namn", club: "Klubb", className: "Klass", startTime: "Start",
  vacant: "Ledig tid",
  freeStart: "Fri start",
  bundleEmpty: "Inga kartor att lägga ut än.",
  printList: "Skriv ut",
  csv: "Spara som CSV",
  csvHeader: ["Nr", "Starttid", "Klass", "Bana", "Variant", "Namn", "Klubb"],
  csvFile: "kartbuntslista",
  printedAt: (time: string) => `Utskriven ${time}`,
  notPrinted: "Inte utskriven än.",
  changesSince: (count: number, time: string) => count === 1 ? `1 ändring sedan listan skrevs ut ${time}` : `${count} ändringar sedan listan skrevs ut ${time}`,
  noChanges: (time: string) => `Inga ändringar sedan listan skrevs ut ${time}.`,
  printChanged: "Listan har ändrats sedan den lästes in. Den är inläst igen; titta på ändringarna och skriv ut en gång till.",
  printError: "Utskriften kunde inte sparas. Försök igen.",
  change: (change: MapPrintChangeDto, clock: (instant: string | null) => string): string => {
    switch (change.kind) {
      case "ADDED": return `Ny: ${change.name} (${change.className}${change.variantCode ? `, ${change.variantCode}` : ""})`;
      case "REMOVED": return `Borttagen: ${change.name} (${change.className})`;
      case "VARIANT": return `${change.name} (${change.className}): ${variantName(change.from)} → ${variantName(change.to)}`;
      case "CLASS": return `${change.name}: ${change.from} → ${change.to}`;
      case "START_TIME": return `${change.name} (${change.className}): start ${clock(change.from)} → ${clock(change.to)}`;
      case "COUNT": return `${change.courseName}${change.variantCode ? ` ${change.variantCode}` : ""}: ${maps(change.from)} → ${maps(change.to)}`;
      case "NUMBERS": return change.count === 1 ? "1 löpare har fått nytt nummer" : `${change.count} löpare har fått nya nummer`;
    }
  },
  // Baksidorna
  backsTitle: "Baksidor per löpare",
  backsHelp: "En sida per karta i samma ordning som kartbunten för varianten, med reservsidor så att antalet sidor är tryckantalet. Kör den tryckta bunten genom skrivaren igen för baksidan, eller använd sidan som omslag.",
  paper: "Papper",
  papers: { A4: "A4", A3: "A3" },
  orientation: "Riktning",
  orientations: { portrait: "Stående", landscape: "Liggande" },
  position: "Textens läge",
  positions: { TOP_LEFT: "Uppe till vänster", TOP_RIGHT: "Uppe till höger", CENTER: "I mitten", BOTTOM_LEFT: "Nere till vänster", BOTTOM_RIGHT: "Nere till höger" },
  mirror: "Spegla för baksida (texten hamnar bakom samma hörn på kartan)",
  testPage: "Skriv ut en provsida",
  printBacks: "Skriv ut baksidorna",
  testPageText: "Provsida – texten hamnar här",
  divider: (variant: string | null, count: number) => `${variant ? `Variant ${variant}` : "Utan variant"} · ${maps(count)}`,
  dividerHelp: (variant: string | null) => `Lägg kartbunt ${variant ?? "utan variant"} här`,
  reservePage: (variant: string | null) => variant ? `Reserv · variant ${variant}` : "Reserv",
  vacantPage: (time: string) => `Ledig tid ${time}`,
  pages: (count: number) => count === 1 ? "1 sida" : `${count} sidor`
} as const;
