import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { geoJobMemoryGb, type GeoServerView } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { releaseStaleGeoJobs } from "./map-project-geo-jobs";
import type { ServerMessage } from "./server-status";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 K5b (ägaren 2026-11-08): geo-servern startas hos Hetzner när ett geo-jobb väntar och raderas när den stått utan
 * jobb en stund. Servertyper och platser provas i tur och ordning; den första som går att skapa används. Månadens kostnad
 * räknas ur servrarna (Hetzner tar betalt per påbörjad timme) och hålls under budgeten. Ägaren (superadmin) får mejl, högst ett
 * per sort och dygn, när ingen typ går att skapa, när en reservtyp användes och när budgeten är slut.
 *
 * Geo-servern får en egen nyckel (bara sha256 sparas här) i sin uppstart och kör avbildningen `otid-geo`; den talar bara HTTPS
 * med O-Tid. Servrar med O-Tids etikett som inte finns i tabellen raderas (en krasch mitt i en start lämnar inget efter sig).
 */
const servers = schema.geoServers;
const states = schema.geoServerStates;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** En server som inte hört av sig så här länge efter starten raderas (och en ny provas). */
const START_TIMEOUT_MS = 15 * 60_000;
/** En server som varit igång men inte hört av sig så här länge raderas (arbetaren frågar efter jobb var 15:e sekund). */
const SILENT_MS = 10 * 60_000;
/** Varvets lås (en rad i `geo_server_state`) räknas som övergivet efter så här lång tid. */
const LEASE_MS = 5 * 60_000;
/** Pris när Hetzner inte uppger något för typen: högsta kända priset, eller det här om inget är känt (räkna högt). */
const UNKNOWN_HOURLY_EUR = 0.2;
/** Högst så många nya servrar per timme (om något går fel i starten blir det inte en ström av servrar). */
const STARTS_PER_HOUR = 3;

export interface GeoServerSettings {
  readonly token: string; readonly types: readonly string[]; readonly locations: readonly string[];
  readonly idleMinutes: number; readonly budgetEur: number; readonly maxHours: number;
  readonly image: string; readonly origin: string; readonly label: string;
}

