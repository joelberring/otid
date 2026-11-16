/**
 * DXF R12 (AC1009) för underlagen till frihandsritning: ett lager per symbol, linjer som POLYLINE (med höjden när den finns,
 * så att kurvornas nivå följer med) och punkter som POINT. R12 utan handtag är det som flest program läser, OCAD också.
 */
export interface DxfLayer {
  readonly name: string;
  /** AutoCAD-färgen (1 röd, 3 grön, 5 blå, 7 svart/vit …). */
  readonly color?: number | undefined;
  readonly lines: readonly { readonly points: readonly (readonly [number, number])[]; readonly closed: boolean; readonly z?: number | undefined }[];
  readonly points?: readonly (readonly [number, number])[] | undefined;
}

const number = (value: number) => (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, "") || "0";

export function writeDxf(layers: readonly DxfLayer[]): string {
  const out: string[] = [];
  const pair = (code: number, value: string | number) => { out.push(String(code), typeof value === "number" ? number(value) : value); };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const extend = ([x, y]: readonly [number, number]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const layer of layers) { for (const line of layer.lines) line.points.forEach(extend); layer.points?.forEach(extend); }
  if (!Number.isFinite(minX)) { minX = minY = maxX = maxY = 0; }
  pair(0, "SECTION"); pair(2, "HEADER");
  pair(9, "$ACADVER"); pair(1, "AC1009");
  pair(9, "$INSUNITS"); pair(70, "6");
  pair(9, "$EXTMIN"); pair(10, minX); pair(20, minY); pair(30, 0);
  pair(9, "$EXTMAX"); pair(10, maxX); pair(20, maxY); pair(30, 0);
  pair(0, "ENDSEC");
  pair(0, "SECTION"); pair(2, "TABLES");
  pair(0, "TABLE"); pair(2, "LAYER"); pair(70, String(layers.length));
  for (const layer of layers) { pair(0, "LAYER"); pair(2, layer.name); pair(70, "0"); pair(62, String(layer.color ?? 7)); pair(6, "CONTINUOUS"); }
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");
  pair(0, "SECTION"); pair(2, "ENTITIES");
  for (const layer of layers) {
    for (const line of layer.lines) {
      if (line.points.length < 2) continue;
      const z = line.z ?? 0;
      pair(0, "POLYLINE"); pair(8, layer.name); pair(66, "1"); pair(10, 0); pair(20, 0); pair(30, z); pair(70, line.closed ? "1" : "0");
      for (const [x, y] of line.points) { pair(0, "VERTEX"); pair(8, layer.name); pair(10, x); pair(20, y); pair(30, z); }
      pair(0, "SEQEND"); pair(8, layer.name);
    }
    for (const [x, y] of layer.points ?? []) { pair(0, "POINT"); pair(8, layer.name); pair(10, x); pair(20, y); pair(30, 0); }
  }
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return `${out.join("\n")}\n`;
}
