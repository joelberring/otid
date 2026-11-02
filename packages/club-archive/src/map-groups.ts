import { baseName, isoDate, stemOf } from "./folder-name";

/**
 * ADR-0194 beslut 2 och 6: samma område har många filnamn ("Älvsjöskogen 2018-08-12 V11.ocd", "Älvsjöskogen_v12.ocd",
 * "Älvsjöskogen - Kopia.ocd"). Kartans identitet är namnet utan datum, år, versionsbeteckning och kopiemärkning; ägaren slår
 * ihop och delar i arkivet efteråt när gissningen inte stämmer.
 */
export interface MapIdentity {
  /** Gruppens nyckel (gemener, bara bokstäver och siffror). */
  readonly key: string;
  /** Kartans namn att visa. */
  readonly name: string;
  /** Datum ur filnamnet, om det finns. */
  readonly date: string | null;
}

const DATE = /((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/;
/** Det som tas bort ur namnet; grupp 1 är tecknet före (behålls). */
const NOISE: readonly RegExp[] = [
  /(^|\D)(?:19|20)\d{2}[-_.]?\d{2}[-_.]?\d{2}(?!\d)/g,
  /(^|[\s_\-.(])(?:v|ver|version|rev|revision)\.?\s?\d+(?:[._]\d+)*(?=$|[\s_\-.)])/gi,
  /(^|[\s_\-.(])(?:kopia|kopie|copy)(?:\s(?:av|of))?(?=$|[\s_\-.)])/gi,
  /(^|\s?)\(\d+\)/g,
  /(^|[\s_\-.(])(?:19|20)\d{2}(?=$|[\s_\-.)])/g
];

export function mapIdentity(fileName: string): MapIdentity {
  const stem = stemOf(baseName(fileName)).normalize("NFC");
  const dated = DATE.exec(stem);
  const date = dated ? isoDate(Number(dated[1]), Number(dated[2]), Number(dated[3])) : null;
  let cleaned = stem;
  for (const pattern of NOISE) cleaned = cleaned.replace(pattern, "$1 ");
  cleaned = cleaned.replace(/[_]+/g, " ").replace(/\s[-–]\s/g, " ").replace(/[()]/g, " ").replace(/\s+/g, " ")
    .replace(/^[\s\-–.,]+|[\s\-–.,]+$/g, "").trim();
  const name = (cleaned || stem).slice(0, 120);
  const key = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() || stem.toLowerCase();
  return { key: key.slice(0, 200), name, date };
}
