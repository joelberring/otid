/**
 * Export av enbart ändringar som kompakt `.ocd`-fil (`ocdChangesFile`):
 * OCAD-motsvarigheten till `mapperChangesFile` för att kartritaren enkelt ska kunna importera reviderade objekt
 * rakt in i sin masterkarta i OCAD Desktop (`File → Import → OCAD file`) med exakt georeferens, färger och symboler.
 */
import { MapFileError, type MapGeoreference, type ParsedMap } from "../../model";
import { findConflicts, type MapRevisionChangeSet, type MapRevisionRefusal } from "../../revision/change-set";
import { sha256Hex } from "../../revision/sha256";
import type { MapSymbolColorChange } from "../../revision/symbol-colors";
import type { SymbolReplacement } from "../../revision/symbol-replace";
import type { MapTextSymbolChange } from "../../revision/text-symbols";
import { readOcd } from "../read";
import { applyOcdColors, updateOcdScalePar, type OcdColorEdit } from "./ocd-colors-write";
import { parseOcdDocument, type OcdDocument } from "./ocd-document";
import { applyOcdRevisionToDocument } from "./ocd-objects-write";
import { packOcdDocument, verifyOcdDocument } from "./ocd-pack";
import { applyOcdNormSymbols, applyOcdSymbolColors, applyOcdTextSymbols } from "./ocd-symbols-write";

export interface OcdChangesExportOptions {
  /** Valfria färgändringar att baka in i ändringsfilens färgtabell. */
  readonly colors?: readonly OcdColorEdit[] | undefined;
  /** Valfria symbolfärgsändringar att baka in i ändringsfilens symboltabell. */
  readonly symbolColors?: readonly MapSymbolColorChange[] | undefined;
  /** Valfria ändrade/nya textsymboler att baka in i ändringsfilens symboltabell. */
  readonly textSymbols?: readonly MapTextSymbolChange[] | undefined;
  /** Valfria normsymboltillägg/-utbyten att baka in i ändringsfilens symboltabell. */
  readonly normSymbols?: readonly SymbolReplacement[] | undefined;
  /** Valfri uppdaterad georeferens (`si_ScalePar` typ 1039). */
  readonly georeference?: MapGeoreference | null | undefined;
  readonly scale?: number | undefined;
}

export type OcdChangesExportResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly added: number; readonly modified: number; readonly skippedDeleted: number }
  | { readonly ok: false; readonly refusals: readonly MapRevisionRefusal[] };

const fail = (code: MapRevisionRefusal["code"], message: string): OcdChangesExportResult =>
  ({ ok: false, refusals: [{ code, message }] });

/**
 * Bygger en kompakt `.ocd`-fil med grundkartans huvud, färgtabell (inkl. ev. färgändringar), georeferens
 * (`si_ScalePar` + visnings-/utskriftssträngar), symboltabell och **enbart tillagda och ändrade objekt**.
 */
export function ocdChangesFile(
  sourceBytes: Uint8Array,
  changeSet: MapRevisionChangeSet,
  options: OcdChangesExportOptions = {}
): OcdChangesExportResult {
  const baseSha = sha256Hex(sourceBytes);
  if (baseSha !== changeSet.baseFileSha256) {
    return fail("BASE_MISMATCH", "Filen är inte grundfilen som ändringarna gjordes på.");
  }
  if (changeSet.format !== "OCD") {
    return fail("BASE_MISMATCH", "Filen har inte ändringssatsens format.");
  }
  const conflicts = findConflicts(changeSet.changes);
  if (conflicts.length > 0) {
    return {
      ok: false,
      refusals: conflicts.map(([first, second]) => ({
        code: "CONFLICT" as const,
        change: second,
        message: `Ändring ${second + 1} gäller samma objekt som ändring ${first + 1}.`
      }))
    };
  }

  let doc: OcdDocument;
  let sourceMap: ParsedMap;
  try {
    doc = parseOcdDocument(sourceBytes);
    sourceMap = readOcd(sourceBytes, { sources: true });
  } catch (error) {
    if (error instanceof MapFileError) {
      return fail(error.code === "UNSUPPORTED_VERSION" ? "UNSUPPORTED_VERSION" : "UNSAFE_FILE", error.message);
    }
    throw error;
  }

  const additions = (options.normSymbols ?? []).filter(r => r.add === true);
  const replacements = (options.normSymbols ?? []).filter(r => !r.add);
  const symbolIdMap = new Map<string, string>();
  try {
    if (additions.length > 0) {
      const stats = applyOcdNormSymbols(doc, [], additions);
      for (const [k, v] of stats.symbolIdMap) symbolIdMap.set(k, v);
    }
    if (options.textSymbols?.length) {
      const stats = applyOcdTextSymbols(doc, options.textSymbols);
      for (const [k, v] of stats.symbolIdMap) symbolIdMap.set(k, v);
    }
  } catch (error) {
    return fail("VERIFY_FAILED", error instanceof Error ? error.message : "Symboländringarna kunde inte appliceras.");
  }

  const rev = applyOcdRevisionToDocument(doc, sourceMap, changeSet, symbolIdMap);
  if (!rev.ok) return rev;

  try {
    if (options.colors?.length) applyOcdColors(doc, options.colors);
    if (options.symbolColors?.length) applyOcdSymbolColors(doc, options.symbolColors);
    if (replacements.length > 0) applyOcdNormSymbols(doc, replacements);
    if (options.georeference !== undefined || options.scale !== undefined) {
      updateOcdScalePar(doc, options.georeference ?? sourceMap.georeference, options.scale);
    }
  } catch (error) {
    return fail("VERIFY_FAILED", error instanceof Error ? error.message : "Färg- eller symboländringarna kunde inte appliceras.");
  }

  // Behåll enbart tillagda och ändrade objekt; `packOcdDocument` rensar automatiskt bort länkade strängar till bortfiltrerade objekt.
  const keepKeys = new Set<number>([...rev.modifiedKeys, ...rev.addedKeys.map(item => item.key)]);
  doc.objects = doc.objects.filter(obj => keepKeys.has(obj.key));

  const packed = packOcdDocument(doc);
  const strictRcLocators = new Set<string>();
  for (const key of keepKeys) {
    const loc = packed.objectLocators.get(key);
    if (loc) strictRcLocators.add(`${loc.block}:${loc.slot}`);
  }
  const verified = verifyOcdDocument(packed.bytes, { exactObjects: rev.added + rev.modified, strictRcLocators });
  if (!verified.ok) return fail("VERIFY_FAILED", verified.message);

  return {
    ok: true,
    bytes: packed.bytes,
    added: rev.added,
    modified: rev.modified,
    skippedDeleted: rev.deleted
  };
}
