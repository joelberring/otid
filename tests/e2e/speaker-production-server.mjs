import { spawn, execFile } from "node:child_process";
import console from "node:console";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { chmod, cp, lstat, mkdtemp, readFile, realpath, rmdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout } from "node:timers";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webDirectory = join(root, "apps/web");
const standaloneDirectory = join(webDirectory, ".next/standalone");
const upstreamPort = 3110;
const proxyPort = 3111;
const publicOrigin = `https://127.0.0.1:${proxyPort}`;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || databaseUrl !== process.env.TEST_DATABASE_URL) {
  throw new Error("Samma syntetiska DATABASE_URL och TEST_DATABASE_URL krävs");
}

let temporaryDirectory;
let certificatePath;
let keyPath;
let runtimeDirectory;
let proxy;
let next;
let stopping = false;
let childSpawnFailed = false;

async function removeGeneratedFiles() {
  if (runtimeDirectory && temporaryDirectory) {
    try {
      const [temporaryRealPath, runtimeRealPath, runtimeStatus] = await Promise.all([
        realpath(temporaryDirectory),
        realpath(runtimeDirectory),
        lstat(runtimeDirectory)
      ]);
      if (dirname(runtimeDirectory) !== temporaryDirectory || basename(runtimeDirectory) !== "runtime" ||
        runtimeStatus.isSymbolicLink() || !runtimeStatus.isDirectory() ||
        dirname(runtimeRealPath) !== temporaryRealPath || basename(runtimeRealPath) !== "runtime") {
        throw new Error("Invalid temporary runtime path");
      }
      await rm(runtimeDirectory, { recursive: true, force: false });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        console.error("Temporary runtime cleanup failed");
      }
    }
  }
  for (const file of [certificatePath, keyPath]) {
    if (!file) continue;
    try { await unlink(file); } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      console.error("Temporary TLS file cleanup failed");
    }
  }
  if (temporaryDirectory) {
    try { await rmdir(temporaryDirectory); } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        console.error("Temporary TLS directory cleanup failed");
      }
    }
  }
}

async function stopChild() {
  if (!next || childSpawnFailed || next.exitCode !== null || next.signalCode !== null) return;
  const exited = new Promise((resolveExit) => next.once("exit", resolveExit));
  next.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise((resolveTimeout) => setTimeout(() => {
      if (next && next.exitCode === null && next.signalCode === null) next.kill("SIGKILL");
      resolveTimeout();
    }, 5_000))
  ]);
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  await new Promise((resolveClose) => {
    if (!proxy) return resolveClose();
    proxy.close(() => resolveClose());
    proxy.closeAllConnections?.();
  });
  await stopChild();
  await removeGeneratedFiles();
  process.exit(exitCode);
}

function genericBadGateway(response) {
  if (!response.headersSent) {
    response.writeHead(502, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" });
    response.end("Bad Gateway");
  } else {
    response.destroy();
  }
}

async function main() {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "otid-speaker-production-"));
  await chmod(temporaryDirectory, 0o700);
  runtimeDirectory = join(temporaryDirectory, "runtime");
  const stagedWebDirectory = join(runtimeDirectory, "apps/web");
  await cp(standaloneDirectory, runtimeDirectory, { recursive: true });
  await cp(join(webDirectory, "public"), join(stagedWebDirectory, "public"), { recursive: true });
  await cp(join(webDirectory, ".next/static"), join(stagedWebDirectory, ".next/static"), { recursive: true });
  keyPath = join(temporaryDirectory, "key.pem");
  certificatePath = join(temporaryDirectory, "certificate.pem");
  await execFileAsync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", keyPath, "-out", certificatePath, "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1"
  ]);
  await chmod(keyPath, 0o600);

  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certificatePath)]);
  next = spawn(process.execPath, [join(stagedWebDirectory, "server.js")], {
    cwd: stagedWebDirectory,
    env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(upstreamPort),
      O_TID_PUBLIC_ORIGIN: publicOrigin, DATABASE_URL: databaseUrl },
    stdio: "inherit"
  });
  next.once("error", () => { childSpawnFailed = true; void shutdown(1); });
  next.once("exit", (code) => { if (!stopping) void shutdown(code === 0 ? 1 : (code ?? 1)); });

  proxy = createHttpsServer({ key, cert }, (request, response) => {
    const headers = { ...request.headers, "x-forwarded-proto": "https" };
    const upstream = httpRequest({
      host: "127.0.0.1",
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => genericBadGateway(response));
    request.on("error", () => upstream.destroy());
    request.pipe(upstream);
  });
  proxy.on("error", () => { void shutdown(1); });
  await new Promise((resolveListen, rejectListen) => {
    proxy.once("error", rejectListen);
    proxy.listen(proxyPort, "127.0.0.1", () => {
      proxy.off("error", rejectListen);
      resolveListen();
    });
  });
}

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

main().catch(() => { void shutdown(1); });
