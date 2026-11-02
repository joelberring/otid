/**
 * BL-profilerna (ADR-0183 beslut 7): förslaget som arrangören godkänner. Varje kartfärg matchas mot tryckeriets rader på
 * namn (färgord och andel), OCAD-id (banläggarstödets färgnummer), CMYK, användning (symbolnummer och om färgen är yta,
 * linje eller punkt) och ordning (vilken sida av banan färgen ligger på i kartan). Resultatet är ett förslag per färg med
 * säkerheten SAFE (säker), CONFIRM (behöver bekräftas) eller AMBIGUOUS (tvetydig: flera rader som ger olika tryck).
 *
 * Inget ändras i kartfilen. Det godkända (`ColorDecision`) sparas i tävlingens kopia av profilen och gäller bara utskriften.
 * Rader med samma CMYK på samma sida av banan (Svart och Väg sidlinje) ger samma tryck och räknas som en; därför blir de
 * aldrig tvetydiga sinsemellan.
 */
import type { ColorUsage } from "@o-tid/map-file";
import { referenceRow, referenceSide, type ReferenceColor, type ReferenceTable } from "./print-reference";
import type { Cmyk100, SourceMapColor } from "./print-profile";

export type MatchConfidence = "SAFE" | "CONFIRM" | "AMBIGUOUS";

/** Kartfärgen med användningen (saknas = används inte av något synligt objekt). */
export interface MatchColor extends SourceMapColor { readonly usage?: ColorUsage | undefined }

export interface ColorProposal {
  readonly color: MatchColor;
  /** Föreslagen rad; `null` = behåll filens färg. */
  readonly row: string | null;
  readonly confidence: MatchConfidence;
  /** Rader att välja mellan, bäst först (för "Välj BL-rad …"). */
  readonly candidates: readonly string[];
  /** Varför, kort på svenska. */
  readonly reasons: readonly string[];
  /** Ingen synlig symbol använder färgen: den ritas inte och behöver inget beslut. */
  readonly unused: boolean;
}

/** Arrangörens beslut för en kartfärg: rad eller `null` (behåll filens). Namnet och CMYK som de var vid beslutet. */
export interface ColorDecision { readonly ocadId: number; readonly name: string; readonly cmyk: Cmyk100; readonly row: string | null }

type Hue = "black" | "brown" | "blue" | "green" | "yellow" | "white" | "violet" | "red" | "all";
interface Component { readonly hue: Hue; readonly percent: number }

const HUES: readonly [RegExp, Hue][] = [
  [/^(svart|black|grå|grått|grey|gray)$/, "black"], [/^(brun|brunt|brown)$/, "brown"], [/^(blå|blått|blue|cyan)$/, "blue"],
  [/^(grön|grönt|green)$/, "green"], [/^(gul|gult|yellow)$/, "yellow"], [/^(vit|vitt|white)$/, "white"],
  [/^(violett|lila|purple|magenta)$/, "violet"], [/^(röd|rött|red)$/, "red"], [/^(alla|all)$/, "all"]
];

/** Namnet i gemener med "%" intill talet och ord avskilda med mellanslag. */
export function normalizeColorName(name: string): string {
  return name.normalize("NFC").toLowerCase().replace(/procent/g, "%").replace(/(\d)\s+%/g, "$1%").replace(/[_\-–—/()+,:;]+/g, " ").replace(/\s+/g, " ").trim();
}

const tokensOf = (name: string) => normalizeColorName(name).split(" ").filter(Boolean);
const percentOf = (token: string | undefined): number | undefined => {
  const match = token ? /^(\d+(?:[.,]\d+)?)%?$/.exec(token) : null;
  if (!match) return undefined;
  const value = Number(match[1]!.replace(",", "."));
  return value >= 0 && value <= 100 ? value : undefined;
};

/** Färgorden med andel ur ett namn: "Grön 100% + 50% Svart" = grön 100, svart 50; utan tal 100 %. */
export function colorComponents(name: string): Component[] {
  const tokens = tokensOf(name);
  const out: Component[] = [];
  const claimed = new Set<number>();
  tokens.forEach((token, index) => {
    const hue = HUES.find(([pattern]) => pattern.test(token))?.[1];
    if (!hue) return;
    let percent: number | undefined;
    const after = percentOf(tokens[index + 1]);
    const before = percentOf(tokens[index - 1]);
    if (after !== undefined && !claimed.has(index + 1)) { percent = after; claimed.add(index + 1); }
    else if (before !== undefined && /%$/.test(tokens[index - 1]!) && !claimed.has(index - 1)) { percent = before; claimed.add(index - 1); }
    if (!out.some(component => component.hue === hue)) out.push({ hue, percent: percent ?? (/^(grå|grått|grey|gray)$/.test(token) ? 30 : 100) });
  });
  return out;
}

