import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, open, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "minio";
import { createPmObjectStore, type PmObjectManifest } from "../src";

// Opt-in compatibility runner. It never adopts a server, bucket, credential or
// data directory. A passing run is not an operational backup/restore proof.
const expectedMinioSha256 = "0939ce5553ce9e6451b69e049fbf399794368276b61da8166f84cbd8c7f2d641";
const expectedMcSha256 = "f72ab39389f6b8ac7369fa1894b62f34a9eca230c339c0b3128a7e45ecfcf139";
let minioPath = "";
let mcPath = "";
let activeRun = false;

async function assertSha256(path: string, expected: string, label: string): Promise<void> {
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actual !== expected) throw new Error(`${label} checksum mismatch`);
  await chmod(path, 0o700);
}

export type PinnedPmVersionManifest = PmObjectManifest;
export type PinnedMinioPmObjectStore = Pick<ReturnType<typeof createPmObjectStore>, "read">;
export type PinnedMinioReplicationOptions = {
  minioBinary: string;
  mcBinary: string;
  sourceObjectKey?: string;
  onSourceReady?: (input: {
    first: PinnedPmVersionManifest;
    second: PinnedPmVersionManifest;
    sourceStore: PinnedMinioPmObjectStore;
    sourceEndpoint: string;
    bucket: string;
    targetInstanceId: string;
    targetConfiguration: {
      endpoint: string;
      region: "us-east-1";
      accessKey: string;
      secretKey: string;
      mode: "loopback-development";
    };
  }) => void | Promise<void>;
  onTargetReady?: (input: {
    manifests: { first: PinnedPmVersionManifest; second: PinnedPmVersionManifest };
    targetStore: PinnedMinioPmObjectStore;
  }) => void | Promise<void>;
};

export type PinnedMinioSourceOptions = Pick<PinnedMinioReplicationOptions, "minioBinary" | "sourceObjectKey"> & {
  onSourceReady: (input: {
    first: PinnedPmVersionManifest;
    second: PinnedPmVersionManifest;
    sourceStore: PinnedMinioPmObjectStore;
    sourceEndpoint: string;
    bucket: string;
    sourceCredentials: { accessKey: string; secretKey: string };
    sourceDataAreaPath: string;
    sourceRecoveryMetadataPath: string;
  }) => void | Promise<void>;
};

function validateSourceObjectKey(value: string): string {
  if (!/^pm\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("Invalid isolated PM object key");
  }
  return value;
}

export async function withPinnedMinioReplication(options: PinnedMinioReplicationOptions): Promise<void> {
  if (activeRun) throw new Error("Pinned MinIO replication fixture is already running");
  const sourceObjectKey = validateSourceObjectKey(options.sourceObjectKey ?? `pm/${randomUUID()}/${randomUUID()}`);
  if (!options.minioBinary || !options.mcBinary || process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Pinned darwin-arm64 MinIO and mc binaries required");
  }
  activeRun = true;
  minioPath = resolve(options.minioBinary);
  mcPath = resolve(options.mcBinary);
  try {
    await assertSha256(minioPath, expectedMinioSha256, "MinIO");
    await assertSha256(mcPath, expectedMcSha256, "mc");
    await runFixture(options, sourceObjectKey);
  } finally {
    activeRun = false;
  }
}

