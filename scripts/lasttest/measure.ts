/**
 * Mätverktyg för lasttestet: HTTP mot webben (som en webbläsare), händelseströmmen (SSE), latensstatistik och
 * resursmätning (cgroup v1/v2 för web och databas). Inga beroenden utöver Node.
 */
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import zlib from "node:zlib";

export type Sample = { label: string; ms: number; ok: boolean; status: number; bytes: number; at: number };

export class Recorder {
  readonly samples: Sample[] = [];
  readonly errors = new Map<string, number>();
  /** När varje sorts fel först kom (ms sedan epoken), för felsökning. */
  readonly firstErrorAt = new Map<string, number>();
  record(sample: Sample): void {
    this.samples.push(sample);
    if (!sample.ok) {
      const key = `${sample.label} ${sample.status}`;
      this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
      if (!this.firstErrorAt.has(key)) this.firstErrorAt.set(key, sample.at);
    }
  }
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))]!;
}

export type Summary = { label: string; count: number; errors: number; p50: number; p95: number; p99: number; max: number; kb: number; perSecond: number };

export function summarize(samples: readonly Sample[], from = 0, to = Number.POSITIVE_INFINITY): Summary[] {
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    if (sample.at < from || sample.at > to) continue;
    const list = groups.get(sample.label) ?? [];
    list.push(sample);
    groups.set(sample.label, list);
  }
  const seconds = Number.isFinite(to) ? (to - from) / 1000 : 0;
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, list]) => {
    const sorted = list.map((sample) => sample.ms).sort((a, b) => a - b);
    return { label, count: list.length, errors: list.filter((sample) => !sample.ok).length, p50: percentile(sorted, 50),
      p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted.at(-1)!,
      kb: list.reduce((sum, sample) => sum + sample.bytes, 0) / list.length / 1024,
      perSecond: seconds > 0 ? list.length / seconds : 0 };
  });
}

export function table(rows: readonly Summary[]): string {
  const head = "| Anrop | antal | fel | p50 ms | p95 ms | p99 ms | max ms | kB/svar | per s |";
  const line = "|---|---:|---:|---:|---:|---:|---:|---:|---:|";
  const body = rows.map((row) => `| ${row.label} | ${row.count} | ${row.errors} | ${row.p50.toFixed(0)} | ${row.p95.toFixed(0)} | ` +
    `${row.p99.toFixed(0)} | ${row.max.toFixed(0)} | ${row.kb.toFixed(0)} | ${row.perSecond.toFixed(1)} |`);
  return [head, line, ...body].join("\n");
}

/** Ett svar: status, råa (komprimerade) byte och text (uppackad bara när någon läser den). */
export type Reply = { status: number; ms: number; bytes: number; body: Buffer; encoding: string | undefined; text(): string };

// Lediga anslutningar stängs efter 4 s, före webbens keep-alive på 5 s (annars krockar återanvändning och stängning).
const agent = new http.Agent({ keepAlive: true, maxSockets: Number.POSITIVE_INFINITY, timeout: 4_000 });

/**
 * En webbläsares anrop: Origin, kakor och gzip (som bakom Caddy, som skickar vidare Accept-Encoding till webben).
 * node:http i stället för fetch: svaret packas bara upp när det läses, så att lastgeneratorn inte stjäl CPU.
 */
