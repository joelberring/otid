/**
 * BL-profilerna (ADR-0183 beslut 7): förhandskontrollen för en profil med tryckeritabell. Den ändrar ingenting och säger:
 * - obekräftade färger (används i kartan men inte godkända) och beslut som inte längre hittar sin färg: varning;
 * - passmärkesfärgen ("Alla färger") i bruk: blockerande (BL tillåter den inte); oanvänd: information;
 * - banans violett med andra värden än tabellen: varning;
 * - ordningen: färger som enligt tabellen ska ligga över banan men ligger under den i kartan (och tvärtom) när banan läggs
 *   i tabellens ordning; uttryckliga regler i källan som varning, övriga som information.
 */
import type { ColorUsage } from "@o-tid/map-file";
import { decisionFor, pendingProposals, proposeColorMatches, staleDecisions } from "./color-match";
import { pressOrder, type PressColorKind, type PressNorm } from "./press-order";
import { referenceRow, referenceSide, type ReferenceTable } from "./print-reference";
import { effectiveSourceMapColors, mapColorAdjust, type PreflightFinding, type PrintProfile, type SourceMapColor } from "./print-profile";

/** Fyndet om färger som inte är godkända i förslaget; sidan visar det på en egen rad och upprepar det inte i listan. */
export const UNCONFIRMED_RULE = "unconfirmed-colors";

const cmykText = (cmyk: { c: number; m: number; y: number; k: number }) => `${cmyk.c}/${cmyk.m}/${cmyk.y}/${cmyk.k}`;
const listText = (names: readonly string[]) => names.length <= 6 ? names.join(", ") : `${names.slice(0, 6).join(", ")} och ${names.length - 6} till`;

const NORM_OVER_KINDS: Readonly<Record<PressNorm, ReadonlySet<PressColorKind>>> = {
  ISOM: new Set(["BLACK", "BLUE_LINE", "BROWN", "MAGENTA"]),
  ISSPROM: new Set(["BLACK", "BLACK_BUILDING", "BLACK_ROAD_EDGE", "GREEN_POINT", "MAGENTA"])
};

function effectiveFromSource(profile: PrintProfile, colors: readonly SourceMapColor[]): SourceMapColor[] {
  const adjust = mapColorAdjust(profile, colors.map(color => ({ id: color.ocadId, name: color.name })));
  const usage = new Map<number, ColorUsage>();
  for (const color of colors) if (color.usage) usage.set(color.ocadId, color.usage);
  const maxOrder = colors.reduce((max, color) => Math.max(max, color.drawOrder), 0);
  const mapColors = colors.map(color => ({
    id: color.ocadId,
    name: color.name,
    rank: maxOrder - color.drawOrder,
    cmyk: { c: color.cmyk.c / 100, m: color.cmyk.m / 100, y: color.cmyk.y / 100, k: color.cmyk.k / 100 },
    ...(color.overprint ? { spot: { name: color.name, overprint: true } } : {})
  }));
  return effectiveSourceMapColors(mapColors, usage.size > 0 ? usage : undefined, adjust);
}