/** Starts only a fresh synthetic source and invokes TASK172 capture; it never creates a target or configures replication. */
export async function withPinnedMinioSource(options: PinnedMinioSourceOptions): Promise<void> {
  if (activeRun) throw new Error("Pinned MinIO fixture is already running");
  const sourceObjectKey = validateSourceObjectKey(options.sourceObjectKey ?? `pm/${randomUUID()}/${randomUUID()}`);
  if (!options.minioBinary || process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Pinned darwin-arm64 MinIO binary required");
  }
  activeRun = true;
  minioPath = resolve(options.minioBinary);
  try {
    await assertSha256(minioPath, expectedMinioSha256, "MinIO");
    const source = await createInstance("source");
    try {
      await start(source);
      const sourceClient = clientFor(source);
      const bucket = `otid-source-${randomUUID()}`;
      const storeId = randomUUID();
      const key = sourceObjectKey;
      const firstBytes = Buffer.from("%PDF-1.4\nfirst synthetic historical PM version\n%%EOF\n", "utf8");
      const secondBytes = Buffer.from("%PDF-1.4\nsecond synthetic historical PM version\n%%EOF\n", "utf8");
      const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
      await sourceClient.makeBucket(bucket, "us-east-1");
      await sourceClient.setBucketVersioning(bucket, { Status: "Enabled" });
      const sourceRecoveryMetadataPath = join(dirname(source.data), "recovery-metadata.json");
      const recoveryMetadata = await open(sourceRecoveryMetadataPath, "wx", 0o600);
      try {
        await recoveryMetadata.writeFile(`${JSON.stringify({
          endpoint: source.endpoint, bucket, dataAreaPath: source.data,
          credentials: { accessKey: source.accessKey, secretKey: source.secretKey },
        })}\n`);
        await recoveryMetadata.sync();
        await recoveryMetadata.chmod(0o600);
      } finally {
        await recoveryMetadata.close();
      }
      const first = await sourceClient.putObject(bucket, key, firstBytes, firstBytes.length, { "Content-Type": "application/pdf" });
      const second = await sourceClient.putObject(bucket, key, secondBytes, secondBytes.length, { "Content-Type": "application/pdf" });
      const firstManifest = { formatVersion: 1 as const, storeId, key, versionId: versionId(first), sha256: hash(firstBytes), byteLength: firstBytes.length };
      const secondManifest = { formatVersion: 1 as const, storeId, key, versionId: versionId(second), sha256: hash(secondBytes), byteLength: secondBytes.length };
      if (firstManifest.versionId === secondManifest.versionId) throw new Error("Source historical versions were not distinct");
      await assertNoReplicationRules(sourceClient, bucket);
      const sourceStore = createPmObjectStore({ storeId, endpoint: source.endpoint, bucket, region: "us-east-1",
        accessKey: source.accessKey, secretKey: source.secretKey, mode: "loopback-development", deadlineMs: 2_000 });
      try {
        await options.onSourceReady({ first: firstManifest, second: secondManifest, sourceStore,
          sourceEndpoint: source.endpoint, bucket,
          sourceCredentials: { accessKey: source.accessKey, secretKey: source.secretKey },
          sourceDataAreaPath: source.data, sourceRecoveryMetadataPath });
      } finally {
        // Replication owns its own normal cleanup. Re-read even after a callback
        // error so an unresolved rule cannot be hidden by fixture shutdown.
        await assertNoReplicationRules(sourceClient, bucket);
      }
    } finally {
      await stop(source);
      await source.log.close();
    }
  } finally {
    activeRun = false;
  }
}

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

type MinioInstance = {
  readonly instanceId: string;
  readonly endpoint: string;
  readonly data: string;
  readonly port: number;
  readonly consolePort: number;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly log: Awaited<ReturnType<typeof open>>;
  server?: ChildProcess;
  exited?: Promise<void>;
  spawnFailed: boolean;
};

async function createInstance(label: "source" | "target"): Promise<MinioInstance> {
  const directory = await mkdtemp(`/private/tmp/otid-minio-replication-${label}-`);
  await chmod(directory, 0o700);
  const data = join(directory, "data");
  await mkdir(data, { mode: 0o700 });
  const port = await freePort();
  let consolePort = await freePort();
  while (consolePort === port) consolePort = await freePort();
  return {
    instanceId: randomUUID(),
    endpoint: `http://127.0.0.1:${port}`,
    data,
    port,
    consolePort,
    accessKey: `otid${randomBytes(10).toString("hex")}`,
    secretKey: randomBytes(32).toString("hex"),
    log: await open(join(directory, "server.log"), "ax", 0o600),
    spawnFailed: false
  };
}

async function start(instance: MinioInstance): Promise<void> {
  instance.spawnFailed = false;
  instance.server = spawn(minioPath, ["server", instance.data, "--address", `127.0.0.1:${instance.port}`,
    "--console-address", `127.0.0.1:${instance.consolePort}`, "--quiet"], {
    env: { PATH: process.env.PATH ?? "", MINIO_ROOT_USER: instance.accessKey, MINIO_ROOT_PASSWORD: instance.secretKey,
      MINIO_BROWSER: "off", MINIO_UPDATE: "off" },
    stdio: ["ignore", instance.log.fd, instance.log.fd]
  });
  instance.exited = new Promise(resolve => {
    instance.server!.once("error", () => { instance.spawnFailed = true; resolve(); });
    instance.server!.once("exit", () => resolve());
  });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (instance.spawnFailed || instance.server.exitCode !== null || instance.server.signalCode !== null) {
      throw new Error("MinIO stopped before readiness; inspect private log");
    }
    try {
      const response = await fetch(`${instance.endpoint}/minio/health/live`, { signal: AbortSignal.timeout(500) });
      await response.arrayBuffer();
      if (response.status === 200) return;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    await delay(100);
  }
  throw new Error("MinIO readiness deadline exceeded");
}

