import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "minio";
import { createPmObjectStore, createRouteObjectStore } from "../src";

// Opt-in native test runner. It creates its own target, never adopts a server.
const expectedSha = "0939ce5553ce9e6451b69e049fbf399794368276b61da8166f84cbd8c7f2d641";
const binary = process.argv[2];
if (!binary || process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Pinned darwin-arm64 MinIO binary required");
const binaryPath = resolve(binary);
const packageRoot = resolve(new URL("..", import.meta.url).pathname);
if (createHash("sha256").update(await readFile(binaryPath)).digest("hex") !== expectedSha) throw new Error("MinIO checksum mismatch");
await chmod(binaryPath, 0o700);
const directory = await mkdtemp("/private/tmp/otid-minio-run-");
await chmod(directory, 0o700);
const data = join(directory, "data");
await mkdir(data, { mode: 0o700 });
const accessKey = `otid${randomBytes(10).toString("hex")}`;
const secretKey = randomBytes(32).toString("hex");
await writeFile(join(directory, "credentials.json"), JSON.stringify({ accessKey, secretKey }), { mode: 0o600, flag: "wx" });
console.log(`Private test directory: ${directory}`);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test port unavailable");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
const port = await freePort();
let consolePort = await freePort();
while (consolePort === port) consolePort = await freePort();
const endpoint = `http://127.0.0.1:${port}`;
const log = await open(join(directory, "server.log"), "a", 0o600);
let server: ChildProcess | undefined;
let exited: Promise<void> | undefined;
let spawnFailed = false;

async function start(): Promise<void> {
  spawnFailed = false;
  server = spawn(binaryPath, ["server", data, "--address", `127.0.0.1:${port}`, "--console-address", `127.0.0.1:${consolePort}`, "--quiet"], {
    env: { PATH: process.env.PATH ?? "", MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: secretKey, MINIO_BROWSER: "off", MINIO_UPDATE: "off" },
    stdio: ["ignore", log.fd, log.fd]
  });
  exited = new Promise(resolve => {
    server!.once("error", () => { spawnFailed = true; resolve(); });
    server!.once("exit", () => resolve());
  });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (spawnFailed || server.exitCode !== null || server.signalCode !== null) throw new Error("MinIO stopped before readiness; inspect private log");
    try {
      const response = await fetch(`${endpoint}/minio/health/live`, { signal: AbortSignal.timeout(500) });
      await response.arrayBuffer();
      if (response.status === 200) return;
    } catch (error) {
      // Expected refusal during startup; only bounded retries while child is live.
      if (!(error instanceof Error)) throw error;
    }
    await delay(100);
  }
  throw new Error("MinIO readiness deadline exceeded");
}

async function stop(): Promise<void> {
  if (!server || !exited) return;
  if (server.exitCode !== null || server.signalCode !== null || spawnFailed) { await exited; return; }
  server.kill("SIGTERM");
  let forced = false;
  const timer = setTimeout(() => { forced = true; server?.kill("SIGKILL"); }, 10_000);
  try { await exited; } finally { clearTimeout(timer); }
  if (forced) throw new Error("MinIO required forced shutdown");
}

try {
  await start();
  console.log("Pinned MinIO ready on loopback; running isolated integration tests.");
  const resultLog = await open(join(directory, "integration.log"), "wx", 0o600);
  try {
    const testEnvironment = { ...process.env, CI: "true", OTID_MINIO_TEST_CONFIRM: "isolated-disposable-minio", OTID_MINIO_TEST_ENDPOINT: endpoint,
      OTID_MINIO_TEST_ACCESS_KEY: accessKey, OTID_MINIO_TEST_SECRET_KEY: secretKey };
    const scripts = process.env.TEST_DATABASE_URL ? ["test:integration:minio", "test:integration:minio-route", "test:integration:minio-transfer"] : ["test:integration:minio", "test:integration:minio-route"];
    if (process.env.OTID_PM_NATIVE_SCANNER_ROOT) {
      if (!process.env.TEST_DATABASE_URL) throw new Error("Native scan integration requires isolated TEST_DATABASE_URL");
      scripts.push("test:integration:minio-scan");
    }
    for (const script of scripts) {
      const tests = spawn("pnpm", [script], { cwd: packageRoot, env: testEnvironment, stdio: ["ignore", resultLog.fd, resultLog.fd] });
      const code = await new Promise<number | null>((resolve, reject) => { tests.once("error", reject); tests.once("exit", resolve); });
      if (code !== 0) throw new Error("MinIO integration failed; inspect private integration.log");
    }
  } finally { await resultLog.close(); }

  const client = new Client({ endPoint: "127.0.0.1", port, useSSL: false, region: "us-east-1", accessKey, secretKey, retryOptions: { disableRetry: true } });
  const bucket = `otid-pm-restart-${randomUUID()}`;
  await client.makeBucket(bucket, "us-east-1");
  await client.setBucketVersioning(bucket, { Status: "Enabled" });
  const config = { storeId: randomUUID(), endpoint, bucket, region: "us-east-1", accessKey, secretKey, mode: "loopback-development" };
  const bytes = Buffer.from("synthetic immutable version before restart");
  const manifest = await createPmObjectStore(config).put({ raceId: randomUUID(), attemptId: randomUUID(),
    sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length }, bytes);
  await client.putObject(bucket, manifest.key, Buffer.from("a newer version"));
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ bucket, manifest }), { mode: 0o600, flag: "wx" });
  await stop();
  console.log("MinIO stopped cleanly; restarting the same private data directory.");
  await start();
  const restored = await createPmObjectStore(config).read(manifest);
  if (!restored.equals(bytes)) throw new Error("Version changed across restart");
  const routeBucket = `otid-route-restart-${randomUUID()}`;
  await client.makeBucket(routeBucket, "us-east-1");
  await client.setBucketVersioning(routeBucket, { Status: "Enabled" });
  const routeConfig = { storeId: randomUUID(), endpoint, bucket: routeBucket, region: "us-east-1", accessKey, secretKey, mode: "loopback-development" as const };
  const routeBytes = Buffer.from('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="O-Tid"><trk><trkseg><trkpt lat="59.1" lon="18.1"/><trkpt lat="59.2" lon="18.2"/></trkseg></trk></gpx>');
  const routeManifest = await createRouteObjectStore(routeConfig).put({ raceId: randomUUID(), attemptId: randomUUID(), mediaType: "application/gpx+xml", sha256: createHash("sha256").update(routeBytes).digest("hex"), byteLength: routeBytes.length }, routeBytes);
  await client.putObject(routeBucket, routeManifest.key, Buffer.from("later route version"));
  await stop();
  console.log("MinIO stopped cleanly; restarting the same private data directory for route version verification.");
  await start();
  const routeRestored = await createRouteObjectStore(routeConfig).read(routeManifest);
  if (!routeRestored.equals(routeBytes)) throw new Error("Route version changed across restart");
  console.log("Integration passed; exact older version survived process restart. No buckets deleted.");
} finally {
  try { await stop(); } finally { await log.close(); }
}