export function referencePreflight(profile: PrintProfile, table: ReferenceTable, colors: readonly SourceMapColor[]): { findings: PreflightFinding[]; unconfirmed: string[] } {
  const findings: PreflightFinding[] = [];
  const known = colors.some(color => color.usage !== undefined);
  const proposals = proposeColorMatches(table, colors);
  const decisions = profile.colorDecisions ?? [];
  // Utan användningen (äldre klient) räknas alla färger som använda.
  const pending = known ? pendingProposals(proposals, decisions) : proposals.filter(proposal => !decisionFor(decisions, proposal.color));
  const unconfirmed = pending.map(proposal => proposal.color.name);
  if (decisions.length === 0) {
    findings.push({ severity: "WARNING", rule: UNCONFIRMED_RULE, text: `Förslaget för ${table.title} är inte godkänt: kartans färger skrivs som i filen. Godkänn förslaget under Färger för tryck.` });
  } else if (pending.length > 0) {
    findings.push({ severity: "WARNING", rule: UNCONFIRMED_RULE, text: `${pending.length} ${pending.length === 1 ? "färg är inte bekräftad" : "färger är inte bekräftade"} och skrivs som i filen: ${listText(unconfirmed)}.` });
  }
  const stale = staleDecisions(decisions, colors);
  if (stale.length > 0) findings.push({ severity: "WARNING", text: `Kartfilen har ändrats sedan godkännandet; ${stale.length} beslut gäller inte längre (${listText(stale.map(item => item.name))}).` });

  // Passmärket: på namn eller exakt 100/100/100/100 (ett godkänt beslut går före).
  const registration = table.rows.find(item => item.role === "REGISTRATION");
  for (const color of colors) {
    const decided = decisionFor(decisions, color);
    const proposed = proposals.find(proposal => proposal.color.ocadId === color.ocadId);
    const isRegistration = decided ? decided.row !== null && referenceRow(table, decided.row)?.role === "REGISTRATION"
      : (registration !== undefined && proposed?.row === registration.id) || (color.cmyk.c >= 99.99 && color.cmyk.m >= 99.99 && color.cmyk.y >= 99.99 && color.cmyk.k >= 99.99);
    if (!isRegistration) continue;
    const objects = color.usage?.objects ?? 0;
    if (objects > 0) findings.push({ severity: "BLOCKING", rule: "registration", text: `Passmärkesfärgen ”${color.name}” (CMYK ${cmykText(color.cmyk)}) används av ${objects} objekt; BL tillåter den inte i filer till tryck. Ta bort objekten i kartan.` });
    else if (known) findings.push({ severity: "INFO", rule: "registration", text: `Passmärkesfärgen ”${color.name}” finns i kartan men används inte och kommer inte med i PDF:en (BL vill att oanvända färger tas bort ur kartfilen).` });
  }

  const course = referenceRow(table, table.courseRow);
  if (course?.cmyk && cmykText(course.cmyk) !== cmykText(profile.course.cmyk)) {
    findings.push({ severity: "WARNING", rule: "course", text: `Banans violett ska vara ${cmykText(course.cmyk)} enligt ${table.title}, profilen har ${cmykText(profile.course.cmyk)}.` });
  }

  if (profile.courseLayer === "REFERENCE") {
    const norm: PressNorm = profile.pressNorm ?? (table.kind === "SPRINT" ? "ISSPROM" : "ISOM");
    const effective = effectiveFromSource(profile, colors);
    const order = pressOrder(effective, norm);
    if (order.over.size === 0) {
      findings.push({ severity: "INFO", rule: "order", text: "Banan ritas överst eftersom ingen använd kartfärg hamnar över banan i normens ordning." });
    } else {
      const explicit = new Set([...table.courseBelow, ...table.courseAbove]);
      const byId = new Map(order.classes.map(item => [item.ocadId, item]));
      for (const color of effective) {
        if (!color.usage && known) continue;
        const cls = byId.get(color.ocadId);
        if (!cls || cls.kind === "WHITE") continue;
        const normSide = NORM_OVER_KINDS[norm].has(cls.kind) ? "OVER" : "UNDER";
        // Färger som ligger på normens rätta sida (t.ex. blått och brunt under banan i ISSprOM) är aldrig ordningsfel.
        if (cls.side === normSide) continue;
        const rowId = decisionFor(decisions, color)?.row;
        const row = rowId ? referenceRow(table, rowId) : undefined;
        if (!row) continue;
        const wanted = referenceSide(table, row);
        if (wanted === "COURSE" || wanted === cls.side) continue;
        findings.push({ severity: explicit.has(row.id) ? "WARNING" : "INFO", rule: "order",
          text: `”${color.name}” (BL: ${row.name}) ska ligga ${wanted === "OVER" ? "över" : "under"} banan men ligger ${cls.side === "OVER" ? "över" : "under"} den i kartans färgordning; kartfilen ändras inte.` });
      }
    }
  } else if (table.courseBelow.length > 0) {
    findings.push({ severity: "INFO", rule: "order", text: `Banan ritas överst. ${table.title} vill ha den under ${table.courseBelow.map(id => referenceRow(table, id)?.name ?? id).join(", ")}.` });
  }
  return { findings, unconfirmed };
}