/** Inställningarna ur miljön; inget när Hetzner-nyckeln saknas (då startas ingen geo-server). */
export function geoServerSettings(environment: Record<string, string | undefined>): GeoServerSettings | undefined {
  const token = environment.OTID_HETZNER_TOKEN?.trim();
  const origin = environment.O_TID_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
  if (!token || !origin) return undefined;
  const list = (value: string | undefined, fallback: string[]) => {
    const items = (value ?? "").split(",").map(item => item.trim().toLowerCase()).filter(item => /^[a-z0-9-]{2,30}$/.test(item));
    return items.length ? items : fallback;
  };
  const number = (value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return value?.trim() && Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const tag = environment.OTID_TAG?.trim() || "main";
  let host = "otid";
  try { host = new URL(origin).hostname; } catch { /* ogiltig adress: etiketten blir "otid" */ }
  return { token, types: list(environment.OTID_GEO_SERVER_TYPES, ["cx33", "cx23", "cax11", "cpx32", "cpx22"]), locations: list(environment.OTID_GEO_SERVER_LOCATIONS, ["fsn1", "nbg1", "hel1"]),
    idleMinutes: number(environment.OTID_GEO_IDLE_MINUTES, 20, 5, 240), budgetEur: number(environment.OTID_GEO_BUDGET_EUR_PER_MONTH, 10, 0, 1000),
    maxHours: number(environment.OTID_GEO_MAX_HOURS, 8, 1, 48),
    image: environment.OTID_GEO_IMAGE?.trim() || `ghcr.io/joelberring/otid-geo:${/^[A-Za-z0-9_.-]{1,128}$/.test(tag) ? tag : "main"}`,
    origin, label: host.replace(/[^a-z0-9.-]/gi, "-").slice(0, 63) || "otid" };
}

// --- Hetzner ---------------------------------------------------------------------------------------------------------

export type CreateResult = { readonly ok: true; readonly id: number } | { readonly ok: false; readonly code: string; readonly message: string };
export interface HetznerServer { readonly id: number; readonly name: string; readonly created: string }
export interface HetznerType { readonly name: string; readonly memoryGb: number; readonly architecture: string; readonly deprecated: boolean;
  readonly hourly: ReadonlyMap<string, number> }
export interface Hetzner {
  create(input: { name: string; type: string; location: string; userData: string; labels: Record<string, string> }): Promise<CreateResult>;
  remove(id: number): Promise<boolean>;
  list(label: string): Promise<HetznerServer[]>;
  types(): Promise<HetznerType[]>;
}

/** Hetzners API (https://api.hetzner.cloud/v1) med projektets nyckel. */
export function hetznerClient(token: string, fetcher: typeof fetch = fetch, baseUrl = "https://api.hetzner.cloud/v1"): Hetzner {
  const call = async (path: string, init: RequestInit = {}) => fetcher(`${baseUrl}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" } });
  return {
    async create(input) {
      const response = await call("/servers", { method: "POST", body: JSON.stringify({ name: input.name, server_type: input.type, location: input.location,
        image: "ubuntu-24.04", user_data: input.userData, labels: input.labels, start_after_create: true,
        public_net: { enable_ipv4: true, enable_ipv6: true } }) });
      const body = await response.json().catch(() => undefined) as { server?: { id?: number }; error?: { code?: string; message?: string } } | undefined;
      if (response.ok && typeof body?.server?.id === "number") return { ok: true, id: body.server.id };
      return { ok: false, code: body?.error?.code ?? `http-${response.status}`, message: (body?.error?.message ?? "").slice(0, 300) };
    },
    async remove(id) {
      const response = await call(`/servers/${id}`, { method: "DELETE" });
      return response.ok || response.status === 404;
    },
    async list(label) {
      const response = await call(`/servers?label_selector=${encodeURIComponent(`otid-geo=${label}`)}&per_page=50`);
      if (!response.ok) throw new Error(`Hetzner svarade ${response.status}`);
      const body = await response.json() as { servers?: { id: number; name: string; created: string }[] };
      return (body.servers ?? []).map(server => ({ id: server.id, name: server.name, created: server.created }));
    },
    async types() {
      const response = await call("/server_types?per_page=50");
      if (!response.ok) throw new Error(`Hetzner svarade ${response.status}`);
      const body = await response.json() as { server_types?: { name: string; memory: number; architecture: string; deprecation?: unknown;
        deprecated?: boolean; prices?: { location: string; price_hourly?: { gross?: string } }[] }[] };
      return (body.server_types ?? []).map(type => ({ name: type.name, memoryGb: type.memory, architecture: type.architecture,
        deprecated: !!type.deprecation || type.deprecated === true,
        hourly: new Map((type.prices ?? []).map(price => [price.location, Number(price.price_hourly?.gross ?? NaN)] as const)
          .filter(([, value]) => Number.isFinite(value))) }));
    }
  };
}

/** Koder som betyder att typen inte går att få på platsen just nu (nästa i listan provas). */
const UNAVAILABLE = new Set(["resource_unavailable", "placement_error", "unavailable", "invalid_input", "not_found", "server_type_unavailable"]);

/**
 * Uppstarten (cloud-init): Docker och geo-arbetaren, som startar om sig själv om den stannar. Behållarens minnestak är 85 % av
 * serverns minne, räknat på servern. Förut stod 3500 MB fast (satt för den minsta servern): hela Djurgården och Nåttarö
 * 2026-11-11–12 slog i taket, behållaren dödades och startades om, och jobbet stod kvar tills «Geo-arbetaren slutade svara».
 */
export function geoCloudInit(input: { image: string; origin: string; token: string; name: string }): string {
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  return ["#cloud-config", "package_update: true", "packages:", "  - docker.io", "runcmd:", "  - systemctl enable --now docker",
    `  - docker run -d --restart unless-stopped --name otid-geo --memory $(awk '/MemTotal/ { print int($2 / 1024 * 0.85) }' /proc/meminfo)m -e OTID_GEO_ORIGIN=${quote(input.origin)} `
      + `-e OTID_GEO_WORKER_TOKEN=${quote(input.token)} -e OTID_GEO_WORKER_NAME=${quote(input.name)} ${quote(input.image)}`, ""].join("\n");
}

// --- Läget ------------------------------------------------------------------------------------------------------------

type Notice = "UNAVAILABLE" | "FALLBACK" | "BUDGET" | "START_FAILED";
interface ServerState { readonly view: GeoServerView; readonly mailed: Partial<Record<Notice, string>>;
  /** Servrar vars arbetare är för gammal; raderas i nästa omgång. */
  readonly retired?: readonly string[] }

async function readState(db: DbExecutor): Promise<ServerState> {
  const [row] = await db.select().from(states).where(eq(states.key, "server"));
  const value = row?.value as Partial<ServerState> | undefined;
  return { view: value?.view ?? { state: "OFF", detail: null }, mailed: value?.mailed ?? {}, retired: Array.isArray(value?.retired) ? value.retired : [] };
}
async function writeState(db: DbExecutor, state: ServerState, now: Date): Promise<void> {
  await db.insert(states).values({ key: "server", value: state as unknown as Record<string, unknown>, updatedAt: now })
    .onConflictDoUpdate({ target: states.key, set: { value: state as unknown as Record<string, unknown>, updatedAt: now } });
}

/** Läget som användarna ser (geo-jobbens lista). */
export async function geoServerStateView(db: DbExecutor): Promise<GeoServerView> {
  return (await readState(db)).view;
}

/** Månadens kostnad i euro: varje påbörjad timme som en server funnits under månaden. */
export async function geoServerMonthCost(db: DbExecutor, now: Date): Promise<number> {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await db.select({ created: servers.createdAt, deleted: servers.deletedAt, hourly: servers.hourlyEur }).from(servers)
    .where(or(isNull(servers.deletedAt), gte(servers.deletedAt, month)));
  return rows.reduce((sum, row) => {
    const from = Math.max(row.created.getTime(), month.getTime()), to = (row.deleted ?? now).getTime();
    return to > from ? sum + Math.ceil((to - from) / HOUR) * row.hourly : sum;
  }, 0);
}

/** Geo-arbetarens nyckel från en server som O-Tid startat: ger serverns namn och noterar att den hörts av. */
export async function geoServerForToken(db: Database, token: string, now = new Date()): Promise<string | undefined> {
  const hash = createHash("sha256").update(token).digest("hex");
  const [row] = await db.update(servers).set({ lastSeenAt: now, status: "READY" })
    .where(and(eq(servers.tokenSha256, hash), ne(servers.status, "DELETED"))).returning({ name: servers.name });
  return row?.name;
}

/**
 * Servern har en äldre geo-arbetare (en server som fanns kvar när avbildningen byggdes om): den raderas i nästa omgång av
 * `manageGeoServer`, och en ny med den nya avbildningen startas för jobben som väntar.
 */
export async function retireGeoServer(db: Database, name: string, now = new Date()): Promise<void> {
  const [row] = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.name, name), ne(servers.status, "DELETED")));
  if (!row) return;
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('geo-server-state', 0))`);
    const state = await readState(tx);
    if (state.retired?.includes(name)) return;
    await writeState(tx, { ...state, retired: [...(state.retired ?? []), name].slice(-20) }, now);
  });
}

