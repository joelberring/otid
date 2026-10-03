import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createTlsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Socket } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createDatabase } from "@o-tid/database";
import { issuePairingAdminAccessCredential, issueRouteUploadGrantAsAdmin, loginPairingAdmin,
  redeemRouteUploadBearerLink, routeUploadBearerTokenPrefix } from "@o-tid/application";

const confirmation = "isolated-linux-next-standalone-writer-drain";
const gpx = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid TASK212"><trk><trkseg><trkpt lat="59.3" lon="18.0"/><trkpt lat="59.4" lon="18.1"/></trkseg></trk></gpx>');
const sha256 = createHash("sha256").update(gpx).digest("hex");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`TASK212_MISSING_${name}`);
  return value;
}
function port(name: string): number {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`TASK212_INVALID_${name}`);
  return value;
}
function assertDisposable(): void {
  if (process.platform !== "linux") throw new Error("TASK212_REQUIRES_LINUX");
  if (required("TASK212_CONFIRM") !== confirmation) throw new Error("TASK212_CONFIRMATION_REQUIRED");
  const databaseUrl = new URL(required("DATABASE_URL"));
  if (!(["postgres:", "postgresql:"].includes(databaseUrl.protocol)) || databaseUrl.hostname !== "127.0.0.1")
    throw new Error("TASK212_DATABASE_MUST_BE_LOOPBACK_POSTGRES");
  if (required("TEST_DATABASE_URL") !== databaseUrl.toString()) throw new Error("TASK212_DATABASE_URLS_MUST_MATCH_EXACTLY");
  if (!/^otid_task212_[a-f0-9]{8,}$/.test(databaseUrl.pathname.slice(1))) throw new Error("TASK212_DATABASE_NAME_NOT_DISPOSABLE");
  const objectEndpoint = new URL(required("TASK212_MINIO_ENDPOINT"));
  if (!(["127.0.0.1", "::1"].includes(objectEndpoint.hostname)) || objectEndpoint.pathname !== "/" || objectEndpoint.search || objectEndpoint.hash)
    throw new Error("TASK212_MINIO_MUST_BE_LOOPBACK_ROOT");
  if (!/^otid-task212-[a-f0-9]{8,}$/.test(required("TASK212_MINIO_BUCKET"))) throw new Error("TASK212_BUCKET_NOT_DISPOSABLE");
  if (port("TASK212_STANDALONE_PORT") === port("TASK212_GATE_PORT")) throw new Error("TASK212_PORTS_MUST_DIFFER");
  for (const name of ["TASK212_TLS_KEY", "TASK212_TLS_CERT", "TASK212_TLS_CA_CERT", "TASK212_STANDALONE_SERVER"] as const)
    if (!isAbsolute(required(name))) throw new Error(`TASK212_ABSOLUTE_PATH_REQUIRED_${name}`);
  if (required("TASK212_STANDALONE_SERVER") !== resolve("apps/web/.next/standalone/apps/web/server.js"))
    throw new Error("TASK212_NOT_THIS_WEB_STANDALONE_SERVER");
}

type Gate = { blocked: Promise<void>; release(): void; close(): Promise<void>; successfulPuts(): number };
async function startObjectGate(): Promise<Gate> {
  const upstream = new URL(required("TASK212_MINIO_ENDPOINT"));
  const key = await readFile(required("TASK212_TLS_KEY"));
  const cert = await readFile(required("TASK212_TLS_CERT"));
  let release!: () => void, blocked!: () => void, putCount = 0;
  const successfulKeys = new Set<string>();
  const releasePromise = new Promise<void>(done => { release = done; });
  const blockedPromise = new Promise<void>(done => { blocked = done; });
  const server = createTlsServer({ key, cert }, async (incoming, outgoing) => {
    if (incoming.method === "PUT") {
      const expectedPrefix = `/${required("TASK212_MINIO_BUCKET")}/route/`;
      if (!incoming.url?.startsWith(expectedPrefix)) { outgoing.writeHead(502); outgoing.end(); return; }
      putCount += 1;
      if (putCount === 2) blocked();
      await releasePromise;
    }
    const options = { protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port,
      method: incoming.method, path: incoming.url, headers: incoming.headers };
    const forward = (upstream.protocol === "https:" ? httpsRequest : httpRequest)(options, response => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
      if (incoming.method === "PUT" && response.statusCode && response.statusCode >= 200 && response.statusCode < 300 &&
        typeof response.headers["x-amz-version-id"] === "string" && incoming.url) successfulKeys.add(incoming.url);
    });
    forward.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(forward);
  });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(port("TASK212_GATE_PORT"), "127.0.0.1", ok); });
  return { blocked: blockedPromise, release, successfulPuts: () => successfulKeys.size,
    close: () => new Promise<void>((ok, fail) => { server.closeAllConnections(); server.close(error => error ? fail(error) : ok()); }) };
}

function within<T>(promise: Promise<T>, milliseconds: number, failure: string): Promise<T> {
  return new Promise<T>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(failure)), milliseconds);
    promise.then(value => { clearTimeout(timer); ok(value); }, error => {
      clearTimeout(timer); fail(error instanceof Error ? error : new Error(failure));
    });
  });
}

