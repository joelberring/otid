import { XMLParser, XMLValidator } from "fast-xml-parser";

/** GPX 1.1 (Garmin, Strava, Suunto, Polar …) och äldre GPX 1.0. */
const GPX_NAMESPACES: Record<string, string> = { "http://www.topografix.com/GPX/1/1": "1.1", "http://www.topografix.com/GPX/1/0": "1.0" };
const MAX_GPX_BYTES = 8 * 1024 * 1024;
const MAX_SEGMENTS = 2_000;
const MAX_POINTS = 100_000;
const FORBIDDEN_DECLARATION = /<!\s*(?:DTD|DOCTYPE|ENTITY)\b/i;
/** RFC 3339-tid. Saknas tidszon tolkas tiden som UTC, som GPX-standarden föreskriver. */
const RFC3339 = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/;

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  processEntities: false,
  trimValues: true
});

export interface GpxTrackPoint {
  readonly segment: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationMeters?: number;
  readonly recordedAt?: string;
}

export interface GpxTrackImport {
  readonly parser: "otid-gpx";
  readonly points: readonly GpxTrackPoint[];
  readonly segmentCount: number;
}

export class GpxValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Ogiltig GPX: ${issues.join("; ")}`);
    this.issues = issues;
  }
}

function record(value: unknown): XmlRecord {
  return typeof value === "object" && value !== null ? value as XmlRecord : {};
}

function array(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const nested = record(value)["#text"] ?? record(value)._text;
  return nested === undefined ? "" : text(nested);
}

function parseNumber(value: unknown, field: string, issues: string[]): number | undefined {
  const source = text(value);
  if (!source) {
    issues.push(`${field} saknas`);
    return undefined;
  }
  const parsed = Number(source);
  if (!Number.isFinite(parsed)) {
    issues.push(`${field} måste vara ett ändligt tal`);
    return undefined;
  }
  return parsed;
}

function parsePointTime(value: unknown, field: string, issues: string[]): string | undefined {
  const source = text(value);
  if (!source) return undefined;
  const match = RFC3339.exec(source);
  if (!match) {
    issues.push(`${field} måste vara en RFC3339-tid`);
    return undefined;
  }
  const calendarDate = new Date(`${match[1]}T00:00:00.000Z`);
  if (Number.isNaN(calendarDate.valueOf()) || calendarDate.toISOString().slice(0, 10) !== match[1]) {
    issues.push(`${field} har ogiltigt datum`);
    return undefined;
  }
  const instant = new Date(match[2] ? source : `${source}Z`);
  if (Number.isNaN(instant.valueOf())) {
    issues.push(`${field} är ogiltig`);
    return undefined;
  }
  return instant.toISOString();
}

function parsePoint(value: unknown, index: number, segment: number, issues: string[]): GpxTrackPoint | undefined {
  const point = record(value);
  const latitude = parseNumber(point["@_lat"], `trkpt[${index}].lat`, issues);
  const longitude = parseNumber(point["@_lon"], `trkpt[${index}].lon`, issues);
  if (latitude !== undefined && (latitude < -90 || latitude > 90)) issues.push(`trkpt[${index}].lat ligger utanför WGS84`);
  if (longitude !== undefined && (longitude < -180 || longitude > 180)) issues.push(`trkpt[${index}].lon ligger utanför WGS84`);

  const elevationText = text(point.ele);
  const elevation = elevationText ? Number(elevationText) : undefined;
  if (elevation !== undefined && !Number.isFinite(elevation)) issues.push(`trkpt[${index}].ele måste vara ett ändligt tal`);
  const recordedAt = parsePointTime(point.time, `trkpt[${index}].time`, issues);

  if (latitude === undefined || longitude === undefined || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || (elevation !== undefined && !Number.isFinite(elevation))) return undefined;
  return { segment, latitude, longitude, ...(elevation === undefined ? {} : { elevationMeters: elevation }), ...(recordedAt === undefined ? {} : { recordedAt }) };
}

function decode(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_GPX_BYTES) throw new GpxValidationError([`GPX får vara högst ${MAX_GPX_BYTES} bytes`]);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GpxValidationError(["GPX måste vara giltig UTF-8"]);
  }
}

export function parseGpxTrack(bytes: Uint8Array): GpxTrackImport {
  const source = decode(bytes);
  if (FORBIDDEN_DECLARATION.test(source)) throw new GpxValidationError(["DTD, DOCTYPE och ENTITY-deklarationer stöds inte"]);
  if (XMLValidator.validate(source) !== true) throw new GpxValidationError(["GPX är inte syntaktiskt giltig XML"]);

  let parsed: XmlRecord;
  try {
    parsed = record(parser.parse(source));
  } catch {
    throw new GpxValidationError(["GPX kunde inte tolkas"]);
  }
  const root = record(parsed.gpx);
  const issues: string[] = [];
  if (!Object.hasOwn(parsed, "gpx")) issues.push("GPX root saknas");
  const version = GPX_NAMESPACES[text(root["@_xmlns"])];
  if (!version || text(root["@_version"]) !== version) issues.push("Endast GPX 1.1 och 1.0 stöds");
  // Ruttplaner (rte) och waypoints (wpt) läses inte; bara spåret (trk) är löparens rutt.

  const points: GpxTrackPoint[] = [];
  let segmentCount = 0;
  for (const track of array(root.trk)) {
    for (const segment of array(record(track).trkseg)) {
      segmentCount += 1;
      if (segmentCount > MAX_SEGMENTS) {
        issues.push(`GPX får ha högst ${MAX_SEGMENTS} segment`);
        break;
      }
      for (const point of array(record(segment).trkpt)) {
        if (points.length >= MAX_POINTS) {
          issues.push(`GPX får ha högst ${MAX_POINTS} trackpunkter`);
          break;
        }
        const parsedPoint = parsePoint(point, points.length, segmentCount - 1, issues);
        if (parsedPoint) points.push(parsedPoint);
      }
    }
  }
  if (!array(root.trk).length) issues.push("GPX track saknas");
  if (points.length < 2) issues.push("GPX måste innehålla minst två giltiga trackpunkter");
  if (issues.length) throw new GpxValidationError(issues);
  return { parser: "otid-gpx", points, segmentCount };
}

export { MAX_GPX_BYTES, MAX_POINTS, MAX_SEGMENTS };