const cmykDiff = (a: Cmyk100, b: Cmyk100) => Math.max(Math.abs(a.c - b.c), Math.abs(a.m - b.m), Math.abs(a.y - b.y), Math.abs(a.k - b.k));
const sameCmyk = (a: Cmyk100, b: Cmyk100) => cmykDiff(a, b) <= 0.01;
const hueText: Record<Hue, string> = { black: "svart", brown: "brun", blue: "blå", green: "grön", yellow: "gul", white: "vit", violet: "violett", red: "röd", all: "alla" };
const pct = (value: number) => `${String(Math.round(value * 10) / 10).replace(".", ",")} %`;

interface Scored { readonly row: ReferenceColor; readonly score: number; readonly signals: number; readonly reasons: string[]; readonly exactName: boolean;
  readonly percentMismatch: boolean }

function scoreRow(item: ReferenceColor, color: MatchColor): Scored | undefined {
  const reasons: string[] = [];
  let score = 0, signals = 0, percentMismatch = false;
  const name = normalizeColorName(color.name), rowName = normalizeColorName(item.name);
  const exactName = name === rowName;
  if (exactName) { score += 100; signals += 1; reasons.push("Samma namn som BL:s rad"); }
  else if (rowName.length >= 4 && (name.startsWith(`${rowName} `) || name.endsWith(` ${rowName}`))) { score += 40; signals += 1; reasons.push(`Namnet börjar med ”${item.name}”`); }
  const mine = colorComponents(color.name), theirs = colorComponents(item.name);
  const cmykEqual = item.cmyk !== null && sameCmyk(color.cmyk, item.cmyk);
  if (mine.length > 0 && theirs.length > 0) {
    const shared = mine.filter(component => theirs.some(other => other.hue === component.hue));
    // Olika färgord (brun mot blå), ett färgord för mycket eller för lite (grön + 50 % svart mot grön) eller en andel som
    // skiljer mer än 15 procentenheter (svart 65 % mot svart 100 %) utesluter raden, utom vid samma CMYK (då kan namnet
    // vara på ett annat språk eller beskriva användningen).
    const extra = mine.some(component => component.percent >= 20 && !theirs.some(other => other.hue === component.hue))
      || theirs.some(other => !mine.some(component => component.hue === other.hue));
    const far = shared.some(component => Math.abs(component.percent - theirs.find(other => other.hue === component.hue)!.percent) > 15);
    if ((shared.length === 0 || extra || far) && !cmykEqual) return undefined;
    if (shared.length > 0) {
      const sameSet = shared.length === mine.length && shared.length === theirs.length;
      score += sameSet ? 30 : 10;
      let allPercent = true;
      for (const component of shared) {
        const other = theirs.find(entry => entry.hue === component.hue)!;
        const diff = Math.abs(component.percent - other.percent);
        if (diff <= 0.5) score += 15;
        else { allPercent = false; percentMismatch = true; score -= Math.min(25, diff / 2); }
      }
      if (sameSet && allPercent && !exactName) { signals += 1; reasons.push(`Namnet: ${shared.map(entry => `${hueText[entry.hue]} ${pct(entry.percent)}`).join(" + ")}`); }
      if (percentMismatch) reasons.push(`Namnet säger ${mine.map(entry => `${hueText[entry.hue]} ${pct(entry.percent)}`).join(" + ")}, BL:s rad ${theirs.map(entry => `${hueText[entry.hue]} ${pct(entry.percent)}`).join(" + ")}`);
    }
  }
  const words = (item.hints?.words ?? []).filter(word => name.split(" ").some(token => token.startsWith(word)));
  if (words.length > 0) { score += 20; signals += 1; reasons.push(`Ordet ”${words[0]}” i namnet`); }
  if (item.courseNumber !== undefined && color.ocadId === item.courseNumber) { score += 40; signals += 1; reasons.push(`OCAD-färg ${color.ocadId} = banläggarstödets färgnummer ${item.courseNumber}`); }
  const usage = color.usage;
  if (usage) {
    const codes = item.hints?.codes;
    if (codes && codes.length > 0) {
      const hits = usage.mains.filter(main => codes.includes(main));
      if (hits.length > 0) { score += 25 + Math.min(15, 5 * hits.length); signals += 1; reasons.push(`Används för ${usage.codes.filter(code => hits.includes(Number.parseInt(code, 10))).slice(0, 6).join(", ")}`); }
      else if (usage.mains.length > 0) score -= 15;
    }
    const kinds = item.hints?.kinds;
    if (kinds && usage.kinds.length > 0) {
      const inside = usage.kinds.every(kind => kinds.includes(kind));
      const overlap = usage.kinds.some(kind => kinds.includes(kind));
      if (inside) score += 10; else if (!overlap) score -= 25;
    }
  }
  if (item.cmyk) {
    const diff = cmykDiff(color.cmyk, item.cmyk);
    if (diff <= 0.01) { score += 25; signals += 1; reasons.push("Samma CMYK som BL"); }
    else if (diff <= 5) score += 15;
    else if (diff <= 12) score += 5;
  }
  if (score <= 0) return undefined;
  return { row: item, score, signals, reasons, exactName, percentMismatch };
}

