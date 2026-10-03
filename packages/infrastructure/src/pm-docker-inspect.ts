import { lstat, realpath } from "node:fs/promises";
import { request, type IncomingMessage } from "node:http";
import { dirname } from "node:path";
import { z } from "zod";
import { checkPmDockerPrestartConfiguration, pmDockerPrestartInputSchema } from "./pm-docker-prestart";

const configurationSchema = z.object({
  socketPath: z.string().min(1).max(100)
    .regex(/^\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)+[A-Za-z0-9_-][A-Za-z0-9_.-]*$/)
}).strict();
const maximumBytes = 1024 * 1024;
const deadlineMs = 10_000;

async function privateSocket(socketPath: string): Promise<boolean> {
  const uid = process.getuid?.();
  if (uid === undefined || uid === 0) return false;
  const parent = dirname(socketPath);
  const [socket, directory, canonical] = await Promise.all([
    lstat(socketPath), lstat(parent), realpath(socketPath)
  ]);
  return canonical === socketPath && socket.isSocket() && socket.uid === uid &&
    directory.isDirectory() && directory.uid === uid && (directory.mode & 0o7777) === 0o700;
}

function validHeaders(response: IncomingMessage): boolean {
  const contentType = response.headersDistinct["content-type"];
  const encoding = response.headersDistinct["content-encoding"];
  const length = response.headersDistinct["content-length"];
  return response.statusCode === 200 && contentType?.length === 1 &&
    /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType[0]!) &&
    (encoding === undefined || (encoding.length === 1 && encoding[0] === "identity")) &&
    (length === undefined || (length.length === 1 && /^(0|[1-9][0-9]*)$/.test(length[0]!) &&
      Number(length[0]) <= maximumBytes));
}

// Private transport: paths are constructed only from already parsed identifiers.
// Resolve after close, including truncation/abort, so no connection outlives this read.
async function readJson(socketPath: string, path: string, signal: AbortSignal, deadline: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // A single bounded allocation avoids per-chunk Buffer/array overhead when
    // a peer dribbles the permitted body one byte at a time.
    const body = Buffer.allocUnsafe(maximumBytes);
    let size = 0, ended = false, failed = false;
    const req = request({ socketPath, path, method: "GET", agent: false, signal,
      maxHeaderSize: 16 * 1024, headers: { Host: "localhost", Accept: "application/json", Connection: "close" } });
    const fail = () => { failed = true; req.destroy(); };
    req.once("error", fail);
    req.once("upgrade", (_response, socket) => { socket.destroy(); fail(); });
    req.on("information", fail);
    req.once("response", response => {
      response.once("error", fail);
      response.once("aborted", fail);
      if (!validHeaders(response)) { fail(); return; }
      response.on("data", (chunk: Buffer) => {
        if (failed || size + chunk.byteLength > maximumBytes || signal.aborted || performance.now() >= deadline) { fail(); return; }
        chunk.copy(body, size);
        size += chunk.byteLength;
      });
      response.once("end", () => {
        ended = response.complete && response.rawTrailers.length === 0;
        req.destroy();
      });
    });
    req.once("close", () => {
      if (failed || !ended || signal.aborted || performance.now() >= deadline) {
        reject(new Error("PM_DOCKER_INSPECTION_FAILED")); return;
      }
      try {
        const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.subarray(0, size)));
        resolve(value);
      } catch { reject(new Error("PM_DOCKER_INSPECTION_FAILED")); }
    });
    req.end();
  });
}

/** Read-only, trusted worker adapter. Matching metadata never authorizes start or publication. */
export async function inspectPmDockerPrestartConfiguration(configuration: unknown, input: unknown, signal?: AbortSignal) {
  const config = configurationSchema.safeParse(configuration), expected = pmDockerPrestartInputSchema.safeParse(input);
  if (!config.success || !expected.success) return { status: "invalid-configuration" as const };
  const controller = new AbortController(), deadline = performance.now() + deadlineMs;
  const abort = () => controller.abort();
  const expired = () => controller.signal.aborted || performance.now() >= deadline;
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, deadlineMs);
  try {
    if (expired() || !(await privateSocket(config.data.socketPath)) || expired()) {
      return { status: "inspection-failed" as const };
    }
    const image = await readJson(config.data.socketPath,
      `/v1.53/images/${expected.data.profile.imageId}/json`, controller.signal, deadline);
    if (expired()) return { status: "inspection-failed" as const };
    const container = await readJson(config.data.socketPath,
      `/v1.53/containers/${expected.data.containerId}/json`, controller.signal, deadline);
    if (expired()) return { status: "inspection-failed" as const };
    const result = checkPmDockerPrestartConfiguration(expected.data, { image, container });
    return expired() ? { status: "inspection-failed" as const } : result;
  } catch {
    // Deliberately discard daemon bodies, paths, socket errors and abort reasons.
    return { status: "inspection-failed" as const };
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort();
  }
}
