/** Steg 59: läs en kartfil (OCAD eller Mapper) ur bytes. Formatet känns igen på innehållet, inte på filnamnet. */
import { MapFileError, type ParsedMap, type ReadOptions } from "./model";
import { readOcd } from "./ocd/read";
import { MAPPER_NAMESPACE, readOmap } from "./omap/read";

/** ADR-0219: med `{ sources: true }` får varje objekt `source` (plats i filen och hash) för kartrevidering. */
export function readMapFile(bytes: Uint8Array, fileName?: string, options: ReadOptions = {}): ParsedMap {
  if (bytes.length >= 2 && bytes[0] === 0xad && bytes[1] === 0x0c) return readOcd(bytes, options);
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096));
  if (/<map\b[^>]*xmlns\s*=\s*["']http:\/\/openorienteering\.org\/apps\/mapper\/xml\/v2["']/.test(head) || head.includes(MAPPER_NAMESPACE)) {
    return readOmap(decodeUtf8(bytes), options);
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    throw new MapFileError("NOT_A_MAP_FILE", "Filen är packad (gzip). Spara kartan som okomprimerad .omap eller .xmap i Mapper.");
  }
  const name = fileName ? `"${fileName}" ` : "";
  throw new MapFileError("NOT_A_MAP_FILE", `Filen ${name}är varken en OCAD-karta (.ocd) eller en Mapper-karta (.omap/.xmap).`);
}

function decodeUtf8(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
