import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { request as requestHttp } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const port = 31_057;
const baseUrl = `http://127.0.0.1:${port}`;
const knownFormatRaceId = "10000000-0000-4000-8000-000000000002";
const otherRaceId = "20000000-0000-4000-8000-000000000099";
let server: ChildProcessWithoutNullStreams;
let serverOutput = "";

async function stopServer(): Promise<void> {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => server.once("exit", () => resolveExit()));
  server.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
  ]);
  if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
}

test.beforeAll(async () => {
  server = spawn(process.execPath, [resolve("apps/web/.next/standalone/apps/web/server.js")], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      O_TID_SIMULATOR_MODE: "loopback-development",
      O_TID_PUBLIC_ORIGIN: baseUrl,
      DATABASE_URL: "postgresql://127.0.0.1:1/simulator_must_not_query"
    },
    stdio: "pipe"
  });
  server.stdout.on("data", (chunk: Buffer) => { serverOutput += chunk.toString("utf8"); });
  server.stderr.on("data", (chunk: Buffer) => { serverOutput += chunk.toString("utf8"); });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Standalone-servern avslutades före proben:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/admin/${knownFormatRaceId}/simulator`);
      if (response.status === 404) return;
    } catch {
      // Servern har inte börjat lyssna ännu.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Standalone-servern blev inte redo:\n${serverOutput}`);
});

test.afterAll(async () => stopServer());

test("produktionen avvisar simulatorn före databas trots fientligt mode", async () => {
  for (const raceId of [knownFormatRaceId, otherRaceId]) {
    const response = await fetch(`${baseUrl}/admin/${raceId}/simulator`);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toMatch(/no-store|no-cache/);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await response.text()).not.toMatch(/Stationssimulator|Utvecklingsyta|Lopp-id|snapshot_version/);
  }
  expect(serverOutput).not.toMatch(/ECONNREFUSED|simulator_must_not_query|database.*error/i);
});

test("device-batch svarar 401 på oavslutad chunked body före databas", async () => {
  const result = await new Promise<{ status: number | undefined; headers: Record<string, string | string[] | undefined>; body: string }>(
    (resolveProbe, rejectProbe) => {
      const timeout = setTimeout(() => {
        client.destroy();
        rejectProbe(new Error(`Device-batch väntade på body completion:\n${serverOutput}`));
      }, 5_000);
      const client = requestHttp(`${baseUrl}/api/races/${knownFormatRaceId}/device-batches`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "10000000-0000-4000-8000-000000000002:1:1",
          "transfer-encoding": "chunked"
        }
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          clearTimeout(timeout);
          resolveProbe({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8")
          });
          client.destroy();
        });
      });
      client.on("error", (error) => {
        clearTimeout(timeout);
        if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") rejectProbe(error);
      });
      client.write("{");
    }
  );

  expect(result.status).toBe(401);
  expect(result.headers["cache-control"]).toBe("no-store, private");
  expect(result.headers["content-security-policy"]).toBe("default-src 'none'");
  expect(result.headers["x-content-type-options"]).toBe("nosniff");
  expect(result.body).toBe(JSON.stringify({ error: "Stationsautentisering misslyckades" }));
  expect(serverOutput).not.toMatch(/ECONNREFUSED|simulator_must_not_query|database.*error/i);
});