/** Raderna som ger samma tryck: samma CMYK och samma sida av banan. */
const classKey = (table: ReferenceTable, item: ReferenceColor) =>
  item.cmyk ? `${item.cmyk.c}/${item.cmyk.m}/${item.cmyk.y}/${item.cmyk.k}|${referenceSide(table, item)}` : `tom|${item.id}`;

const MIN_SCORE = 30;
const SAFE_SCORE = 70;
const SAFE_MARGIN = 25;
const AMBIGUOUS_MARGIN = 12;

function proposeOne(table: ReferenceTable, color: MatchColor): ColorProposal {
  const unused = !color.usage || color.usage.objects === 0;
  const scored = table.rows.map(item => scoreRow(item, color)).filter((item): item is Scored => item !== undefined
    && (!item.row.retired || item.exactName)).sort((a, b) => b.score - a.score || a.row.row - b.row.row);
  const best = scored[0];
  if (!best || best.score < MIN_SCORE) {
    return { color, row: null, confidence: "CONFIRM", candidates: scored.filter(item => item.row.cmyk).map(item => item.row.id), unused,
      reasons: ["Ingen av BL:s rader passar; förslaget är att behålla filens färg"] };
  }
  if (!best.row.cmyk) {
    return { color, row: null, confidence: "CONFIRM", candidates: scored.filter(item => item.row.cmyk).map(item => item.row.id), unused,
      reasons: [...best.reasons, `BL:s rad ”${best.row.name}” har inga värden (${best.row.comment ?? "tom"}); förslaget är att behålla filens färg`] };
  }
  const bestClass = classKey(table, best.row);
  const other = scored.find(item => item.row.cmyk && classKey(table, item.row) !== bestClass);
  const margin = other ? best.score - other.score : Infinity;
  const candidates = [best.row.id, ...scored.filter(item => item !== best && item.row.cmyk).map(item => item.row.id)];
  let confidence: MatchConfidence;
  const reasons = [...best.reasons];
  if (margin < AMBIGUOUS_MARGIN) {
    confidence = "AMBIGUOUS";
    const close = scored.filter(item => item.row.cmyk && best.score - item.score < AMBIGUOUS_MARGIN).map(item => `”${item.row.name}”`);
    reasons.push(`Flera BL-rader passar och ger olika tryck: ${[...new Set(close)].join(", ")}`);
  } else if (best.percentMismatch) confidence = "CONFIRM";
  else if (best.exactName && margin >= 20) confidence = "SAFE";
  else if (best.score >= SAFE_SCORE && margin >= SAFE_MARGIN && best.signals >= 2) confidence = "SAFE";
  else confidence = "CONFIRM";
  if (best.row.retired) { confidence = "CONFIRM"; reasons.push(`BL: ”${best.row.comment ?? "används inte"}”`); }
  return { color, row: best.row.id, confidence, candidates, reasons, unused };
}

/**
 * Var banan hamnar i kartans färgordning (BL:s regel): direkt över den översta färgen som ligger under banan i tabellen,
 * annars direkt under den understa som ligger över. `position` är ett index i `drawOrder` (0 = underst): färger med
 * `drawOrder >= position` ritas över banan. `null` = inget godkänt att gå efter, banan ritas överst.
 */
export interface CoursePlacement {
  readonly position: number | null;
  readonly above: ReadonlySet<number>;
  /** Färger som enligt tabellen ska ligga på andra sidan banan än de gör i kartan. */
  readonly conflicts: readonly { readonly color: SourceMapColor; readonly row: ReferenceColor; readonly wanted: "OVER" | "UNDER" }[];
}

