/**
 * ADR-0219: skriv en ändringssats till en ny fil och kontrollera den. Det här är den enda vägen som appen använder för att
 * lämna ut en reviderad fil: `applyMapRevision` skriver och kontrollerar, och vägrar om kontrollen hittar något.
 * Mapper (.omap/.xmap) skrivs; OCAD vägras tills K7.
 */
import { MapFileError } from "../model";
import { readOmap } from "../omap/read";
import { findConflicts, type ByteEdit, type MapRevisionApplyResult, type MapRevisionChangeSet, type MapRevisionRefusal } from "./change-set";
import { scanParts, ScanError } from "./omap-scan";
import { verifyOmap } from "./omap-verify";
import { planOmapRevision, type PlannedEdit } from "./omap-write";
import { sha256Hex } from "./sha256";

const fail = (code: MapRevisionRefusal["code"], message: string): MapRevisionApplyResult => ({ ok: false, refusals: [{ code, message }] });
const isOcd = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0xad && bytes[1] === 0x0c;

/** UTF-8-längden av `text[start, end)` (ett surrogatpar är fyra byte). */
function utf8Length(text: string, start: number, end: number): number {
  let length = 0;
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < end) { length += 4; i++; }
    else length += 3;
  }
  return length;
}

/** Byter intervallen i texten och räknar ut byteintervallen i originalet och den nya filen. */
function applyEdits(text: string, edits: readonly PlannedEdit[], offset: number): { text: string; byteEdits: ByteEdit[]; replacedBytes: number } | null {
  let out = "", at = 0, oldByte = offset, newByte = offset, replacedBytes = 0;
  const byteEdits: ByteEdit[] = [];
  for (const edit of edits) {
    if (edit.start < at) return null;
    const before = utf8Length(text, at, edit.start);
    oldByte += before;
    newByte += before;
    const removed = utf8Length(text, edit.start, edit.end), inserted = utf8Length(edit.text, 0, edit.text.length);
    byteEdits.push({ start: oldByte, end: oldByte + removed, newStart: newByte, newEnd: newByte + inserted, what: edit.what });
    replacedBytes += removed;
    oldByte += removed;
    newByte += inserted;
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return { text: out + text.slice(at), byteEdits, replacedBytes };
}

/**
 * Lappar `original` med ändringarna och kontrollerar resultatet. `original` ändras aldrig; de nya bytesen sparas som en ny
 * kartversion bredvid originalet. En tom sats ger en kopia som är byte för byte lik originalet.
 */
export function applyMapRevision(original: Uint8Array, changeSet: MapRevisionChangeSet): MapRevisionApplyResult {
  const baseSha = sha256Hex(original);
  if (baseSha !== changeSet.baseFileSha256) return fail("BASE_MISMATCH", "Filen är inte grundfilen som ändringarna gjordes på.");
  if ((changeSet.format === "OCD") !== isOcd(original)) return fail("BASE_MISMATCH", "Filen har inte ändringssatsens format.");
  const conflicts = findConflicts(changeSet.changes);
  if (conflicts.length > 0) {
    return { ok: false, refusals: conflicts.map(([first, second]) => ({ code: "CONFLICT" as const, change: second,
      message: `Ändring ${second + 1} gäller samma objekt som ändring ${first + 1}.` })) };
  }
  if (changeSet.format === "OCD") return fail("UNSUPPORTED_VERSION", "OCAD-revidering kommer senare (K7).");

  const bom = original.length >= 3 && original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf ? 3 : 0;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original.subarray(bom));
  } catch {
    return fail("UNSAFE_FILE", "Mapper-filen är inte giltig UTF-8.");
  }
  let map, raw;
  try {
    map = readOmap(text, { sources: true });
    raw = scanParts(text);
  } catch (error) {
    if (error instanceof MapFileError || error instanceof ScanError) return fail("UNSAFE_FILE", error.message);
    throw error;
  }
  const elementCount = raw?.parts.reduce((sum, part) => sum + part.elements.length, 0) ?? 0;
  const report = { format: "OMAP" as const, version: map.version, baseFileSha256: baseSha };
  if (changeSet.changes.length === 0) {
    return { ok: true, bytes: original.slice(), report: { ...report, resultSha256: baseSha, modified: 0, added: 0, deleted: 0, addedObjects: [],
      edits: [], verification: { untouchedObjects: elementCount, checkedObjects: 0, identicalBytes: original.length } } };
  }
  const planned = planOmapRevision(text, map, raw, changeSet);
  if (!planned.ok) return { ok: false, refusals: planned.refusals };
  const { plan } = planned;
  const applied = applyEdits(text, plan.edits, bom);
  if (!applied) return fail("VERIFY_FAILED", "Kontrollen efter skrivningen: två ändringar överlappar i filen.");
  const verified = verifyOmap(text, raw, applied.text, plan);
  if (!verified.ok) return fail("VERIFY_FAILED", verified.message);
  const encoded = new TextEncoder().encode(applied.text);
  const bytes = new Uint8Array(bom + encoded.length);
  bytes.set(original.subarray(0, bom));
  bytes.set(encoded, bom);
  return { ok: true, bytes, report: { ...report, resultSha256: sha256Hex(bytes), modified: plan.modified, added: plan.added, deleted: plan.deleted,
    addedObjects: verified.added, edits: applied.byteEdits,
    verification: { untouchedObjects: verified.untouched, checkedObjects: verified.checked, identicalBytes: original.length - applied.replacedBytes } } };
}
