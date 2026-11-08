import { parseDxf, parseGeoJson, parseShapefile, type SourceData } from "@o-tid/map-revision";

/** ADR-0219 tillägget om vektorunderlagen (K4b). */
/**
 * Filerna som valts: GeoJSON, DXF eller Shapefile (.shp med .dbf, .prj och .cpg bredvid, eller allt i en .zip). Undefined om
 * inget av det finns.
 */
export async function readVectorFiles(files: readonly File[]): Promise<{ name: string; data: SourceData } | undefined> {
  const entries = new Map<string, { name: string; bytes: () => Promise<ArrayBuffer> }>();
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const { unzipSync } = await import("fflate");
      for (const [path, bytes] of Object.entries(unzipSync(new Uint8Array(await file.arrayBuffer())))) {
        const name = path.split("/").pop() ?? path;
        if (!name.startsWith(".")) entries.set(name.toLowerCase(), { name, bytes: () => Promise.resolve(bytes.slice().buffer) });
      }
    } else entries.set(file.name.toLowerCase(), { name: file.name, bytes: () => file.arrayBuffer() });
  }
  const text = async (entry: { bytes: () => Promise<ArrayBuffer> } | undefined) => entry ? new TextDecoder().decode(await entry.bytes()) : undefined;
  const find = (pattern: RegExp) => [...entries.entries()].find(([name]) => pattern.test(name))?.[1];
  const shp = find(/\.shp$/);
  if (shp) {
    const stem = shp.name.toLowerCase().replace(/\.shp$/, "");
    const sibling = (extension: string) => entries.get(`${stem}.${extension}`);
    return { name: shp.name, data: parseShapefile({ name: shp.name, shp: await shp.bytes(), dbf: await sibling("dbf")?.bytes(),
      prj: await text(sibling("prj")), cpg: await text(sibling("cpg")) }) };
  }
  const dxf = find(/\.dxf$/);
  if (dxf) return { name: dxf.name, data: parseDxf((await text(dxf))!) };
  const json = find(/\.(geo)?json$/);
  if (json) return { name: json.name, data: parseGeoJson((await text(json))!) };
  return undefined;
}

