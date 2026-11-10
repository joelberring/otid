/**
 * Ägaren 2026-11-10: en mapp med blandat underlag från äldre kartprojekt. Filerna sorteras i webbläsaren efter slag; det som
 * går att använda blir skisslager (vektorer) eller underlag (bilder), resten laddas aldrig upp ("slängs") så att projektet inte
 * växer i onödan. Rena funktioner: grupperingen och skälen, och vektorernas objekt som skisser i kartans mm.
 */
import type { MapGeoreference, Point } from "@o-tid/map-file";
import { guessCrs, sourcePointToMap, type SourceData } from "@o-tid/map-revision";
import { simplifyStroke } from "./map-project-sketch";

export type IntakeKind = "VECTOR" | "IMAGE" | "MAP_FILE" | "LASER" | "DWG" | "GPS" | "OTHER";
export type IntakeDecision = "SKETCH" | "UNDERLAG" | "DISCARD";
/** Varför en fil slängs (eller vad som hände när den lästes in). */
export type IntakeReason = "MAP_FILE" | "LASER" | "DWG" | "GPS" | "OTHER" | "SIDECAR" | "DUPLICATE" | "SYSTEM" | "EMPTY" | "NO_CRS" | "OUTSIDE";

export interface IntakeGroup {
  readonly key: string;
  /** Det som visas: sökvägen i mappen till huvudfilen. */
  readonly name: string;
  /** Lagrets namn (filnamnet utan ändelse). */
  readonly stem: string;
  readonly kind: IntakeKind;
  readonly files: readonly File[];
  readonly bytes: number;
  readonly decision: IntakeDecision;
  readonly reason?: IntakeReason | undefined;
}

const MAIN: readonly [RegExp, IntakeKind][] = [
  [/\.(geojson|json|dxf|shp)$/i, "VECTOR"], [/\.(png|jpe?g|tiff?)$/i, "IMAGE"], [/\.(omap|xmap|ocd)$/i, "MAP_FILE"],
  [/\.(laz|las)$/i, "LASER"], [/\.dwg$/i, "DWG"], [/\.(gpx|fit|tcx)$/i, "GPS"]
];
/** Filer som hör till en huvudfil med samma namn (shapefilens delar, bildernas världsfiler). */
const SIDECAR = /\.(dbf|prj|cpg|shx|sbn|sbx|qix|pgw|pngw|jgw|jpgw|tfw|tifw|wld|aux\.xml|ovr)$/i;
const SYSTEM = /(^|\/)(\.ds_store|thumbs\.db|desktop\.ini|\._.*)$/i;

const pathOf = (file: File) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
/** Katalogen och namnet utan ändelse(r): "gammalt/stigar.shp" och "gammalt/stigar.dbf" hör ihop. */
const stemOf = (path: string) => path.toLowerCase().replace(/\.aux\.xml$/, "").replace(/\.[a-z0-9]{1,5}$/, "");

/** Grupperar filerna och föreslår vad som görs med varje grupp (dubbletter jämförs med innehållets sha-256). */
export async function sortIntake(files: readonly File[]): Promise<IntakeGroup[]> {
  const byStem = new Map<string, File[]>();
  const groups: IntakeGroup[] = [];
  for (const file of files) {
    const path = pathOf(file);
    if (SYSTEM.test(path)) { groups.push(group(path, [file], "OTHER", "DISCARD", "SYSTEM")); continue; }
    const stem = stemOf(path);
    byStem.set(stem, [...byStem.get(stem) ?? [], file]);
  }
  const seen = new Map<string, string>();
  for (const members of byStem.values()) {
    const main = members.find(file => MAIN.some(([pattern]) => pattern.test(file.name)));
    if (!main) {
      for (const file of members) groups.push(group(pathOf(file), [file], "OTHER", "DISCARD", SIDECAR.test(file.name) ? "SIDECAR" : "OTHER"));
      continue;
    }
    const kind = MAIN.find(([pattern]) => pattern.test(main.name))![1];
    const related = members.filter(file => file === main || SIDECAR.test(file.name));
    for (const file of members) if (!related.includes(file)) groups.push(group(pathOf(file), [file], "OTHER", "DISCARD", "OTHER"));
    const hash = await digest(main);
    const twin = seen.get(hash);
    if (twin) { groups.push(group(pathOf(main), related, kind, "DISCARD", "DUPLICATE")); continue; }
    seen.set(hash, pathOf(main));
    const decision: IntakeDecision = kind === "VECTOR" ? "SKETCH" : kind === "IMAGE" ? "UNDERLAG" : "DISCARD";
    groups.push(group(pathOf(main), related, kind, decision, decision === "DISCARD" ? kind as IntakeReason : undefined));
  }
  const order: Record<IntakeDecision, number> = { SKETCH: 0, UNDERLAG: 1, DISCARD: 2 };
  return groups.sort((a, b) => order[a.decision] - order[b.decision] || a.name.localeCompare(b.name, "sv"));
}