async function stop(instance: MinioInstance): Promise<void> {
  if (!instance.server || !instance.exited) return;
  if (instance.server.exitCode !== null || instance.server.signalCode !== null || instance.spawnFailed) {
    await instance.exited;
    return;
  }
  instance.server.kill("SIGTERM");
  let forced = false;
  const timer = setTimeout(() => { forced = true; instance.server?.kill("SIGKILL"); }, 10_000);
  try {
    await instance.exited;
  } finally {
    clearTimeout(timer);
  }
  if (forced) throw new Error("MinIO required forced shutdown");
}

function clientFor(instance: MinioInstance): Client {
  return new Client({ endPoint: "127.0.0.1", port: instance.port, useSSL: false, region: "us-east-1",
    accessKey: instance.accessKey, secretKey: instance.secretKey, pathStyle: true, retryOptions: { disableRetry: true } });
}

async function listNames(client: Client, bucket: string): Promise<string[]> {
  const names: string[] = [];
  for await (const candidate of client.listObjectsV2(bucket, "", true) as AsyncIterable<unknown>) {
    if (!candidate || typeof candidate !== "object") throw new Error("Invalid isolated bucket listing");
    const name = (candidate as Record<string, unknown>)["name"];
    if (typeof name !== "string" || name.length === 0) throw new Error("Invalid isolated bucket listing");
    names.push(name);
  }
  return names;
}

async function assertNoBucketPolicy(client: Client, bucket: string): Promise<void> {
  try {
    await client.getBucketPolicy(bucket);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error &&
      (error as Record<string, unknown>)["code"] === "NoSuchBucketPolicy") return;
    throw new Error("Target bucket policy could not be verified");
  }
  throw new Error("Target bucket policy prevents the existing PM reader");
}

async function targetVersionSummary(client: Client, bucket: string, key: string, expected: ReadonlySet<string>): Promise<{ count: number; matching: number }> {
  let count = 0;
  let matching = 0;
  for await (const candidate of client.listObjects(bucket, key, true, { IncludeVersion: true }) as AsyncIterable<unknown>) {
    if (!candidate || typeof candidate !== "object") throw new Error("Invalid isolated version listing");
    const record = candidate as Record<string, unknown>;
    if (record["name"] !== key || typeof record["versionId"] !== "string") throw new Error("Invalid isolated version listing");
    count += 1;
    if (expected.has(record["versionId"])) matching += 1;
  }
  return { count, matching };
}

function versionId(value: { versionId?: string | null }): string {
  if (typeof value.versionId !== "string" || value.versionId.length === 0 || value.versionId === "null") {
    throw new Error("MinIO did not return a version id");
  }
  return value.versionId;
}

async function runMc(log: Awaited<ReturnType<typeof open>>, environment: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  const child = spawn(mcPath, args, { env: environment, stdio: ["ignore", log.fd, log.fd] });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error("MinIO replication configuration failed; inspect private mc log");
}

function replicationErrorCodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(replicationErrorCodes);
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const ownCode = [record["Code"], record["code"]].filter((candidate): candidate is string => typeof candidate === "string");
  return [...ownCode, ...Object.values(record).flatMap(replicationErrorCodes)];
}

function diagnosticToken(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value) ? value : "unknown";
}

