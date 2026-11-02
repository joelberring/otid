/**
 * BL-profilerna (ADR-0183 beslut 7): förhandskontrollen för en profil med tryckeritabell. Den ändrar ingenting och säger:
 * - obekräftade färger (används i kartan men inte godkända) och beslut som inte längre hittar sin färg: varning;
 * - passmärkesfärgen ("Alla färger") i bruk: blockerande (BL tillåter den inte); oanvänd: information;
 * - banans violett med andra värden än tabellen: varning;
 * - ordningen: färger som enligt tabellen ska ligga över banan men ligger under den i kartan (och tvärtom) när banan läggs
 *   i tabellens ordning; uttryckliga regler i källan som varning, övriga som information.
 */
import { coursePlacement, decisionFor, pendingProposals, proposeColorMatches, staleDecisions } from "./color-match";
import { referenceRow, type ReferenceTable } from "./print-reference";
import type { PreflightFinding, PrintProfile, SourceMapColor } from "./print-profile";

const cmykText = (cmyk: { c: number; m: number; y: number; k: number }) => `${cmyk.c}/${cmyk.m}/${cmyk.y}/${cmyk.k}`;
const listText = (names: readonly string[]) => names.length <= 6 ? names.join(", ") : `${names.slice(0, 6).join(", ")} och ${names.length - 6} till`;

export function referencePreflight(profile: PrintProfile, table: ReferenceTable, colors: readonly SourceMapColor[]): { findings: PreflightFinding[]; unconfirmed: string[] } {
  const findings: PreflightFinding[] = [];
  const known = colors.some(color => color.usage !== undefined);
  const proposals = proposeColorMatches(table, colors);
  const decisions = profile.colorDecisions ?? [];
  // Utan användningen (äldre klient) räknas alla färger som använda.
  const pending = known ? pendingProposals(proposals, decisions) : proposals.filter(proposal => !decisionFor(decisions, proposal.color));
  const unconfirmed = pending.map(proposal => proposal.color.name);
  if (decisions.length === 0) {
    findings.push({ severity: "WARNING", text: `Förslaget för ${table.title} är inte godkänt: kartans färger skrivs som i filen. Godkänn förslaget under Utskriftsprofil.` });
  } else if (pending.length > 0) {
    findings.push({ severity: "WARNING", text: `${pending.length} ${pending.length === 1 ? "färg är" : "färger är"} inte bekräftade och skrivs som i filen: ${listText(unconfirmed)}.` });
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
    const rowOf = (color: SourceMapColor) => decisionFor(decisions, color)?.row;
    const placement = coursePlacement(table, colors, rowOf);
    if (placement.position === null) findings.push({ severity: "INFO", rule: "order", text: "Banan ritas överst tills kartans färger är godkända (ordningen går efter dem)." });
    const explicit = new Set([...table.courseBelow, ...table.courseAbove]);
    for (const conflict of placement.conflicts) {
      if (!conflict.color.usage && known) continue;
      findings.push({ severity: explicit.has(conflict.row.id) ? "WARNING" : "INFO", rule: "order",
        text: `”${conflict.color.name}” (BL: ${conflict.row.name}) ska ligga ${conflict.wanted === "OVER" ? "över" : "under"} banan men ligger ${conflict.wanted === "OVER" ? "under" : "över"} den i kartans färgordning; kartfilen ändras inte.` });
    }
  } else if (table.courseBelow.length > 0) {
    findings.push({ severity: "INFO", rule: "order", text: `Banan ritas överst. ${table.title} vill ha den under ${table.courseBelow.map(id => referenceRow(table, id)?.name ?? id).join(", ")}.` });
  }
  return { findings, unconfirmed };
}
