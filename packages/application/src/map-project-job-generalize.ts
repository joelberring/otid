import { randomUUID } from "node:crypto";
import { MCP_PROPOSAL_MAX_OPERATIONS } from "@o-tid/contracts";
import {
  baseKeys, checkNorm, generalize, objectBox, objectRefFor, type GeneralizeChange, type NormObject, type RevisionEdit
} from "@o-tid/map-revision";
import type { Box, LoadedProjectMap } from "./map-project-job-run";

/**
 * ADR-0219 K6 (del 2): normkontrollen och generaliseringen för AI-kopplingen (MCP), i kartjobben. Samma regler som editorns
 * Worker (`checkNorm`, `generalize`), räknade på projektets karta med ändringarna. Generaliseringen kan lämnas som förslag
 * (högst MCP_PROPOSAL_MAX_OPERATIONS ändringar; ihopfogade linjer hålls ihop med linjerna som gick upp i dem).
 */
export function normObjects(loaded: LoadedProjectMap): NormObject[] {
  const out: NormObject[] = [];
  loaded.objects.forEach((object, index) => {
    const symbol = loaded.base.symbols.get(object.symbol);
    if (!symbol || symbol.hidden) return;
    const width = symbol.kind === "LINE" ? Math.max(0, ...symbol.strokes.map(stroke => stroke.width)) : 0;
    out.push({ key: loaded.keys[index]!, code: symbol.code.text, object, ...(width > 0 ? { lineWidth: width } : {}) });
  });
  return out;
}

const round = (value: number) => Math.round(value * 100) / 100;
const within = (at: { x: number; y: number }, box: Box | undefined) => !box || (at.x >= box.minX && at.x <= box.maxX && at.y >= box.minY && at.y <= box.maxY);

/** Normkontrollen (ISOM 2017-2 eller ISSprOM 2019-2 efter kartans skala) i ett område. */
export function runNormCheck(loaded: LoadedProjectMap, area: Box | undefined) {
  const result = checkNorm(normObjects(loaded), loaded.base.scale);
  const issues = result.issues.filter(issue => within(issue.at, area));
  return { standard: result.standard, scale: loaded.base.scale,
    issues: issues.slice(0, 300).map(issue => ({ rule: issue.rule, key: issue.key, symbol: issue.code, atMm: [round(issue.at.x), round(issue.at.y)],
      value: round(issue.value), limit: round(issue.limit) })), total: issues.length };
}

export interface GeneralizeJobRequest {
  readonly area?: Box | undefined; readonly simplifyMm?: number | undefined; readonly removeSmall?: boolean | undefined;
  readonly joinLines?: boolean | undefined; readonly removeInside?: boolean | undefined; readonly propose?: boolean | undefined;
}

/** Generaliseringens ändringar (sammanfattning och lista) och, med `propose`, förslagets ändringar. */
export function runGeneralizeJob(loaded: LoadedProjectMap, request: GeneralizeJobRequest, now: Date) {
  const options = { simplifyMm: request.simplifyMm ?? 0.1, removeSmall: request.removeSmall ?? true, joinLines: request.joinLines ?? true,
    removeInside: request.removeInside ?? true, within: request.area };
  const result = generalize(normObjects(loaded), loaded.base.scale, options);
  const summary = { simplified: result.simplified, pointsBefore: result.pointsBefore, pointsAfter: result.pointsAfter, removed: result.removed,
    joined: result.joined ?? null, inside: result.inside ?? 0, changes: result.changes.length };
  const list = result.changes.slice(0, 300).map(change => ({ key: change.key, symbol: change.code, reason: change.reason,
    atMm: [round(change.at.x), round(change.at.y)], ...(change.reason === "SIMPLIFY" ? { points: [change.before, change.after] } : {}) }));
  if (!request.propose) return { summary, changes: list };
  if (result.changes.length === 0) return { summary, changes: list, edits: [] as RevisionEdit[] };
  if (result.changes.length > MCP_PROPOSAL_MAX_OPERATIONS) {
    return { summary, changes: list, errors: [`${result.changes.length} ändringar är för många för ett förslag (högst ${MCP_PROPOSAL_MAX_OPERATIONS}); välj ett mindre område.`] };
  }
  return { summary, changes: list, edits: generalizeEdits(loaded, result.changes, now) };
}

function generalizeEdits(loaded: LoadedProjectMap, changes: readonly GeneralizeChange[], now: Date): RevisionEdit[] {
  const baseIndex = new Map(baseKeys(loaded.base).map((key, position) => [key, position]));
  const index = new Map(loaded.keys.map((key, position) => [key, position]));
  const at = now.toISOString();
  const edits: RevisionEdit[] = [];
  let group: RevisionEdit[] = [], ok = true;
  const close = () => { if (ok) edits.push(...group); group = []; ok = true; };
  for (const change of changes) {
    if (change.reason !== "JOINED") close();
    const key = change.key;
    const stored = loaded.states.get(key);
    const basePosition = baseIndex.get(key);
    const ref = stored?.ref ?? (basePosition !== undefined ? objectRefFor(loaded.baseSha256, loaded.base.objects[basePosition]!) : null);
    if (key.startsWith("b:") && !ref) { ok = false; continue; }
    const common = { editId: randomUUID(), key, ref: key.startsWith("b:") ? ref : null, base: stored?.lastEditId ?? null, at };
    if (change.object) { group.push({ ...common, kind: "RESHAPE", state: { kind: "OBJECT", object: change.object } }); continue; }
    const position = index.get(key);
    const box = position !== undefined ? objectBox(loaded.objects[position]!) : undefined;
    group.push({ ...common, kind: "DELETE", state: { kind: "DELETED" }, point: box ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : change.at });
  }
  close();
  return edits;
}