async function readReplicationRules(environment: NodeJS.ProcessEnv, bucket: string): Promise<unknown[]> {
  const child = spawn(mcPath, ["replicate", "ls", "--json", `source/${bucket}`], { env: environment, stdio: ["ignore", "pipe", "ignore"] });
  if (!child.stdout) throw new Error("MinIO replication target could not be read");
  const chunks: Buffer[] = [];
  let byteLength = 0;
  child.stdout.on("data", (chunk: unknown) => {
    if (!(chunk instanceof Uint8Array)) {
      child.kill("SIGTERM");
      return;
    }
    byteLength += chunk.byteLength;
    if (byteLength > 64 * 1024) {
      child.kill("SIGTERM");
      return;
    }
    chunks.push(Buffer.from(chunk));
  });
  let signal: NodeJS.Signals | null = null;
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, exitSignal) => {
      signal = exitSignal;
      resolve(exitCode);
    });
  });
  const output = Buffer.concat(chunks).toString("utf8").trim();
  let records: unknown[] = [];
  let status = "unknown";
  let errorCode = "unknown";
  try {
    records = output ? output.split("\n").map(line => JSON.parse(line) as unknown) : [];
    const first = records[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const record = first as Record<string, unknown>;
      status = diagnosticToken(record["status"]);
      const codes = replicationErrorCodes(record["error"]);
      if (codes.length === 1) errorCode = diagnosticToken(codes[0]);
    }
  } catch {
    // Keep diagnostics limited to process/JSON metadata; mc output can contain endpoints.
  }
  if (code !== 0 || signal !== null) {
    const exit = code === null ? `signal=${signal ?? "unknown"}` : `exit=${code}`;
    throw new Error(`MinIO replication listing failed (${exit}; status=${status}; code=${errorCode})`);
  }
  if (!output || records.length === 0 || records.some(record => !record || typeof record !== "object" ||
    Array.isArray(record) || (record as Record<string, unknown>)["status"] !== "success")) {
    throw new Error(`MinIO replication listing returned invalid status (exit=${code}; status=${status}; code=${errorCode})`);
  }
  return records;
}

async function assertNoReplicationRules(client: Client, bucket: string): Promise<void> {
  try {
    // MinIO SDK 8.0.7 exposes the callbackified runtime method as `void` in
    // its first overload, although calling it without a callback returns a Promise.
    const getReplication = client.getBucketReplication.bind(client) as unknown as (name: string) => Promise<unknown>;
    await getReplication(bucket);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error &&
      (error as Record<string, unknown>)["code"] === "ReplicationConfigurationNotFoundError") return;
    const errorCode = diagnosticToken(error && typeof error === "object" && "code" in error ? error.code : undefined);
    throw new Error(`Isolated source replication state could not be verified (code=${errorCode})`);
  }
  throw new Error("Isolated source bucket already has a replication rule");
}

async function readReplicationTargetArn(environment: NodeJS.ProcessEnv, bucket: string): Promise<string> {
  const records = await readReplicationRules(environment, bucket);
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const rule = (record as Record<string, unknown>)["rule"];
    if (!rule || typeof rule !== "object") continue;
    const destination = (rule as Record<string, unknown>)["Destination"];
    const existing = (rule as Record<string, unknown>)["ExistingObjectReplication"];
    if (!destination || typeof destination !== "object" || !existing || typeof existing !== "object") continue;
    const arn = (destination as Record<string, unknown>)["Bucket"];
    const status = (existing as Record<string, unknown>)["Status"];
    if (typeof arn === "string" && arn.startsWith("arn:minio:replication::") && arn.endsWith(`:${bucket}`) && status === "Enabled") {
      return arn;
    }
  }
  throw new Error("MinIO replication target did not enable existing-object synchronization");
}

