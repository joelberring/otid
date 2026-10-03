import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createPmObjectStore, replicateOperationalBackupStore } from "../src";
import type { OperationalBackupOperationState } from "@o-tid/contracts";

type Payload = {
  backupId: string;
  sourceCapture: unknown;
  operationState: unknown;
  readinessEvidence: unknown;
  targetBinding: unknown;
  store: { storeId: string; sourceEndpoint: string; sourceBucket: string; targetBucket: string };
  sourceCredentials: { accessKey: string; secretKey: string };
  target: { endpoint: string; region: "us-east-1"; mode: "loopback-development"; accessKey: string; secretKey: string };
  mcBinary: string;
};

function fail(): never { throw new Error("TASK175_CRASH_WORKER_FAILED"); }

async function readPrivatePayload(path: string): Promise<Payload> {
  const canonical = await realpath(path);
  if (canonical !== path || resolve(path) !== path) return fail();
  const named = await lstat(path);
  const root = dirname(path);
  const rootDetails = await lstat(root);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!rootDetails.isDirectory() || rootDetails.uid !== process.getuid?.() || (rootDetails.mode & 0o777) !== 0o700 ||
        !opened.isFile() || opened.nlink !== 1 || opened.uid !== process.getuid?.() ||
        (opened.mode & 0o777) !== 0o600 || opened.dev !== named.dev || opened.ino !== named.ino || opened.size > 2_000_000) {
      return fail();
    }
    const value = JSON.parse((await handle.readFile()).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
    const payload = value as Record<string, unknown>;
    if (Object.keys(payload).sort().join(",") !==
        "backupId,mcBinary,operationState,readinessEvidence,sourceCapture,sourceCredentials,store,target,targetBinding") return fail();
    return value as Payload;
  } finally { await handle.close(); }
}

function notify(message: Record<string, unknown>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (!process.send) { reject(new Error("TASK175_CRASH_WORKER_IPC_MISSING")); return; }
    process.send(message, (error: Error | null) => error ? reject(new Error("TASK175_CRASH_WORKER_IPC_FAILED")) : resolvePromise());
  });
}

let nextMessageId = 0;
const pendingAcknowledgements = new Map<number, (accepted: boolean) => void>();
process.on("message", message => {
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  const record = message as Record<string, unknown>;
  if (record.kind !== "state-ack" || typeof record.id !== "number" || typeof record.accepted !== "boolean") return;
  const acknowledge = pendingAcknowledgements.get(record.id);
  if (!acknowledge) return;
  pendingAcknowledgements.delete(record.id);
  acknowledge(record.accepted);
});

async function recordThroughParent(state: OperationalBackupOperationState): Promise<void> {
  const id = ++nextMessageId;
  const accepted = await new Promise<boolean>((resolvePromise, reject) => {
    pendingAcknowledgements.set(id, resolvePromise);
    if (!process.send) { pendingAcknowledgements.delete(id); reject(new Error("TASK175_CRASH_WORKER_IPC_MISSING")); return; }
    process.send({ kind: "state", id, state }, (error: Error | null) => {
      if (error) {
        pendingAcknowledgements.delete(id);
        reject(new Error("TASK175_CRASH_WORKER_IPC_FAILED"));
      }
    });
  });
  if (!accepted) fail();
}

type McResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string };
async function runPinnedMc(binary: string, args: string[], environment: NodeJS.ProcessEnv, timeoutMs: number,
  payload: Payload): Promise<McResult> {
  if (JSON.stringify(args) === JSON.stringify(["replicate", "add", "--id", payload.backupId,
    "--remote-bucket", `target/${payload.store.targetBucket}`, "--replicate", "existing-objects",
    `source/${payload.store.sourceBucket}`])) {
    if (binary !== payload.mcBinary) fail();
    const result = await runProcess(binary, args, environment, timeoutMs);
    if (result.code === 0 && result.signal === null) {
      await notify({ kind: "add-succeeded" });
      // The parent kills this process after observing the successful add. Do not
      // return into adapter code, where normal resync and cleanup would continue.
      await new Promise<void>(() => undefined);
    }
    return result;
  }
  return runProcess(binary, args, environment, timeoutMs);
}

async function runProcess(binary: string, args: string[], environment: NodeJS.ProcessEnv, timeoutMs: number): Promise<McResult> {
  return await new Promise<McResult>((resolvePromise, reject) => {
    const child = spawn(binary, args, { env: environment, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout?.on("data", (chunk: unknown) => {
      if (!(chunk instanceof Uint8Array)) { exceeded = true; child.kill("SIGTERM"); return; }
      size += chunk.byteLength;
      if (size > 64 * 1024) { exceeded = true; child.kill("SIGTERM"); return; }
      chunks.push(Buffer.from(chunk));
    });
    child.once("error", () => { clearTimeout(timer); reject(new Error("TASK175_CRASH_WORKER_MC_FAILED")); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (exceeded) { reject(new Error("TASK175_CRASH_WORKER_MC_OUTPUT_INVALID")); return; }
      resolvePromise({ code, signal, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

async function run(): Promise<void> {
  const payloadPath = process.argv[2];
  if (!payloadPath) fail();
  const payload = await readPrivatePayload(payloadPath);
  const targetPmReader = createPmObjectStore({ storeId: payload.store.storeId,
    endpoint: payload.target.endpoint, bucket: payload.store.targetBucket, region: payload.target.region,
    accessKey: payload.target.accessKey, secretKey: payload.target.secretKey,
    mode: payload.target.mode, deadlineMs: 10_000 });
  await replicateOperationalBackupStore({
    backupId: payload.backupId, sourceCapture: payload.sourceCapture, operationState: payload.operationState,
    readinessEvidence: payload.readinessEvidence, targetBinding: payload.targetBinding, store: payload.store,
    sourceCredentials: payload.sourceCredentials, target: payload.target, targetPmReader,
    mcBinary: payload.mcBinary, recordOperationState: recordThroughParent,
    timeoutMs: 60_000, pollIntervalMs: 250,
    runMc: (binary, args, environment, timeoutMs) => runPinnedMc(binary, args, environment, timeoutMs, payload),
  });
  await notify({ kind: "unexpected-completion" });
  fail();
}

await run().catch(async () => {
  await notify({ kind: "worker-failed" }).catch(() => undefined);
  process.exitCode = 1;
});
