import type { MapFileFormat, MapObject, ParsedMap } from "@o-tid/map-file";

/**
 * ADR-0208: kontraktet mellan kartrevideringen och skrivarna i `@o-tid/map-file` (grenen kartfil-skrivning,
 * `packages/map-file/src/revision/change-set.ts`). **Tillfälligt här** tills den grenen är ihopslagen; då importeras typerna
 * därifrån och den här filen blir bara adaptern (`objectRefAt`, `objectRefKey`).
 *
 * Revideringen behandlar `ObjectRef` som en ogenomskinlig referens till ett objekt i grundfilen (exakt den sha256 som
 * revideringen startade på). Den lagras på servern som JSON och skickas tillbaka till skrivaren orörd. Här är den objektets
 * plats i läsarens lista (`ParsedMap.objects`), som är densamma för samma fil och samma läsare; skrivarens version bär
 * objektets ursprung i filen (indexpost och byteposition i OCAD, textintervall i Mapper).
 */
export interface ObjectRef {
  /** Objektets plats i `readMapFile(grundfilen).objects`. */
  readonly index: number;
}

export type MapRevisionChange =
  | { readonly kind: "ADD"; readonly object: MapObject }
  | { readonly kind: "MODIFY"; readonly ref: ObjectRef; readonly object: MapObject }
  | { readonly kind: "DELETE"; readonly ref: ObjectRef };

export interface MapRevisionChangeSet {
  /** Grundfilens sha256; skrivaren vägrar en annan fil. */
  readonly baseSha256: string;
  readonly format: MapFileFormat;
  readonly changes: readonly MapRevisionChange[];
}

/** Referensen till objekt nummer `index` i den lästa grundfilen. */
export function objectRefAt(_map: ParsedMap, index: number): ObjectRef {
  return { index };
}

/** Objektet som referensen pekar på i den lästa grundfilen (undefined = finns inte). */
export function objectAtRef(map: ParsedMap, ref: ObjectRef): MapObject | undefined {
  return Number.isInteger(ref.index) && ref.index >= 0 ? map.objects[ref.index] : undefined;
}

/** Referensen som text: samma referens ger alltid samma text (nyckeln i revideringens logg). */
export function objectRefKey(ref: ObjectRef): string {
  return String(ref.index);
}

/** En referens ur lagrad JSON, eller undefined om den inte är en referens. */
export function parseObjectRef(value: unknown): ObjectRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const index = (value as { index?: unknown }).index;
  return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < 10_000_000 ? { index } : undefined;
}