/** Ett jobb togs, gick eller blev klart på servern (tomgången räknas från det). */
export async function noteGeoServerJob(db: DbExecutor, name: string, now = new Date()): Promise<void> {
  await db.update(servers).set({ lastJobAt: now }).where(and(eq(servers.name, name), ne(servers.status, "DELETED")));
}

export type GeoMailer = (message: ServerMessage) => Promise<void>;

function dueMail(state: ServerState, notice: Notice, now: Date): boolean {
  const last = state.mailed[notice];
  return !last || now.getTime() - new Date(last).getTime() >= DAY;
}

export interface ManageResult { readonly action: "none" | "created" | "deleted" | "unavailable" | "budget"; readonly detail: string | null }

/**
 * Ett varv (varje minut i webben): radera servrar som stått utan jobb, inte startat, tystnat eller gått för länge, och starta
 * en när jobb väntar och ingen finns. Ägaren mejlas enligt ovan. Översynen A3: varvet tar ett lås i databasen (en rad i
 * `geo_server_state` med tid), så att två webbprocesser (t.ex. under en omstart) inte startar var sin server.
 */
export async function manageGeoServer(db: Database, hetzner: Hetzner, settings: GeoServerSettings, mail: GeoMailer, now = new Date())
  : Promise<ManageResult> {
  const lease = await db.execute<{ key: string }>(sql`
    insert into geo_server_state (key, value, updated_at) values ('lease', '{}'::jsonb, ${now})
    on conflict (key) do update set updated_at = excluded.updated_at
      where geo_server_state.updated_at < ${new Date(now.getTime() - LEASE_MS)}
    returning key`);
  if (lease.rows.length === 0) return { action: "none", detail: "ett annat varv pågår" };
  try {
    return await manageRound(db, hetzner, settings, mail, now);
  } finally {
    await db.update(states).set({ updatedAt: new Date(0) }).where(eq(states.key, "lease"));
  }
}

