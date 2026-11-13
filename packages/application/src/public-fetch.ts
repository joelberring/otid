import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

/**
 * Hämtning av en adress som en användare har angett (t.ex. en WMS-tjänst). Servern får aldrig bli en väg in till det
 * interna nätet (SSRF), så:
 *  - bara https på port 443 (eller ingen port), inga användaruppgifter i adressen;
 *  - ingen omdirigering (en 3xx är ett fel; en omdirigering kunde peka in i nätet);
 *  - värdens alla adresser slås upp och hämtningen avvisas om någon är icke-publik (privat, loopback, link-local inklusive
 *    169.254.169.254, CGNAT, ULA, multicast, 0.0.0.0/8, dokumentations- och övergångsadresser, även IPv4-mappade IPv6);
 *  - kontrollen sitter i anslutningens egen `lookup` (node:https `lookup`-alternativet), alltså på just de adresser som
 *    anslutningen sedan görs mot. Det finns inget mellanrum mellan kontroll och anslutning som en DNS-omkoppling
 *    (rebinding) kan utnyttja. Adresser som är IP-nummer slås inte upp alls och prövas därför i förväg (`validatePublicUrl`);
 *  - svarsstorlek och tid begränsas.
 * Undici (`Agent` med `connect.lookup`) är inget beroende i repot och kunde inte läggas till offline; node:https gör samma
 * sak och behöver inget nytt beroende. Kvarstående risk: bara det som finns i Node och operativsystemets uppslag. Går
 * utgående trafik via en proxy som själv slår upp värden (HTTPS_PROXY) hanterar Node inte det här; servern ska då stå
 * utan proxy för publika adresser eller brandväggen blockera interna nät.
 */
export type PublicFetchReason = "invalid-url" | "not-https" | "credentials" | "port" | "private-address" | "redirect" | "too-large" | "timeout" | "network";

export class PublicFetchError extends Error {
  constructor(readonly reason: PublicFetchReason, detail?: string) { super(detail ? `${reason}: ${detail}` : reason); this.name = "PublicFetchError"; }
}

export interface PublicResponse { readonly status: number; readonly contentType: string; readonly body: Uint8Array }
export interface PublicFetchOptions { readonly timeoutMs: number; readonly maxBytes: number }
/** Hämtningen som kan bytas i tester (inget nätverk). */
export type PublicFetch = (url: string, options: PublicFetchOptions) => Promise<PublicResponse>;

function parseIpv4(text: string): number[] | undefined {
  const parts = text.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return undefined;
  const numbers = parts.map(Number);
  return numbers.every(value => value <= 255) ? numbers : undefined;
}

function publicIpv4([a, b, c]: readonly number[]): boolean {
  if (a === 0 || a === 10 || a === 127 || a! >= 224) return false;
  if (a === 100 && b! >= 64 && b! <= 127) return false; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return false; // link-local, bl.a. molnens metadatatjänst
  if (a === 172 && b! >= 16 && b! <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false; // 192.168/16, 192.0.0/24, 192.0.2/24
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false; // benchmarking, dokumentation
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/** De åtta 16-bitsdelarna i en IPv6-adress (stöder `::` och IPv4-svans), eller undefined. */
function parseIpv6(text: string): number[] | undefined {
  if (text.includes("%") || text.split("::").length > 2) return undefined;
  const [head = "", tail] = text.split("::");
  const side = (part: string): number[] | undefined => {
    if (part === "") return [];
    const groups: number[] = [];
    const pieces = part.split(":");
    for (const [index, piece] of pieces.entries()) {
      if (piece.includes(".")) {
        const v4 = parseIpv4(piece);
        if (!v4 || index !== pieces.length - 1) return undefined;
        groups.push(v4[0]! * 256 + v4[1]!, v4[2]! * 256 + v4[3]!);
      } else if (/^[0-9a-f]{1,4}$/i.test(piece)) groups.push(parseInt(piece, 16));
      else return undefined;
    }
    return groups;
  };
  const left = side(head), right = tail === undefined ? [] : side(tail);
  if (!left || !right) return undefined;
  if (tail === undefined) return left.length === 8 ? left : undefined;
  const missing = 8 - left.length - right.length;
  return missing >= 1 ? [...left, ...Array<number>(missing).fill(0), ...right] : undefined;
}

const v4From = (high: number, low: number) => [high >> 8, high & 255, low >> 8, low & 255];

/** Är adressen en publik unicast-adress (IPv4 eller IPv6, text)? Allt annat, och allt som inte går att tolka, är nej. */
export function isPublicAddress(address: string): boolean {
  const text = address.replace(/^\[|\]$/g, "");
  const family = isIP(text);
  if (family === 4) return publicIpv4(parseIpv4(text)!);
  if (family !== 6) return false;
  const g = parseIpv6(text);
  if (!g) return false;
  // IPv4-mappad (::ffff:a.b.c.d): samma prövning som för IPv4-adressen.
  if (g.slice(0, 5).every(part => part === 0) && g[5] === 0xffff) return publicIpv4(v4From(g[6]!, g[7]!));
  // Bara global unicast (2000::/3); det utesluter ::, ::1, fe80::/10, fc00::/7, ff00::/8, 64:ff9b::/96 (NAT64) med mera.
  if ((g[0]! & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && (g[1]! < 0x200 || g[1] === 0x0db8)) return false; // Teredo, protokolltilldelningar, dokumentation
  if (g[0] === 0x2002) return publicIpv4(v4From(g[1]!, g[2]!)); // 6to4 bär en IPv4-adress
  if (g[0] === 0x3fff && g[1]! < 0x1000) return false; // dokumentation
  return true;
}

export type UrlCheck = { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly reason: PublicFetchReason };

/** Adressens form: https, port 443, inga användaruppgifter och, om värden är ett IP-nummer, en publik adress. */
export function validatePublicUrl(raw: string): UrlCheck {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, reason: "invalid-url" }; }
  if (url.protocol !== "https:") return { ok: false, reason: "not-https" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port !== "") return { ok: false, reason: "port" };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "") return { ok: false, reason: "invalid-url" };
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "private-address" };
  // URL-tolken skriver om 2130706433 och 0x7f.1 till 127.0.0.1; här finns bara kanoniska IP-nummer kvar.
  if (isIP(host) !== 0 && !isPublicAddress(host)) return { ok: false, reason: "private-address" };
  url.hash = "";
  return { ok: true, url };
}