function group(name: string, files: readonly File[], kind: IntakeKind, decision: IntakeDecision, reason?: IntakeReason): IntakeGroup {
  const stem = (name.split("/").pop() ?? name).replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return { key: name, name, stem, kind, files, bytes: files.reduce((sum, file) => sum + file.size, 0), decision, reason };
}

async function digest(file: File): Promise<string> {
  // Stora filer jämförs på storlek och början (en hel laserfil läses inte in bara för att hitta dubbletter).
  const head = file.size > 32 * 1024 * 1024 ? file.slice(0, 1024 * 1024) : file;
  const bytes = await head.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `${file.size}:${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export interface IntakeSketch { readonly kind: "LINE" | "POINT"; readonly points: [number, number][] }

/** Förenklingen av linjerna (kartans mm) och taket per fil (projektet rymmer 5000 skisser). */
const TOLERANCE_MM = 0.1;
export const MAX_SKETCHES_PER_FILE = 1500;
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Vektorfilens objekt som skisser i kartans mm: punkter blir punkter, linjer och ytornas kanter blir linjer (förenklade).
 * EMPTY = inget att läsa, NO_CRS = koordinatsystemet okänt, OUTSIDE = inget inom kartans ruta (med en marginal).
 */
export function vectorSketches(data: SourceData, georeference: MapGeoreference, bounds: { minX: number; minY: number; maxX: number; maxY: number },
  fallbackCrs: number | undefined): { sketches: IntakeSketch[] } | { problem: "EMPTY" | "NO_CRS" | "OUTSIDE" } {
  if (data.features.length === 0) return { problem: "EMPTY" };
  const crs = data.crs ?? guessCrs(data) ?? fallbackCrs;
  if (crs === undefined) return { problem: "NO_CRS" };
  const margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.1;
  const inside = (p: Point) => p.x >= bounds.minX - margin && p.x <= bounds.maxX + margin && p.y >= bounds.minY - margin && p.y <= bounds.maxY + margin;
  const toMap = (at: readonly [number, number]) => sourcePointToMap(georeference, crs, at[0], at[1]);
  const sketches: IntakeSketch[] = [];
  const line = (points: readonly (readonly [number, number])[], closed: boolean) => {
    const mapped = points.map(toMap);
    if (!mapped.some(inside)) return;
    const simplified = simplifyStroke(closed && mapped[0] ? [...mapped, mapped[0]] : mapped, TOLERANCE_MM).slice(0, 2000);
    if (simplified.length >= 2) sketches.push({ kind: "LINE", points: simplified.map(p => [round(p.x), round(p.y)]) });
  };
  for (const feature of data.features) {
    if (sketches.length >= MAX_SKETCHES_PER_FILE) break;
    const geometry = feature.geometry;
    try {
      if (geometry.kind === "point") {
        const at = toMap(geometry.at);
        if (inside(at)) sketches.push({ kind: "POINT", points: [[round(at.x), round(at.y)]] });
      } else if (geometry.kind === "line") line(geometry.points, geometry.closed);
      else for (const ring of geometry.rings) line(ring, true);
    } catch { /* Ett objekt som inte går att räkna om hoppas över, som i vektorimporten. */ }
  }
  return sketches.length === 0 ? { problem: "OUTSIDE" } : { sketches: sketches.slice(0, MAX_SKETCHES_PER_FILE) };
}
