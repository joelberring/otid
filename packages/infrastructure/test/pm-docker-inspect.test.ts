import { chmod, mkdtemp, realpath, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectPmDockerPrestartConfiguration } from "../src/pm-docker-inspect";
import { checkPmDockerPrestartConfiguration } from "../src/pm-docker-prestart";
import { containerId, expected, fixture, profile } from "./fixtures/pm-docker-inspect";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function directory() {
  const temporaryRoot = process.platform === "darwin" ? "/private/tmp" : await realpath(tmpdir());
  const path = await mkdtemp(join(temporaryRoot, "otid-inspect-"));
  await chmod(path, 0o700);
  cleanups.push(() => rmdir(path));
  return path;
}

async function server(handler: (request: IncomingMessage, response: ServerResponse, index: number) => void) {
  const root = await directory(), socketPath = `${root}/api.sock`;
  const requests: { method: string | undefined; url: string | undefined; headers: IncomingMessage["headers"] }[] = [];
  const sockets = new Set<Socket>();
  const http = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers });
    handler(request, response, requests.length - 1);
  });
  http.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(socketPath, resolve);
  });
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  });
  return { root, socketPath, requests, sockets };
}

function json(response: ServerResponse, payload: unknown) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

describe("Unix HTTP inspect collection, synthetic metadata only", () => {
  it("reads exactly two pinned GET paths with no ambient auth and returns checker metadata", async () => {
    vi.stubEnv("DOCKER_HOST", "tcp://synthetic.invalid:2375");
    vi.stubEnv("DOCKER_API_VERSION", "1.1");
    vi.stubEnv("DOCKER_AUTH_CONFIG", '{"auths":{"synthetic.invalid":{"auth":"synthetic-secret"}}}');
    vi.stubEnv("HTTP_PROXY", "http://synthetic.invalid:3128");
    const observations = fixture();
    const local = await server((_request, response, index) => json(response, index === 0 ? observations.image : observations.container));
    const result = await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected);
    expect(result).toEqual(checkPmDockerPrestartConfiguration(expected, observations));
    expect(local.requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: `/v1.53/images/${profile.imageId}/json` },
      { method: "GET", url: `/v1.53/containers/${containerId}/json` }
    ]);
    for (const request of local.requests) {
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers["x-registry-auth"]).toBeUndefined();
      expect(JSON.stringify(request)).not.toContain("synthetic-secret");
    }
    expect(result).not.toHaveProperty("publishable");
    expect(result).not.toHaveProperty("executionProfile");
  });

  it.each(["image", "container"] as const)("passes wrong %s identity through the checker", async part => {
    const observations = fixture(); observations[part].Id = "e".repeat(64);
    const local = await server((_request, response, index) => json(response, index === 0 ? observations.image : observations.container));
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected)).toEqual({ status: "configuration-mismatch" });
    expect(local.requests).toHaveLength(2);
  });

  it.each([null, [], {}, { socketPath: "relative.sock" }, { socketPath: "http://synthetic.invalid" },
    { socketPath: "/private/tmp/a/../b" }, { socketPath: "/private//tmp/a" }, { socketPath: "/private/tmp/a/" },
    { socketPath: "/private/tmp/a\u0000b" }, { socketPath: `/${"a".repeat(100)}` },
    { socketPath: "/private/tmp/a", host: "synthetic.invalid" }])("rejects invalid transport configuration %#", async configuration => {
    expect(await inspectPmDockerPrestartConfiguration(configuration, expected)).toEqual({ status: "invalid-configuration" });
  });

  it("rejects invalid expected input and pre-abort without any requests", async () => {
    const local = await server((_request, response) => json(response, fixture().image));
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath, extra: true }, expected))
      .toEqual({ status: "invalid-configuration" });
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, { ...expected, containerId: "short" }))
      .toEqual({ status: "invalid-configuration" });
    const abort = new AbortController(); abort.abort(new Error("synthetic-secret"));
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected, abort.signal))
      .toEqual({ status: "inspection-failed" });
    expect(local.requests).toHaveLength(0);
  });

  it("rejects a socket owned by another uid without connecting", async () => {
    const local = await server((_request, response) => json(response, fixture().image));
    const uid = process.getuid!();
    vi.spyOn(process as { getuid: () => number }, "getuid").mockReturnValue(uid + 1);
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected)).toEqual({ status: "inspection-failed" });
    expect(local.requests).toHaveLength(0);
  });

  it("clones expected profile and IDs before the first asynchronous boundary", async () => {
    const observations = fixture();
    const local = await server((_request, response, index) => json(response, index === 0 ? observations.image : observations.container));
    const input = structuredClone(expected), configuration = { socketPath: local.socketPath };
    const result = inspectPmDockerPrestartConfiguration(configuration, input);
    input.containerId = "f".repeat(64); input.profile.imageId = `sha256:${"f".repeat(64)}`;
    input.profile.stagingRoot = "/changed"; input.maskedPathsHash = "f".repeat(64);
    configuration.socketPath = "/private/tmp/changed.sock";
    expect(await result).toEqual(checkPmDockerPrestartConfiguration(expected, observations));
    expect(local.requests[1]?.url).toBe(`/v1.53/containers/${containerId}/json`);
  });

  it.each([0o755, 0o770, 0o1700])("rejects parent mode %s without connecting", async mode => {
    const local = await server((_request, response) => json(response, fixture().image));
    await chmod(local.root, mode);
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected)).toEqual({ status: "inspection-failed" });
    expect(local.requests).toHaveLength(0);
  });

  it("rejects missing paths, ordinary files, socket symlinks and symlinked parents", async () => {
    const local = await server((_request, response) => json(response, fixture().image));
    const file = `${local.root}/ordinary`, link = `${local.root}/alias.sock`;
    await writeFile(file, "synthetic", { mode: 0o600 }); cleanups.push(() => unlink(file));
    await symlink(local.socketPath, link); cleanups.push(() => unlink(link));
    const sibling = await directory(), parentLink = `${sibling}/linked`;
    await symlink(local.root, parentLink); cleanups.push(() => unlink(parentLink));
    for (const socketPath of [`${local.root}/absent`, file, link, `${parentLink}/api.sock`]) {
      expect(await inspectPmDockerPrestartConfiguration({ socketPath }, expected)).toEqual({ status: "inspection-failed" });
    }
    expect(local.requests).toHaveLength(0);
  });

  const failures: [string, (response: ServerResponse) => void][] = [
    ["redirect", response => { response.writeHead(302, { Location: "/forbidden", "Content-Type": "application/json" }); response.end("{}"); }],
    ["HTTP failure", response => { response.writeHead(500, { "Content-Type": "application/json" }); response.end("synthetic-secret"); }],
    ["missing type", response => response.end("{}")],
    ["wrong type", response => { response.writeHead(200, { "Content-Type": "text/json" }); response.end("{}"); }],
    ["wrong charset", response => { response.writeHead(200, { "Content-Type": "application/json; charset=latin1" }); response.end("{}"); }],
    ["duplicate content type", response => { response.writeHead(200, ["Content-Type", "application/json", "Content-Type", "application/json"]); response.end("{}"); }],
    ["informational response", response => { response.writeContinue(); json(response, fixture().image); }],
    ["upgrade", response => { response.writeHead(101, { Connection: "Upgrade", Upgrade: "synthetic" }); response.end(); }],
    ["trailers", response => { response.writeHead(200, { "Content-Type": "application/json", Trailer: "X-Synthetic" }); response.write("{}"); response.addTrailers({ "X-Synthetic": "private" }); response.end(); }],
    ["content encoding", response => { response.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" }); response.end("{}"); }],
    ["empty JSON", response => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(); }],
    ["malformed JSON", response => { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"secret":'); }],
    ["malformed UTF-8", response => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(Buffer.from([0x22, 0xc0, 0xaf, 0x22])); }],
    ["oversized declared body", response => { response.writeHead(200, { "Content-Type": "application/json", "Content-Length": 1048577 }); response.flushHeaders(); }],
    ["oversized streamed body", response => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(" ".repeat(1048577)); }],
    ["oversized headers", response => { response.writeHead(200, { "Content-Type": "application/json", "X-Synthetic": "a".repeat(16385) }); response.end("{}"); }],
    ["truncated body", response => { response.writeHead(200, { "Content-Type": "application/json", "Content-Length": 100 }); response.end("{}"); response.once("finish", () => response.socket?.destroy()); }],
    ["socket error", response => response.destroy(new Error("synthetic-secret"))]
  ];
  it.each(failures)("sanitizes %s, never retries or sends the second GET", async (_label, respond) => {
    const local = await server((_request, response) => respond(response));
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected)).toEqual({ status: "inspection-failed" });
    expect(local.requests).toHaveLength(1);
  });

  it.each(failures)("applies the same transport limits to container response: %s", async (_label, respond) => {
    const local = await server((_request, response, index) => index === 0 ? json(response, fixture().image) : respond(response));
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected)).toEqual({ status: "inspection-failed" });
    expect(local.requests).toHaveLength(2);
  });

  it("accepts identity encoding and exactly one MiB of UTF-8 JSON including whitespace", async () => {
    const observations = fixture();
    const local = await server((_request, response, index) => {
      const body = JSON.stringify(index === 0 ? observations.image : observations.container);
      response.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "identity" });
      response.end(body + " ".repeat(1048576 - Buffer.byteLength(body)));
    });
    expect((await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected)).status).toBe("configuration-matches");
  });

  it.each([false, true])("aborts a hanging response (body started: %s) and closes its connection", async bodyStarted => {
    const abort = new AbortController();
    let closed!: Promise<void>;
    const local = await server((request, response) => {
      closed = new Promise(resolve => request.socket.once("close", () => resolve()));
      if (bodyStarted) { response.writeHead(200, { "Content-Type": "application/json" }); response.write("{"); }
      abort.abort(new Error("synthetic-secret"));
    });
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected, abort.signal)).toEqual({ status: "inspection-failed" });
    await closed;
    expect(local.sockets.size).toBe(0); expect(local.requests).toHaveLength(1);
  });

  it("has one ten-second deadline spanning both responses", async () => {
    const observations = fixture();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const local = await server((_request, response, index) => {
      if (index === 0) timer = setTimeout(() => json(response, observations.image), 5500);
      else { response.writeHead(200, { "Content-Type": "application/json" }); response.write("{"); }
    });
    const start = performance.now();
    try {
      expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected)).toEqual({ status: "inspection-failed" });
      expect(performance.now() - start).toBeGreaterThanOrEqual(9500);
      expect(performance.now() - start).toBeLessThan(14000);
      expect(local.requests).toHaveLength(2);
    } finally { clearTimeout(timer); }
  }, 16000);

  it("rejects an otherwise valid second response exactly at the monotonic deadline", async () => {
    const observations = fixture();
    let monotonic = 100;
    const local = await server((_request, response, index) => {
      if (index === 1) monotonic = 10100;
      json(response, index === 0 ? observations.image : observations.container);
    });
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected)).toEqual({ status: "inspection-failed" });
    expect(local.requests).toHaveLength(2);
  });

  it("decodes UTF-8 characters split across small response chunks", async () => {
    const observations = fixture();
    const local = await server((_request, response, index) => {
      const body = Buffer.from(JSON.stringify({ ...(index === 0 ? observations.image : observations.container), Comment: "åäö🌲" }));
      response.writeHead(200, { "Content-Type": "application/json" });
      let offset = 0;
      const write = () => {
        if (response.destroyed) return;
        if (offset === body.length) { response.end(); return; }
        response.write(body.subarray(offset, ++offset));
        setImmediate(write);
      };
      write();
    });
    expect(await inspectPmDockerPrestartConfiguration({ socketPath: local.socketPath }, expected))
      .toEqual(checkPmDockerPrestartConfiguration(expected, observations));
  });
});