type LookedUp = readonly { readonly address: string; readonly family: number }[];
type Resolver = (hostname: string, options: { all: true; family?: number; hints?: number },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookedUp) => void) => void;
/** `lookup` för en anslutning: slår upp alla adresser och avvisar värden om någon av dem inte är publik. */
export function guardedLookup(resolve: Resolver = dnsLookup as unknown as Resolver): LookupFunction {
  return (hostname, options, callback) => {
    const wanted = options;
    const family = typeof wanted.family === "number" ? wanted.family : wanted.family === "IPv4" ? 4 : wanted.family === "IPv6" ? 6 : 0;
    resolve(hostname, { all: true, ...(family ? { family } : {}), ...(wanted.hints ? { hints: wanted.hints } : {}) }, (error, addresses) => {
      if (error) { callback(error, ""); return; }
      if (addresses.length === 0) { callback(Object.assign(new Error(`Inga adresser för ${hostname}`), { code: "ENOTFOUND" }), ""); return; }
      if (addresses.some(entry => !isPublicAddress(entry.address))) { callback(new PublicFetchError("private-address", hostname) as NodeJS.ErrnoException, ""); return; }
      if (wanted.all) callback(null, addresses.map(entry => ({ address: entry.address, family: entry.family })));
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

/** En GET mot en publik https-adress (se överst). Kastar `PublicFetchError`; ett svar med annan statuskod än 3xx returneras. */
export function publicFetch(raw: string, options: PublicFetchOptions, transport: typeof httpsRequest = httpsRequest, resolve?: Resolver): Promise<PublicResponse> {
  const checked = validatePublicUrl(raw);
  if (!checked.ok) return Promise.reject(new PublicFetchError(checked.reason));
  return new Promise<PublicResponse>((resolvePromise, reject) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let total = 0;
    const settle = (action: () => void) => { if (!settled) { settled = true; clearTimeout(timer); action(); } };
    const fail = (error: PublicFetchError) => { settle(() => reject(error)); request.destroy(); };
    const timer = setTimeout(() => fail(new PublicFetchError("timeout")), options.timeoutMs);
    const request = transport(checked.url, { method: "GET", agent: false, lookup: guardedLookup(resolve),
      headers: { accept: "*/*", "user-agent": "O-Tid" } }, response => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) { response.resume(); fail(new PublicFetchError("redirect")); return; }
      if (Number(response.headers["content-length"] ?? 0) > options.maxBytes) { response.resume(); fail(new PublicFetchError("too-large")); return; }
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > options.maxBytes) fail(new PublicFetchError("too-large"));
        else chunks.push(chunk);
      });
      response.on("end", () => settle(() => resolvePromise({ status, contentType: String(response.headers["content-type"] ?? ""),
        body: new Uint8Array(Buffer.concat(chunks)) })));
      response.on("error", () => fail(new PublicFetchError("network")));
    });
    request.on("error", error => {
      // Lookupens avslag kommer tillbaka som felet på anslutningen (eventuellt inlindat).
      const cause = error instanceof PublicFetchError ? error : (error as { cause?: unknown }).cause;
      fail(cause instanceof PublicFetchError ? cause : new PublicFetchError("network", (error as NodeJS.ErrnoException).code));
    });
    request.end();
  });
}
