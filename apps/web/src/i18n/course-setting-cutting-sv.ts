import { plural } from "./plural";

/** Ringklipp i banläggningen (ADR-0180 beslut 10). */
export const courseSettingCuttingSv = {
  heading: "Ringklipp",
  overlap: "Klipp ringar där de överlappar",
  overlapHelp: "Där två ringar på samma karta går in i varandra tas bågen inne i den andra bort, så att konturen syns.",
  details: "Klipp ringar över viktiga detaljer",
  detailsHelp: "Ringen klipps där den täcker stigar, branter, staket, bäckar och små punktobjekt, högst en fjärdedel av ringen.",
  noMap: "Klipp över detaljer kräver kartfilen.",
  computing: "Räknar klippen …",
  failed: "Klippen över detaljer kunde inte räknas ur kartfilen. Ringarna ritas hela.",
  bake: "Gör klippen fasta (för Purple Pen)",
  bakeHelp: "Klippen över detaljer sparas då i kontrollerna och följer med i .ppen-filen. Överlappsklippen beror på banan och sparas inte.",
  baked: (count: number) => count === 0 ? "Klippen var redan fasta." : `${plural(count, "kontroll", "kontroller")} fick fasta klipp.`
};