async function syntheticParticipant(db: ReturnType<typeof createDatabase>["db"], pool: ReturnType<typeof createDatabase>["pool"], suffix: string) {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID();
  await pool.query("INSERT INTO event(id,name,starts_on,time_zone) VALUES($1,$2,current_date,'Europe/Stockholm')", [eventId, `TASK212 ${suffix}`]);
  await pool.query("INSERT INTO race(id,event_id,name,race_date) VALUES($1,$2,$3,current_date)", [raceId, eventId, `TASK212 ${suffix}`]);
  await pool.query("INSERT INTO course(id,race_id,name) VALUES($1,$2,$3)", [courseId, raceId, `TASK212 ${suffix}`]);
  await pool.query("INSERT INTO course_version(id,course_id,version) VALUES($1,$2,1)", [courseVersionId, courseId]);
  await pool.query("INSERT INTO class(id,race_id,name,course_version_id,start_rule) VALUES($1,$2,$3,$4,'PUNCH')", [classId, raceId, `TASK212 ${suffix}`, courseVersionId]);
  await pool.query("INSERT INTO entry(id,race_id,class_id,given_name,family_name) VALUES($1,$2,$3,'Synthetic','Probe')", [entryId, raceId, classId]);
  const now = new Date(), credential = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "TASK212", expiresAt: new Date(now.getTime() + 3_600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("TASK212_ADMIN_LOGIN_FAILED");
  const grantId = randomUUID(), secret = Buffer.alloc(32, suffix.charCodeAt(0)).toString("base64url");
  const issued = await issueRouteUploadGrantAsAdmin(db, { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken,
    csrfHeader: login.csrfToken, idempotencyKey: `route-upload-grant:${randomUUID()}`, request: { formatVersion: 1, grantId, entryId,
      secretHash: createHash("sha256").update(Buffer.from(secret, "base64url")).digest("hex"), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() } }, now);
  if (issued.status !== "issued") throw new Error("TASK212_GRANT_FAILED");
  const session = await redeemRouteUploadBearerLink(db, `${routeUploadBearerTokenPrefix}.${grantId}.${secret}`, now);
  if (session.status !== "redeemed") throw new Error("TASK212_REDEEM_FAILED");
  return { raceId, sessionToken: session.sessionToken, csrf: session.csrfToken };
}

function headers(participant: Awaited<ReturnType<typeof syntheticParticipant>>) {
  return { origin: required("TASK212_PUBLIC_ORIGIN"), cookie: `__Host-otid-route-upload-session=${participant.sessionToken}; __Host-otid-route-upload-csrf=${participant.csrf}`,
    "x-otid-csrf": participant.csrf };
}
async function reserveUpload(portNumber: number, participant: Awaited<ReturnType<typeof syntheticParticipant>>) {
  const response = await fetch(`http://127.0.0.1:${portNumber}/api/route-upload/reservations`, { method: "POST", headers: { ...headers(participant),
    "content-type": "application/json", "idempotency-key": `route-upload:${randomUUID()}` }, body: JSON.stringify({ formatVersion: 1, fileName: "task212.gpx", mediaType: "application/gpx+xml", byteLength: gpx.length, sha256 }) });
  if (response.status !== 201) throw new Error(`TASK212_RESERVATION_HTTP_${response.status}`);
  const body = await response.json() as { uploadId?: unknown };
  if (typeof body.uploadId !== "string") throw new Error("TASK212_RESERVATION_RESPONSE_INVALID");
  return body.uploadId;
}
function connectedPut(portNumber: number, uploadId: string, participant: Awaited<ReturnType<typeof syntheticParticipant>>): Promise<number> {
  return new Promise((ok, fail) => { const request = httpRequest({ hostname: "127.0.0.1", port: portNumber, path: `/api/route-upload/reservations/${uploadId}`,
    method: "PUT", headers: { ...headers(participant), "content-type": "application/gpx+xml", "content-length": gpx.length } }, response => {
      response.resume(); response.once("end", () => ok(response.statusCode ?? 0)); }); request.once("error", fail); request.end(gpx); });
}
async function abortedPut(portNumber: number, uploadId: string, participant: Awaited<ReturnType<typeof syntheticParticipant>>): Promise<Socket> {
  const socket = new Socket(); await new Promise<void>((ok, fail) => { socket.once("error", fail); socket.connect(portNumber, "127.0.0.1", ok); });
  const h = headers(participant);
  socket.write([`PUT /api/route-upload/reservations/${uploadId} HTTP/1.1`, `Host: 127.0.0.1:${portNumber}`, `Origin: ${h.origin}`,
    `Cookie: ${h.cookie}`, `X-Otid-Csrf: ${h["x-otid-csrf"]}`, "Content-Type: application/gpx+xml", `Content-Length: ${gpx.length}`, "Connection: keep-alive", "", ""].join("\r\n"));
  socket.write(gpx); return socket;
}
async function waitListening(portNumber: number): Promise<void> {
  for (let count = 0; count < 100; count++) { try { await new Promise<void>((ok, fail) => { const socket = new Socket(); socket.once("error", fail); socket.connect(portNumber, "127.0.0.1", () => { socket.destroy(); ok(); }); }); return; } catch { await new Promise(done => setTimeout(done, 100)); } }
  throw new Error("TASK212_STANDALONE_NOT_LISTENING");
}
function exited(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise(ok => child.once("exit", ok));
}

async function main(): Promise<void> {
  assertDisposable();
  const webPackage = JSON.parse(await readFile(resolve("apps/web/package.json"), "utf8")) as { dependencies?: { next?: unknown } };
  if (webPackage.dependencies?.next !== "16.3.3") throw new Error("TASK212_NEXT_PIN_CHANGED_REVIEW_REQUIRED");
  const database = createDatabase(required("DATABASE_URL"));
  let gate: Gate | undefined;
  let server: ChildProcess | undefined;
  try {
    const existingEvents = await database.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM event");
    if (existingEvents.rows[0]?.count !== 0) throw new Error("TASK212_DATABASE_NOT_EMPTY");
    gate = await startObjectGate();
    const participants = [await syntheticParticipant(database.db, database.pool, "A"), await syntheticParticipant(database.db, database.pool, "B")];
    const standalonePort = port("TASK212_STANDALONE_PORT");
    server = spawn(process.execPath, [required("TASK212_STANDALONE_SERVER")], { cwd: resolve(required("TASK212_STANDALONE_SERVER"), ".."), stdio: ["ignore", "inherit", "inherit"], env: {
      ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(standalonePort), O_TID_PUBLIC_ORIGIN: required("TASK212_PUBLIC_ORIGIN"),
      OTID_ROUTE_STORE_ID: required("TASK212_ROUTE_STORE_ID"), OTID_ROUTE_STORE_ENDPOINT: `https://127.0.0.1:${port("TASK212_GATE_PORT")}`,
      OTID_ROUTE_STORE_BUCKET: required("TASK212_MINIO_BUCKET"), OTID_ROUTE_STORE_REGION: required("TASK212_MINIO_REGION"),
      OTID_ROUTE_STORE_ACCESS_KEY: required("TASK212_MINIO_ACCESS_KEY"), OTID_ROUTE_STORE_SECRET_KEY: required("TASK212_MINIO_SECRET_KEY"),
      OTID_ROUTE_STORE_MODE: "production", NODE_TLS_REJECT_UNAUTHORIZED: "1", NODE_EXTRA_CA_CERTS: required("TASK212_TLS_CA_CERT")
    } });
    await waitListening(standalonePort);
    const uploadIds = [await reserveUpload(standalonePort, participants[0]!), await reserveUpload(standalonePort, participants[1]!)];
    const connected = connectedPut(standalonePort, uploadIds[0]!, participants[0]!);
    const abandoned = await abortedPut(standalonePort, uploadIds[1]!, participants[1]!);
    await within(gate.blocked, 20_000, "TASK212_OBJECT_PUT_NOT_BLOCKED");
    abandoned.destroy(); // Real client-side TCP abort after the server has entered its S3 PUT.
    server.kill("SIGTERM");
    const exitPromise = exited(server);
    const earlyExit = await Promise.race([exitPromise.then(() => true), new Promise<false>(ok => setTimeout(() => ok(false), 500))]);
    if (earlyExit) throw new Error("TASK212_STANDALONE_EXITED_BEFORE_OBJECT_RELEASE");
    gate.release();
    if (await within(connected, 20_000, "TASK212_CONNECTED_REQUEST_TIMED_OUT") !== 201)
      throw new Error("TASK212_CONNECTED_REQUEST_NOT_STORED");
    const exitCode = await within(exitPromise, 20_000, "TASK212_STANDALONE_DID_NOT_EXIT");
    if (exitCode !== 0 || gate.successfulPuts() !== 2) throw new Error("TASK212_STANDALONE_OR_OBJECT_RESULT_INVALID");
    const stored = await database.pool.query<{ upload_id: string }>("SELECT upload_id FROM route_object_manifest WHERE upload_id = ANY($1::uuid[]) ORDER BY upload_id", [uploadIds]);
    const points = await database.pool.query<{ upload_id: string; count: number }>("SELECT upload_id,count(*)::int AS count FROM route_point WHERE upload_id = ANY($1::uuid[]) GROUP BY upload_id", [uploadIds]);
    if (stored.rowCount !== 2 || points.rowCount !== 2 || points.rows.some(row => row.count !== 2)) throw new Error("TASK212_FINAL_DATABASE_STATE_NOT_DURABLE");
    process.stdout.write(JSON.stringify({ result: "TASK212_STANDALONE_DRAIN_OBSERVED", connectedClient: "stored", tcpAbortedClient: "stored", objectPuts: 2, manifests: 2 }) + "\n");
  } finally {
    if (server && server.exitCode === null) server.kill("SIGKILL");
    gate?.release(); await gate?.close().catch(() => undefined); await database.pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "TASK212_UNKNOWN_FAILURE"}\n`);
  process.exitCode = 1;
});