export class Client {
  cookies = new Map<string, string>();
  private readonly url: URL;
  constructor(readonly base: string, readonly origin: string, readonly recorder: Recorder) { this.url = new URL(base); }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    return { "accept-encoding": "gzip", "user-agent": "otid-lasttest", ...(cookie ? { cookie } : {}), ...extra };
  }

  csrf(): string {
    for (const [name, value] of this.cookies) if (name.endsWith("csrf")) return value;
    throw new Error("CSRF-kakan saknas (logga in först)");
  }

  private raw(path: string, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number):
    Promise<{ status: number; body: Buffer; encoding: string | undefined; setCookie: string[] }> {
    return new Promise((resolve, reject) => {
      const request = http.request({ agent, host: this.url.hostname, port: this.url.port, path, method,
        headers: { ...headers, ...(body === undefined ? {} : { "content-length": String(Buffer.byteLength(body)) }) } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks),
          encoding: response.headers["content-encoding"], setCookie: response.headers["set-cookie"] ?? [] }));
        response.on("error", reject);
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error("tidsgräns")));
      request.on("error", reject);
      request.end(body);
    });
  }

  /** Mäter hela svaret (till sista byte). `label` grupperar statistiken. */
  async request(label: string, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {}):
    Promise<Reply> {
    const started = performance.now();
    const method = init.method ?? "GET";
    const write = method !== "GET";
    let status = 0, body: Buffer = Buffer.alloc(0), encoding: string | undefined;
    try {
      const send = () => this.raw(path, method, this.headers({ ...(write ? { origin: this.origin, "content-type": "application/json",
        "x-otid-csrf": this.csrfOrEmpty() } : {}), ...init.headers }), init.body === undefined ? undefined : JSON.stringify(init.body), init.timeoutMs ?? 30_000);
      // En återanvänd anslutning som servern just stängt (keep-alive) försöks igen en gång, som webbläsare och Caddy gör.
      const reply = await send().catch((error: unknown) => {
        if (!write && error instanceof Error && /ECONNRESET|socket hang up/.test(error.message)) return send();
        throw error;
      });
      ({ status, body, encoding } = reply);
      for (const setCookie of reply.setCookie) {
        const [pair] = setCookie.split(";");
        const index = pair!.indexOf("=");
        this.cookies.set(pair!.slice(0, index).trim(), pair!.slice(index + 1).trim());
      }
    } catch (error) {
      status = 0;
      const reason = error instanceof Error ? error.message : String(error);
      this.recorder.errors.set(`${label} ${reason}`, (this.recorder.errors.get(`${label} ${reason}`) ?? 0) + 1);
    }
    const ms = performance.now() - started;
    this.recorder.record({ label, ms, ok: status >= 200 && status < 400, status, bytes: body.byteLength, at: Date.now() });
    return { status, ms, bytes: body.byteLength, body, encoding,
      text: () => (encoding === "gzip" ? zlib.gunzipSync(body) : encoding === "br" ? zlib.brotliDecompressSync(body) : body).toString("utf8") };
  }

  private csrfOrEmpty(): string {
    try { return this.csrf(); } catch { return ""; }
  }

  async login(email: string, password: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      const result = await this.request("login", "/api/organizer/login", { method: "POST", body: { formatVersion: 1, email, password },
        timeoutMs: 60_000 });
      if (result.status === 200) return;
      if (attempt === 3 || (result.status !== 0 && result.status < 500)) {
        throw new Error(`Inloggningen misslyckades (${result.status}): ${result.text().slice(0, 200)}`);
      }
      await sleep(2_000);
    }
  }

  /**
   * Händelseströmmen som webbläsarens EventSource: anropar `onEvent` för varje refresh/reset. Återansluter efter 3 s
   * vid fel (som EventSource). Ger en funktion som stänger strömmen.
   */
  stream(path: string, onEvent: () => void, onOpen: (ms: number, ok: boolean) => void): () => void {
    let closed = false;
    let current: http.ClientRequest | undefined;
    const connect = () => {
      if (closed) return;
      const started = performance.now();
      let opened = false;
      const retry = () => { if (!opened) onOpen(performance.now() - started, false); if (!closed) setTimeout(connect, 3_000); };
      current = http.request({ agent, host: this.url.hostname, port: this.url.port, path, headers: this.headers({ accept: "text/event-stream",
        "accept-encoding": "identity" }) }, (response) => {
        opened = true;
        onOpen(performance.now() - started, response.statusCode === 200);
        if (response.statusCode !== 200) { response.resume(); response.on("end", () => { if (!closed) setTimeout(connect, 3_000); }); return; }
        let buffer = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (/^event: (refresh|reset)$/m.test(block)) onEvent();
          }
        });
        response.on("end", () => { if (!closed) setTimeout(connect, 3_000); });
        response.on("error", () => undefined);
      });
      current.on("error", retry);
      current.end();
    };
    connect();
    return () => { closed = true; current?.destroy(); };
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** CPU (kärnor) och minne för en cgroup (v1: cpuacct + memory, v2: cpu.stat + memory.current). */
export class CgroupMeter {
  private last: { at: number; usageNs: number } | undefined;
  readonly cpu: number[] = [];
  readonly memoryMb: number[] = [];
  constructor(readonly name: string, readonly path: string) {}

  private usageNs(): number {
    const v1 = `/sys/fs/cgroup/cpuacct/${this.path}/cpuacct.usage`;
    if (existsSync(v1)) return Number(readFileSync(v1, "utf8"));
    const stat = readFileSync(`/sys/fs/cgroup/${this.path}/cpu.stat`, "utf8");
    return Number(/usage_usec (\d+)/.exec(stat)![1]) * 1000;
  }

  private memoryBytes(): number {
    const v1 = `/sys/fs/cgroup/memory/${this.path}/memory.stat`;
    if (existsSync(v1)) {
      const stat = readFileSync(v1, "utf8");
      const value = (key: string) => Number(new RegExp(`^total_${key} (\\d+)$`, "m").exec(stat)?.[1] ?? 0);
      // Utan sidcache: det som processerna faktiskt håller (rss + delat minne, t.ex. PostgreSQL:s shared_buffers).
      return value("rss") + value("shmem") + value("mapped_file");
    }
    return Number(readFileSync(`/sys/fs/cgroup/${this.path}/memory.current`, "utf8"));
  }

  sample(): void {
    const now = performance.now(), usage = this.usageNs();
    if (this.last) this.cpu.push((usage - this.last.usageNs) / ((now - this.last.at) * 1e6));
    this.last = { at: now, usageNs: usage };
    this.memoryMb.push(this.memoryBytes() / 1024 / 1024);
  }
}

export function averages(values: readonly number[]): { mean: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), p95: percentile(sorted, 95), max: sorted.at(-1) ?? Number.NaN };
}