async function manageRound(db: Database, hetzner: Hetzner, settings: GeoServerSettings, mail: GeoMailer, now: Date): Promise<ManageResult> {
  await releaseStaleGeoJobs(db, now);
  const [{ waiting, running } = { waiting: 0, running: 0 }] = await db.select({
    waiting: sql<number>`count(*) filter (where ${schema.mapProjectGeoJobs.status} = 'QUEUED')::int`,
    running: sql<number>`count(*) filter (where ${schema.mapProjectGeoJobs.status} = 'RUNNING')::int` })
    .from(schema.mapProjectGeoJobs).where(inArray(schema.mapProjectGeoJobs.status, ["QUEUED", "RUNNING"]));
  const active = await db.select().from(servers).where(ne(servers.status, "DELETED"));
  const state = await readState(db);
  const mailed = { ...state.mailed };
  const retired = new Set(state.retired ?? []);
  const remove = async (row: typeof active[number], reason: string) => {
    if (row.providerId !== null && !await hetzner.remove(row.providerId)) throw new Error(`Hetzner raderade inte ${row.name}`);
    await db.update(servers).set({ status: "DELETED", deletedAt: now, deleteReason: reason }).where(eq(servers.id, row.id));
  };

  // Servrar med O-Tids etikett som tabellen inte känner till (en start som avbröts) raderas.
  const known = new Set(active.map(row => row.providerId));
  for (const orphan of await hetzner.list(settings.label)) {
    if (!known.has(orphan.id) && now.getTime() - new Date(orphan.created).getTime() > 5 * 60_000) await hetzner.remove(orphan.id);
  }

  let deleted: string | null = null;
  for (const row of active) {
    const lastActivity = Math.max(row.createdAt.getTime(), row.lastJobAt?.getTime() ?? 0);
    if (retired.has(row.name)) {
      await remove(row, "gammal version");
      deleted = `${row.name} hade en äldre geo-arbetare`;
    } else if (row.status === "STARTING" && now.getTime() - row.createdAt.getTime() > START_TIMEOUT_MS) {
      await remove(row, "startade inte");
      deleted = `${row.name} startade inte inom 15 minuter`;
      if (dueMail(state, "START_FAILED", now)) {
        await mail({ subject: "O-Tid: geo-servern startade inte", text: `Geo-servern ${row.name} (${row.serverType}, ${row.location}) hörde inte av sig inom `
          + `15 minuter och raderades. Kontrollera att avbildningen ${settings.image} finns och att ${settings.origin} nås från Hetzner.` });
        mailed.START_FAILED = now.toISOString();
      }
    } else if (now.getTime() - row.createdAt.getTime() > settings.maxHours * HOUR) {
      await remove(row, `längre än ${settings.maxHours} timmar`);
      deleted = `${row.name} har gått i ${settings.maxHours} timmar`;
    } else if (row.status === "READY" && row.lastSeenAt && now.getTime() - row.lastSeenAt.getTime() > SILENT_MS) {
      // Översynen C1: arbetaren har tystnat (servern hängde eller Docker stannade). Dess jobb läggs tillbaka i kön ovan.
      await remove(row, "hördes inte av");
      deleted = `${row.name} har inte hört av sig på 10 minuter`;
    } else if (waiting === 0 && running === 0 && now.getTime() - lastActivity > settings.idleMinutes * 60_000) {
      await remove(row, "tomgång");
      deleted = `${row.name} utan jobb i ${settings.idleMinutes} minuter`;
    }
  }
  const remaining = await db.select().from(servers).where(ne(servers.status, "DELETED"));
  const stillRetired = (state.retired ?? []).filter(name => remaining.some(row => row.name === name));
  const view = (next: GeoServerView) => writeState(db, { view: next, mailed, retired: stillRetired }, now);

  if (remaining.length > 0) {
    await view({ state: remaining.some(row => row.status === "READY") ? "READY" : "STARTING", detail: null });
    return { action: deleted ? "deleted" : "none", detail: deleted };
  }
  if (waiting === 0) {
    await view({ state: "OFF", detail: null });
    return { action: deleted ? "deleted" : "none", detail: deleted };
  }

  const [{ recent } = { recent: 0 }] = await db.select({ recent: sql<number>`count(*)::int` }).from(servers)
    .where(gte(servers.createdAt, new Date(now.getTime() - HOUR)));
  if (recent >= STARTS_PER_HOUR) {
    await view({ state: "UNAVAILABLE", detail: "Flera starter i rad misslyckades; nytt försök om en stund." });
    return { action: "unavailable", detail: "för många starter" };
  }

  const types = await hetzner.types().catch(() => [] as HetznerType[]);
  // Servern väljs efter det största väntande jobbet (ägaren 2026-11-12): en typ med för lite minne provas inte, eftersom
  // jobbet då dör mitt i. Går typernas minne inte att läsa hos Hetzner provas alla, som förut.
  const queued = await db.select({ request: schema.mapProjectGeoJobs.request }).from(schema.mapProjectGeoJobs).where(eq(schema.mapProjectGeoJobs.status, "QUEUED"));
  const needGb = Math.max(4, ...queued.map(row => geoJobMemoryGb(row.request as Parameters<typeof geoJobMemoryGb>[0])));
  const bigEnough = (type: string) => types.length === 0 || (types.find(row => row.name === type)?.memoryGb ?? 0) >= needGb;
  const firstFit = settings.types.findIndex(bigEnough);
  if (firstFit < 0) {
    const detail = `Området behöver en geo-server med minst ${needGb} GB minne, och ingen sådan typ är inställd. Dela området i etapper.`;
    await view({ state: "UNAVAILABLE", detail });
    if (dueMail(state, "UNAVAILABLE", now)) {
      await mail({ subject: "O-Tid: ingen geo-server är stor nog", text: `Ett geo-jobb i kön behöver minst ${needGb} GB minne, men ingen av typerna i `
        + `OTID_GEO_SERVER_TYPES (${settings.types.join(", ")}) har det. Lägg till en större typ i .env och starta om web, eller be användaren dela området i etapper.` });
      mailed.UNAVAILABLE = now.toISOString();
      await writeState(db, { view: { state: "UNAVAILABLE", detail }, mailed, retired: stillRetired }, now);
    }
    return { action: "unavailable", detail: `inget med ${needGb} GB` };
  }
  const cost = await geoServerMonthCost(db, now);
  // Översynen C2: ett okänt pris räknas högt, inte lågt, så att budgeten inte överskrids med en dyrare reservtyp.
  const prices = types.flatMap(type => [...type.hourly.values()]);
  const highestKnown = prices.length ? Math.max(...prices) : UNKNOWN_HOURLY_EUR;
  const tried: string[] = [];
  for (const [typeIndex, type] of settings.types.entries()) {
    if (!bigEnough(type)) continue;
    for (const location of settings.locations) {
      const hourly = types.find(row => row.name === type)?.hourly.get(location) ?? highestKnown;
      if (cost + hourly > settings.budgetEur) {
        if (dueMail(state, "BUDGET", now)) {
          await mail({ subject: "O-Tid: geo-serverns budget är slut", text: `Månadens kostnad för geo-servern är ${cost.toFixed(2)} € av `
            + `${settings.budgetEur} € (OTID_GEO_BUDGET_EUR_PER_MONTH). ${waiting} geo-jobb väntar i kön. Höj budgeten och starta om web, eller vänta till nästa månad.` });
          mailed.BUDGET = now.toISOString();
        }
        await view({ state: "BUDGET", detail: null });
        return { action: "budget", detail: `${cost.toFixed(2)} av ${settings.budgetEur} €` };
      }
      const token = randomBytes(32).toString("hex");
      const name = `otid-geo-${randomUUID().slice(0, 8)}`;
      const created = await hetzner.create({ name, type, location, labels: { "otid-geo": settings.label },
        userData: geoCloudInit({ image: settings.image, origin: settings.origin, token, name }) });
      if (!created.ok) {
        tried.push(`${type} i ${location}: ${created.code}`);
        if (UNAVAILABLE.has(created.code)) continue;
        // Andra fel (nyckeln, kontots gränser): inget mer provas i det här varvet.
        await view({ state: "UNAVAILABLE", detail: null });
        if (dueMail(state, "UNAVAILABLE", now)) {
          await mail({ subject: "O-Tid: geo-servern kunde inte skapas", text: `Hetzner svarade ${created.code}: ${created.message}\n\n${waiting} geo-jobb väntar. `
            + "Kontrollera OTID_HETZNER_TOKEN (Läs och skriv) och projektets gränser hos Hetzner." });
          mailed.UNAVAILABLE = now.toISOString();
        }
        return { action: "unavailable", detail: created.code };
      }
      await db.insert(servers).values({ id: randomUUID(), providerId: created.id, name, serverType: type, location, hourlyEur: hourly,
        tokenSha256: createHash("sha256").update(token).digest("hex"), status: "STARTING", createdAt: now });
      if (typeIndex > firstFit && dueMail(state, "FALLBACK", now)) {
        await mail({ subject: "O-Tid: geo-servern startade med en reservtyp", text: `Geo-servern startade som ${type} i ${location}, eftersom `
          + `${settings.types.slice(firstFit, typeIndex).filter(bigEnough).join(", ")} inte gick att skapa just nu. Allt fungerar, men lägg gärna till fler typer i `
          + `OTID_GEO_SERVER_TYPES innan även reserven tar slut.\n\nFörsök: ${tried.join("; ")}` });
        mailed.FALLBACK = now.toISOString();
      }
      await view({ state: "STARTING", detail: null });
      return { action: "created", detail: `${type} i ${location}` };
    }
  }

  // Ingen typ gick att skapa någonstans.
  await view({ state: "UNAVAILABLE", detail: null });
  if (dueMail(state, "UNAVAILABLE", now)) {
    const suggestions = types.filter(type => !type.deprecated && type.memoryGb >= 4 && !settings.types.includes(type.name))
      .map(type => ({ name: type.name, price: Math.min(...[...type.hourly.values()]) })).filter(type => Number.isFinite(type.price))
      .sort((a, b) => a.price - b.price).slice(0, 5).map(type => `${type.name} (från ${type.price.toFixed(4)} €/h)`);
    await mail({ subject: "O-Tid: ingen geo-server går att skapa", text: `Ingen av typerna i OTID_GEO_SERVER_TYPES (${settings.types.join(", ")}) gick att skapa `
      + `på platserna ${settings.locations.join(", ")}. ${waiting} geo-jobb väntar i kön och körs när en server går att starta.\n\n`
      + `Försök: ${tried.join("; ")}\n\n`
      + (suggestions.length ? `Andra typer hos Hetzner med minst 4 GB (kan också vara slut): ${suggestions.join(", ")}.\n` : "")
      + "Lägg till en typ i OTID_GEO_SERVER_TYPES i .env och starta om web (docker compose -f docker-compose.prod.yml up -d web)." });
    mailed.UNAVAILABLE = now.toISOString();
  }
  await writeState(db, { view: { state: "UNAVAILABLE", detail: null }, mailed, retired: (await readState(db)).retired ?? [] }, now);
  return { action: "unavailable", detail: tried.join("; ") };
}