async function runFixture(options: PinnedMinioReplicationOptions, sourceObjectKey: string): Promise<void> {
const source = await createInstance("source");
const target = await createInstance("target");
const rootDirectory = await mkdtemp("/private/tmp/otid-minio-replication-mc-");
await chmod(rootDirectory, 0o700);
const mcLog = await open(join(rootDirectory, "mc.log"), "ax", 0o600);

try {
  await start(source);
  await start(target);
  const sourceClient = clientFor(source);
  const targetClient = clientFor(target);
  const bucket = `otid-replication-${randomUUID()}`;
  const storeId = randomUUID();
  const key = sourceObjectKey;
  const firstBytes = Buffer.from("%PDF-1.4\nfirst synthetic historical PM version\n%%EOF\n", "utf8");
  const secondBytes = Buffer.from("%PDF-1.4\nsecond synthetic historical PM version\n%%EOF\n", "utf8");
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

  await sourceClient.makeBucket(bucket, "us-east-1");
  await targetClient.makeBucket(bucket, "us-east-1");
  await sourceClient.setBucketVersioning(bucket, { Status: "Enabled" });
  await targetClient.setBucketVersioning(bucket, { Status: "Enabled" });
  if ((await listNames(targetClient, bucket)).length !== 0) throw new Error("Target bucket was not empty");

  const first = await sourceClient.putObject(bucket, key, firstBytes, firstBytes.length, { "Content-Type": "application/pdf" });
  const second = await sourceClient.putObject(bucket, key, secondBytes, secondBytes.length, { "Content-Type": "application/pdf" });
  const firstManifest = { formatVersion: 1 as const, storeId, key, versionId: versionId(first), sha256: hash(firstBytes), byteLength: firstBytes.length };
  const secondManifest = { formatVersion: 1 as const, storeId, key, versionId: versionId(second), sha256: hash(secondBytes), byteLength: secondBytes.length };
  if (firstManifest.versionId === secondManifest.versionId) throw new Error("Source historical versions were not distinct");

  // Secrets exist only in this child environment and the restrictive mc config directory.
  const mcEnvironment = {
    PATH: process.env.PATH ?? "",
    MC_CONFIG_DIR: rootDirectory,
    MC_HOST_source: `http://${source.accessKey}:${source.secretKey}@127.0.0.1:${source.port}`,
    MC_HOST_target: `http://${target.accessKey}:${target.secretKey}@127.0.0.1:${target.port}`
  };
  await assertNoReplicationRules(sourceClient, bucket);
  const sourceStore = createPmObjectStore({ storeId, endpoint: source.endpoint, bucket, region: "us-east-1",
    accessKey: source.accessKey, secretKey: source.secretKey, mode: "loopback-development", deadlineMs: 2_000 });
  await options.onSourceReady?.({
    first: firstManifest, second: secondManifest, sourceStore,
    sourceEndpoint: source.endpoint, bucket, targetInstanceId: target.instanceId,
    targetConfiguration: {
      endpoint: target.endpoint, region: "us-east-1", accessKey: target.accessKey,
      secretKey: target.secretKey, mode: "loopback-development",
    },
  });
  await runMc(mcLog, mcEnvironment, ["replicate", "add", "--remote-bucket", `target/${bucket}`,
    "--replicate", "existing-objects", `source/${bucket}`]);
  const targetArn = await readReplicationTargetArn(mcEnvironment, bucket);
  await runMc(mcLog, mcEnvironment, ["replicate", "resync", "start", "--remote-bucket", targetArn, `source/${bucket}`]);
  await assertNoBucketPolicy(targetClient, bucket);

  const targetStore = createPmObjectStore({ storeId, endpoint: target.endpoint, bucket, region: "us-east-1",
    accessKey: target.accessKey, secretKey: target.secretKey, mode: "loopback-development", deadlineMs: 2_000 });
  let replicated = false;
  let firstReadable = false;
  let secondReadable = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    const firstRead = await targetStore.read(firstManifest).catch(() => undefined);
    const secondRead = await targetStore.read(secondManifest).catch(() => undefined);
    firstReadable = firstRead !== undefined;
    secondReadable = secondRead !== undefined;
    if (firstRead && secondRead) {
      if (!firstRead.equals(firstBytes) || !secondRead.equals(secondBytes)) throw new Error("Replicated bytes changed");
      replicated = true;
      break;
    }
    await delay(100);
  }
  if (!replicated) {
    const summary = await targetVersionSummary(targetClient, bucket, key, new Set([firstManifest.versionId, secondManifest.versionId]));
    throw new Error(`Replication did not preserve both versions before timeout (first-readable=${firstReadable}, second-readable=${secondReadable}, target-version-count=${summary.count}, source-version-id-matches=${summary.matching}); inspect private logs`);
  }

  try {
    await targetStore.read({ ...firstManifest, versionId: "missing-version" });
    throw new Error("PM reader accepted an absent target version");
  } catch (error) {
    if (error instanceof Error && error.message === "PM reader accepted an absent target version") throw error;
  }
  await runMc(mcLog, mcEnvironment, ["replicate", "rm", "--all", "--force", `source/${bucket}`]);
  await assertNoReplicationRules(sourceClient, bucket);
  const afterCleanupFirst = await targetStore.read(firstManifest);
  const afterCleanupSecond = await targetStore.read(secondManifest);
  if (!afterCleanupFirst.equals(firstBytes) || !afterCleanupSecond.equals(secondBytes)) {
    throw new Error("Replication rule cleanup changed target bytes");
  }
  await options.onTargetReady?.({ manifests: { first: firstManifest, second: secondManifest }, targetStore });
} finally {
  try {
    await stop(target);
  } finally {
    try {
      await stop(source);
    } finally {
      await Promise.all([target.log.close(), source.log.close(), mcLog.close()]);
    }
  }
}
}