export function coursePlacement(table: ReferenceTable, colors: readonly SourceMapColor[], rowOf: (color: SourceMapColor) => string | null | undefined): CoursePlacement {
  const sides = colors.map(color => {
    const id = rowOf(color);
    const item = id ? referenceRow(table, id) : undefined;
    return { color, item, side: item ? referenceSide(table, item) : undefined };
  });
  const sided = sides.filter(entry => entry.side === "OVER" || entry.side === "UNDER");
  if (sided.length === 0) return { position: null, above: new Set(), conflicts: [] };
  // Platsen med minst fel (färger på fel sida); källans uttryckliga regler väger tre gånger, lika bra = högre upp.
  const explicit = new Set([...table.courseBelow, ...table.courseAbove]);
  let position = colors.length, cost = Infinity;
  for (let candidate = colors.length; candidate >= 0; candidate -= 1) {
    let sum = 0;
    for (const entry of sided) {
      const wrong = entry.side === "OVER" ? entry.color.drawOrder < candidate : entry.color.drawOrder >= candidate;
      if (wrong) sum += explicit.has(entry.item!.id) ? 3 : 1;
    }
    if (sum < cost) { cost = sum; position = candidate; }
  }
  const above = new Set(colors.filter(color => color.drawOrder >= position).map(color => color.ocadId));
  const conflicts = sides.filter(entry => entry.item && ((entry.side === "OVER" && entry.color.drawOrder < position) || (entry.side === "UNDER" && entry.color.drawOrder >= position)))
    .map(entry => ({ color: entry.color, row: entry.item!, wanted: entry.side as "OVER" | "UNDER" }));
  return { position, above, conflicts };
}

/**
 * Förslaget för alla kartfärger, i kartans ordning (överst först, som OCAD:s färgtabell). Ordningen prövas sist: en säker
 * färg som enligt tabellen ska ligga på andra sidan banan än den gör i kartan behöver bekräftas.
 */
export function proposeColorMatches(table: ReferenceTable, colors: readonly MatchColor[]): ColorProposal[] {
  const first = [...colors].sort((a, b) => b.drawOrder - a.drawOrder).map(color => proposeOne(table, color));
  const safe = new Map(first.filter(item => item.confidence === "SAFE" && !item.unused).map(item => [item.color.ocadId, item.row]));
  const placement = coursePlacement(table, colors, color => safe.get(color.ocadId));
  const wrong = new Map(placement.conflicts.map(conflict => [conflict.color.ocadId, conflict]));
  return first.map(item => {
    const conflict = wrong.get(item.color.ocadId);
    if (!conflict) return item;
    return { ...item, confidence: "CONFIRM", reasons: [...item.reasons, `Ligger ${conflict.wanted === "OVER" ? "under" : "över"} banans plats i kartans färgordning, men BL:s ”${conflict.row.name}” ligger ${conflict.wanted === "OVER" ? "över" : "under"} banan`] };
  });
}

/** Beslutet för en färg om det fortfarande gäller (samma OCAD-id och namn). */
export function decisionFor(decisions: readonly ColorDecision[] | undefined, color: Pick<SourceMapColor, "ocadId" | "name">): ColorDecision | undefined {
  return decisions?.find(item => item.ocadId === color.ocadId && item.name === color.name);
}

/** Beslut som inte längre hittar sin färg (kartfilen har bytts eller färgen döpts om). */
export function staleDecisions(decisions: readonly ColorDecision[] | undefined, colors: readonly Pick<SourceMapColor, "ocadId" | "name">[]): ColorDecision[] {
  return (decisions ?? []).filter(item => !colors.some(color => color.ocadId === item.ocadId && color.name === item.name));
}

/** Ett beslut (ersätter ett tidigare för samma färg). */
export function withDecision(decisions: readonly ColorDecision[] | undefined, color: Pick<SourceMapColor, "ocadId" | "name" | "cmyk">, row: string | null): ColorDecision[] {
  const rest = (decisions ?? []).filter(item => item.ocadId !== color.ocadId);
  return [...rest, { ocadId: color.ocadId, name: color.name, cmyk: color.cmyk, row }];
}

/** "Godta alla säkra": de säkra förslagen som inte redan är beslutade (oanvända färger behöver inget beslut). */
export function acceptSafe(decisions: readonly ColorDecision[] | undefined, proposals: readonly ColorProposal[]): ColorDecision[] {
  let out = [...(decisions ?? [])];
  for (const proposal of proposals) {
    if (proposal.unused || proposal.confidence !== "SAFE" || decisionFor(out, proposal.color)) continue;
    out = withDecision(out, proposal.color, proposal.row);
  }
  return out;
}

/** Använda färger som ännu inte har ett beslut som gäller. */
export function pendingProposals(proposals: readonly ColorProposal[], decisions: readonly ColorDecision[] | undefined): ColorProposal[] {
  return proposals.filter(proposal => !proposal.unused && !decisionFor(decisions, proposal.color));
}
