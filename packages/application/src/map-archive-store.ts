import { createHash, createHmac } from "node:crypto";

/**
 * ADR-0224, PLAN.md steg L5: arkivet för vilande kartinnehåll i S3-kompatibel objektlagring (Hetzner Object Storage).
 * Innehållet ligger under `map-content/<sha256>`; nyckeln är alltså innehållets egen kontrollsumma. Här finns bara de fyra
 * anrop som behövs (PUT, GET, HEAD, DELETE) med AWS Signature Version 4, skrivna med Nodes `crypto` och `fetch` i stället
 * för ett beroende (AGENTS.md). Adresseringen är `https://<endpoint>/<bucket>/<nyckel>` (path-style).
 */
export interface ArchiveStore {
  /** Laddar upp innehållet. `sha256` är innehållets kontrollsumma (hex), som objektlagringen kontrollerar mot bodyn. */
  put(sha256: string, bytes: Uint8Array): Promise<void>;
  /** Hela innehållet, eller undefined när objektet inte finns. */
  get(sha256: string): Promise<Buffer | undefined>;
  /** Objektets storlek, eller undefined när det inte finns. */
  size(sha256: string): Promise<number | undefined>;
  /** Tar bort objektet; ofarligt om det redan är borta. */
  remove(sha256: string): Promise<void>;
}

export type ArchiveMode = "off" | "log" | "on";
export interface ArchiveConnection {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

type Env = Partial<Record<string, string | undefined>>;
const ARCHIVE_ENV = ["OTID_ARCHIVE_ENDPOINT", "OTID_ARCHIVE_BUCKET", "OTID_ARCHIVE_ACCESS_KEY", "OTID_ARCHIVE_SECRET_KEY"] as const;

/** `OTID_ARCHIVE_MODE`: off (förval), log ("skulle ha flyttats", ADR-0224 beslut 9) eller on. */
export function archiveMode(env: Env = process.env): ArchiveMode {
  const mode = env.OTID_ARCHIVE_MODE?.trim().toLowerCase();
  return mode === "on" || mode === "log" ? mode : "off";
}

/**
 * Anslutningen ur miljön, eller null när någon del saknas. Regionen (`OTID_ARCHIVE_REGION`) är som förval adressens första
 * led (`hel1.your-objectstorage.com` → `hel1`).
 */
export function archiveConnection(env: Env = process.env): ArchiveConnection | null {
  const [endpoint, bucket, accessKey, secretKey] = ARCHIVE_ENV.map(name => env[name]?.trim() ?? "");
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  const url = endpoint.includes("://") ? endpoint.replace(/\/+$/, "") : `https://${endpoint.replace(/\/+$/, "")}`;
  const region = env.OTID_ARCHIVE_REGION?.trim() || new URL(url).hostname.split(".")[0] || "us-east-1";
  return { endpoint: url, bucket, region, accessKey, secretKey };
}

/** Fel inställningar, för loggen vid start (aldrig nycklarnas värden). */
export function archiveSettingsProblems(env: Env): string[] {
  const problems: string[] = [];
  const mode = env.OTID_ARCHIVE_MODE?.trim().toLowerCase();
  if (mode && !["off", "log", "on"].includes(mode)) problems.push("OTID_ARCHIVE_MODE ska vara off, log eller on; arkivet är av");
  const missing = ARCHIVE_ENV.filter(name => !env[name]?.trim());
  if (mode === "on" && missing.length > 0) problems.push(`Arkivet är på men ${missing.join(", ")} saknas; ingenting flyttas`);
  if (missing.length === 0 && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.OTID_ARCHIVE_BUCKET!.trim())) {
    problems.push("OTID_ARCHIVE_BUCKET ser inte ut som ett bucketnamn");
  }
  return problems;
}

const hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Uint8Array, data: string) => createHmac("sha256", key).update(data).digest();
const EMPTY_SHA256 = hex("");
const encodePath = (path: string) => path.split("/").map(part => encodeURIComponent(part).replace(/[!'()*]/g,
  char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

export interface SignInput {
  readonly method: string;
  readonly url: URL;
  /** Övriga rubriker som ska signeras (gemener). `host`, `x-amz-date` och `x-amz-content-sha256` läggs till här. */
  readonly headers?: Record<string, string>;
  readonly payloadSha256: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly now: Date;
}

/** AWS Signature Version 4 för S3: ger rubrikerna att skicka, med `authorization`. */
export function signS3(input: SignInput): Record<string, string> {
  const stamp = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, host: input.url.host, "x-amz-content-sha256": input.payloadSha256, "x-amz-date": stamp };
  const names = Object.keys(headers).sort();
  const query = [...input.url.searchParams.entries()].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).sort().join("&");
  const canonical = [input.method, encodePath(decodeURIComponent(input.url.pathname)), query,
    ...names.map(name => `${name}:${headers[name]!.trim()}`), "", names.join(";"), input.payloadSha256].join("\n");
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, day), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== "host"));
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

const SHA256 = /^[0-9a-f]{64}$/;
const REQUEST_TIMEOUT_MS = 10 * 60_000;

/** Arkivet i en S3-kompatibel objektlagring. Fel från lagringen kastas med statuskoden (aldrig nycklar i texten). */
export function s3ArchiveStore(connection: ArchiveConnection, options: { fetch?: typeof fetch; now?: () => Date } = {}): ArchiveStore {
  const send = options.fetch ?? fetch;
  const call = async (method: string, sha256: string, body?: Uint8Array) => {
    if (!SHA256.test(sha256)) throw new Error("Ogiltig kontrollsumma för arkivet");
    const url = new URL(`${connection.endpoint}/${connection.bucket}/map-content/${sha256}`);
    const headers = signS3({ method, url, payloadSha256: body ? sha256 : EMPTY_SHA256, region: connection.region,
      accessKey: connection.accessKey, secretKey: connection.secretKey, now: options.now?.() ?? new Date(),
      ...(body ? { headers: { "content-type": "application/octet-stream" } } : {}) });
    return send(url, { method, headers, ...(body ? { body: body as unknown as BodyInit } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  };
  const failed = async (what: string, response: Response) => {
    await response.arrayBuffer();
    return new Error(`Arkivet: ${what} misslyckades (${response.status})`);
  };
  return {
    async put(sha256, bytes) {
      const response = await call("PUT", sha256, bytes);
      if (!response.ok) throw await failed("uppladdningen", response);
      await response.arrayBuffer();
    },
    async get(sha256) {
      const response = await call("GET", sha256);
      if (response.status === 404) { await response.arrayBuffer(); return undefined; }
      if (!response.ok) throw await failed("hämtningen", response);
      return Buffer.from(await response.arrayBuffer());
    },
    async size(sha256) {
      const response = await call("HEAD", sha256);
      if (response.status === 404) return undefined;
      if (!response.ok) throw await failed("kontrollen", response);
      const length = Number(response.headers.get("content-length"));
      return Number.isFinite(length) ? length : undefined;
    },
    async remove(sha256) {
      const response = await call("DELETE", sha256);
      if (!response.ok && response.status !== 404) throw await failed("borttagningen", response);
      await response.arrayBuffer();
    }
  };
}

/** Ett arkiv i minnet, för tester. */
export function memoryArchiveStore(): ArchiveStore & { readonly objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async put(sha256, bytes) { objects.set(sha256, Buffer.from(bytes)); },
    async get(sha256) { return objects.get(sha256); },
    async size(sha256) { return objects.get(sha256)?.byteLength; },
    async remove(sha256) { objects.delete(sha256); }
  };
}

type StoreSlot = { store: ArchiveStore | null } | undefined;
const globalArchive = globalThis as typeof globalThis & { oTidMapArchiveStore?: StoreSlot };

/** Arkivet som läsningen av kartinnehåll hämtar ur: det som satts (tester) eller annars det ur miljön. Null = inget arkiv. */
export function mapArchiveStore(env: Env = process.env): ArchiveStore | null {
  if (globalArchive.oTidMapArchiveStore) return globalArchive.oTidMapArchiveStore.store;
  const connection = archiveConnection(env);
  const store = connection ? s3ArchiveStore(connection) : null;
  globalArchive.oTidMapArchiveStore = { store };
  return store;
}

/** Sätter arkivet (tester); undefined = läs miljön igen. */
export function setMapArchiveStore(store: ArchiveStore | null | undefined): void {
  globalArchive.oTidMapArchiveStore = store === undefined ? undefined : { store };
}
