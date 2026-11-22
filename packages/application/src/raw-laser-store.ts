import { createHash, createHmac } from "node:crypto";
import { archiveConnection, signS3, type ArchiveConnection } from "./map-archive-store";
import { activeMapStore } from "./map-store";

/**
 * PLAN.md M6 (ägaren 2026-11-22): zip-filerna med rå laserdata ligger i förrådets objektlagring (samma `OTID_ARCHIVE_*` som
 * förrådet) under `raw-laser/`, skilt från kartinnehållet (`map-content/<sha256>`). Geo-arbetaren laddar upp direkt till
 * objektlagringen med en försignerad PUT-länk för just det objektet (inga nycklar lämnar servern och zip-filen går aldrig
 * genom O-Tids disk), och användaren hämtar med en försignerad GET-länk. Länkarna signeras med AWS Signature Version 4 i
 * frågesträngen (`X-Amz-Expires`, högst 7 dygn).
 */
export const RAW_LASER_PREFIX = "raw-laser/";
/** Det längsta en försignerad länk får gälla (AWS Signature Version 4). */
export const PRESIGN_MAX_SECONDS = 7 * 24 * 3600;

export interface RawLaserStore {
  /** Försignerad PUT till objektet; uppladdningen ska ha exakt `byteLength` som Content-Length. */
  uploadUrl(key: string, seconds: number, now?: Date): string;
  /** Försignerad GET till objektet; webbläsaren sparar filen som `fileName`. */
  downloadUrl(key: string, fileName: string, seconds: number, now?: Date): string;
  /** Objektets storlek, eller undefined när det inte finns. */
  size(key: string): Promise<number | undefined>;
  /** Tar bort objektet; ofarligt om det redan är borta. */
  remove(key: string): Promise<void>;
}

const KEY = /^raw-laser\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/;
const hex = (data: string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Uint8Array, data: string) => createHmac("sha256", key).update(data).digest();
/** RFC 3986 som AWS vill ha den (encodeURIComponent lämnar !'()* okodade). */
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export interface PresignInput {
  readonly method: "GET" | "PUT";
  readonly url: URL;
  readonly region: string; readonly accessKey: string; readonly secretKey: string;
  readonly now: Date; readonly seconds: number;
  /** Fler parametrar i frågesträngen, t.ex. `response-content-disposition`. */
  readonly query?: Readonly<Record<string, string>>;
}

/** En försignerad adress (AWS Signature Version 4 i frågesträngen, bara `host` signerad, innehållet osignerat). */
export function presignS3(input: PresignInput): string {
  if (!Number.isInteger(input.seconds) || input.seconds < 1 || input.seconds > PRESIGN_MAX_SECONDS) throw new Error("Ogiltig giltighetstid för länken");
  const stamp = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = stamp.slice(0, 8), scope = `${day}/${input.region}/s3/aws4_request`;
  const params: Record<string, string> = { ...input.query, "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${input.accessKey}/${scope}`,
    "X-Amz-Date": stamp, "X-Amz-Expires": String(input.seconds), "X-Amz-SignedHeaders": "host" };
  const query = Object.keys(params).sort().map(name => `${encode(name)}=${encode(params[name]!)}`).join("&");
  const path = input.url.pathname.split("/").map(part => encode(decodeURIComponent(part))).join("/");
  const canonical = [input.method, path, query, `host:${input.url.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, day), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return `${input.url.origin}${path}?${query}&X-Amz-Signature=${signature}`;
}

/** Filnamnet som webbläsaren får (RFC 6266 med UTF-8 och en ASCII-reserv). */
function disposition(fileName: string): string {
  const ascii = fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encode(fileName)}`;
}

const EMPTY_SHA256 = hex("");
const TIMEOUT_MS = 60_000;

export function s3RawLaserStore(connection: ArchiveConnection, options: { fetch?: typeof fetch } = {}): RawLaserStore {
  const send = options.fetch ?? fetch;
  const urlOf = (key: string) => {
    if (!KEY.test(key)) throw new Error("Ogiltigt objekt för rå laserdata");
    return new URL(`${connection.endpoint}/${connection.bucket}/${key}`);
  };
  const signed = (method: string, key: string) => {
    const url = urlOf(key);
    const headers = signS3({ method, url, payloadSha256: EMPTY_SHA256, region: connection.region, accessKey: connection.accessKey,
      secretKey: connection.secretKey, now: new Date() });
    return send(url, { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  };
  const presign = (method: "GET" | "PUT", key: string, seconds: number, now: Date, query?: Record<string, string>) => presignS3({
    method, url: urlOf(key), region: connection.region, accessKey: connection.accessKey, secretKey: connection.secretKey, now, seconds,
    ...(query ? { query } : {}) });
  return {
    uploadUrl: (key, seconds, now = new Date()) => presign("PUT", key, seconds, now),
    downloadUrl: (key, fileName, seconds, now = new Date()) => presign("GET", key, seconds, now, { "response-content-disposition": disposition(fileName),
      "response-content-type": "application/zip" }),
    async size(key) {
      const response = await signed("HEAD", key);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`Rå laserdata: kontrollen misslyckades (${response.status})`);
      const length = Number(response.headers.get("content-length"));
      return Number.isFinite(length) ? length : undefined;
    },
    async remove(key) {
      const response = await signed("DELETE", key);
      await response.arrayBuffer().catch(() => undefined);
      if (!response.ok && response.status !== 404) throw new Error(`Rå laserdata: borttagningen misslyckades (${response.status})`);
    }
  };
}

/** Ett förråd i minnet för tester: länkarna är `memory://`, och `objects` är det som «laddats upp». */
export function memoryRawLaserStore(): RawLaserStore & { readonly objects: Map<string, number> } {
  const objects = new Map<string, number>();
  return {
    objects,
    uploadUrl: (key, seconds) => `memory://put/${key}?s=${seconds}`,
    downloadUrl: (key, fileName, seconds) => `memory://get/${key}?s=${seconds}&f=${encodeURIComponent(fileName)}`,
    async size(key) { return objects.get(key); },
    async remove(key) { objects.delete(key); }
  };
}

type Env = Partial<Record<string, string | undefined>>;
const slot = globalThis as typeof globalThis & { oTidRawLaserStore?: { store: RawLaserStore | null } };

/** Objektlagringen för rå laserdata (finns `OTID_ARCHIVE_*`), också när förrådet slagits av; städningen behöver den. */
export function rawLaserStore(env: Env = process.env): RawLaserStore | null {
  if (slot.oTidRawLaserStore) return slot.oTidRawLaserStore.store;
  const connection = archiveConnection(env);
  return connection ? s3RawLaserStore(connection) : null;
}

/** Sätter förrådet (tester); undefined = miljön igen. */
export function setRawLaserStore(store: RawLaserStore | null | undefined): void {
  if (store === undefined) delete slot.oTidRawLaserStore; else slot.oTidRawLaserStore = { store };
}

/** Rutan «Spara även rå laserdata åt mig» går att välja: förrådet är i bruk (ADR-0229) och objektlagringen nås. */
export function rawLaserAvailable(env: Env = process.env): boolean {
  return activeMapStore(env) !== null && rawLaserStore(env) !== null;
}
