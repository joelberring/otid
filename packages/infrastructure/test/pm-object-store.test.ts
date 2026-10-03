import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { createPmObjectStore, PmObjectStorageError } from "../src";

const raceId = "10000000-0000-4000-8000-000000000001";
const storeId = "10000000-0000-4000-8000-000000000002";
const otherStoreId = "10000000-0000-4000-8000-000000000003";
const bucket = "test-private";
const bytes = Buffer.from("%PDF-1.4\nsynthetic PM\n%%EOF\n", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");

type Fault = "healthy" | "disabled-versioning" | "public-policy" | "policy-denied" | "missing-version" | "null-version" | "put-503" | "put-disconnect" | "put-hang" | "read-hang" | "read-hash-mismatch" | "read-size-mismatch" | "wrong-version" | "oversize";
type RequestRecord = { method: string; pathname: string; search: string; body: Buffer };

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (!(chunk instanceof Uint8Array)) throw new Error("Unexpected test request bytes");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function xml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "application/xml", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

class S3Loopback {
  readonly requests: RequestRecord[] = [];
  readonly sockets = new Set<Socket>();
  private readonly server: Server;
  private port = 0;
  object: Buffer<ArrayBufferLike> = Buffer.from(bytes);

  constructor(private readonly fault: Fault) {
    this.server = createServer((request, response) => { void this.handle(request, response); });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        const address = this.server.address();
        if (!address || typeof address === "string") throw new Error("Loopbackport saknas");
        this.port = address.port;
        resolve();
      });
    });
  }

  endpoint(): string { return `http://127.0.0.1:${this.port}`; }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const body = await requestBody(request);
    this.requests.push({ method: request.method ?? "", pathname: url.pathname, search: url.search, body });
    if (url.pathname === `/${bucket}` && url.searchParams.has("versioning")) {
      xml(response, 200, this.fault === "disabled-versioning"
        ? "<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>"
        : "<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>");
      return;
    }
    if (url.pathname === `/${bucket}` && url.searchParams.has("policy")) {
      if (this.fault === "policy-denied") {
        xml(response, 403, "<Error><Code>AccessDenied</Code></Error>");
        return;
      }
      if (this.fault === "public-policy") {
        xml(response, 200, JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: "*" }] }));
      } else {
        xml(response, 404, "<Error><Code>NoSuchBucketPolicy</Code></Error>");
      }
      return;
    }
    if (!url.pathname.startsWith(`/${bucket}/pm/`)) {
      xml(response, 404, "<Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    if (request.method === "PUT") {
      if (this.fault === "put-hang") return;
      if (this.fault === "put-disconnect") { response.destroy(); return; }
      if (this.fault === "put-503") {
        xml(response, 503, "<Error><Code>ServiceUnavailable</Code></Error>");
        return;
      }
      this.object = body;
      const headers: Record<string, string> = { etag: "\"synthetic-etag\"" };
      if (this.fault !== "missing-version") headers["x-amz-version-id"] = this.fault === "null-version" ? "null" : "version-a";
      response.writeHead(200, headers);
      response.end();
      return;
    }
    if (request.method === "GET") {
      if (url.searchParams.get("versionId") !== "version-a") {
        xml(response, 404, "<Error><Code>NoSuchVersion</Code></Error>");
        return;
      }
      if (this.fault === "read-hang") {
        response.writeHead(200, { "content-type": "application/pdf", "x-amz-version-id": "version-a" });
        response.write(this.object.subarray(0, 8));
        return;
      }
      const responseBytes = this.fault === "read-hash-mismatch"
        ? Buffer.concat([Buffer.from("!"), this.object.subarray(1)])
        : this.fault === "read-size-mismatch" ? this.object.subarray(0, -1)
          : this.fault === "oversize" ? Buffer.concat([this.object, Buffer.from("extra")]) : this.object;
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-length": responseBytes.length,
        "x-amz-version-id": this.fault === "wrong-version" ? "version-b" : "version-a"
      });
      response.end(responseBytes);
      return;
    }
    xml(response, 405, "<Error><Code>MethodNotAllowed</Code></Error>");
  }
}

const running: S3Loopback[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map((server) => server.close())); });

async function store(fault: Fault = "healthy", deadlineMs = 2_000) {
  const server = new S3Loopback(fault);
  running.push(server);
  await server.start();
  return {
    server,
    objectStore: createPmObjectStore({
      storeId,
      endpoint: server.endpoint(),
      bucket,
      region: "us-east-1",
      accessKey: "synthetic-key",
      secretKey: "synthetic-secret",
      mode: "loopback-development",
      deadlineMs
    })
  };
}

function input() {
  return { raceId, attemptId: randomUUID(), sha256, byteLength: bytes.length };
}

async function expectSanitizedFailure(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PmObjectStorageError);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain("synthetic-secret");
    expect(message).not.toContain("synthetic-key");
    expect(message).not.toContain("127.0.0.1");
    return;
  }
  throw new Error("Förväntat avvisande saknas");
}

describe("PM object store loopback S3 protocol", () => {
  it("checks private versioned storage, single-PUTs a buffer, readbacks its exact version, and reads verified bytes", async () => {
    const { server, objectStore } = await store();
    const value = input();
    const manifest = await objectStore.put(value, bytes);
    expect(manifest).toEqual({
      formatVersion: 1,
      storeId,
      key: `pm/${raceId}/${value.attemptId}`,
      versionId: "version-a",
      sha256,
      byteLength: bytes.length
    });
    const putRequests = server.requests.filter((request) => request.method === "PUT");
    expect(putRequests).toHaveLength(1);
    expect(putRequests[0]).toMatchObject({ pathname: manifest.key.startsWith("/") ? manifest.key : `/${bucket}/${manifest.key}`, body: bytes });
    expect(server.requests.some((request) => request.search.includes("versioning"))).toBe(true);
    expect(server.requests.some((request) => request.search.includes("policy"))).toBe(true);
    expect(server.requests.filter((request) => request.method === "GET" && request.search.includes("versionId=version-a"))).toHaveLength(1);
    await expect(objectStore.read(manifest)).resolves.toEqual(bytes);
    expect(server.requests.filter((request) => request.method === "GET" && request.search.includes("versionId=version-a"))).toHaveLength(2);
  });

  it.each(["missing-version", "null-version"] as const)("fails closed when PUT returns %s version", async (fault) => {
    const { objectStore } = await store(fault);
    await expectSanitizedFailure(objectStore.put(input(), bytes));
  });

  it.each(["disabled-versioning", "public-policy", "policy-denied"] as const)("does not PUT when bucket configuration is %s", async (fault) => {
    const { server, objectStore } = await store(fault);
    await expectSanitizedFailure(objectStore.put(input(), bytes));
    expect(server.requests.filter((request) => request.method === "PUT")).toHaveLength(0);
  });

  it.each(["put-503", "put-disconnect"] as const)("does not retry an uncertain PUT: %s", async (fault) => {
    const { server, objectStore } = await store(fault);
    await expectSanitizedFailure(objectStore.put(input(), bytes));
    expect(server.requests.filter((request) => request.method === "PUT")).toHaveLength(1);
  });

  it("rejects hash, size, manifest-store, and object-key violations without exposing storage details", async () => {
    const { server, objectStore } = await store();
    await expectSanitizedFailure(objectStore.put({ ...input(), sha256: "0".repeat(64) }, bytes));
    await expectSanitizedFailure(objectStore.put({ ...input(), byteLength: bytes.length + 1 }, bytes));
    await expectSanitizedFailure(objectStore.read({ formatVersion: 1, storeId: otherStoreId, key: `pm/${raceId}/${randomUUID()}`, versionId: "version-a", sha256, byteLength: bytes.length }));
    await expectSanitizedFailure(objectStore.read({ formatVersion: 1, storeId, key: "pm/../../escape", versionId: "version-a", sha256, byteLength: bytes.length }));
    expect(server.requests).toHaveLength(0);
  });

  it.each(["read-hash-mismatch", "read-size-mismatch", "wrong-version", "oversize"] as const)("rejects a %s from the exact object version", async (fault) => {
    const { objectStore } = await store(fault);
    await expectSanitizedFailure(objectStore.read({
      formatVersion: 1,
      storeId,
      key: `pm/${raceId}/${randomUUID()}`,
      versionId: "version-a",
      sha256,
      byteLength: bytes.length
    }));
  });

  it("rejects non-loopback HTTP and loopback production configuration", async () => {
    expect(() => createPmObjectStore({ storeId, endpoint: "http://example.invalid", bucket, region: "us-east-1", accessKey: "x", secretKey: "y", mode: "loopback-development", deadlineMs: 2_000 })).toThrow();
    expect(() => createPmObjectStore({ storeId, endpoint: "http://127.0.0.1:9000", bucket, region: "us-east-1", accessKey: "x", secretKey: "y", mode: "production", deadlineMs: 2_000 })).toThrow();
  });

  it("forbids the HTTP development exception in NODE_ENV production but permits configured HTTPS", () => {
    vi.stubEnv("NODE_ENV", "production");
    const config = { storeId, endpoint: "http://127.0.0.1:9000", bucket, region: "us-east-1", accessKey: "x", secretKey: "y", mode: "loopback-development", deadlineMs: 2_000 };
    try {
      expect(() => createPmObjectStore(config)).toThrow(PmObjectStorageError);
      expect(() => createPmObjectStore({ ...config, endpoint: "https://127.0.0.1:9000", mode: "production" })).not.toThrow();
      expect(() => createPmObjectStore({ ...config, endpoint: "https://127.0.0.1:9000" })).toThrow(PmObjectStorageError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("enforces the total read deadline and closes the hanging loopback socket", async () => {
    const { server, objectStore } = await store("read-hang", 100);
    const manifest = { formatVersion: 1 as const, storeId, key: `pm/${raceId}/${randomUUID()}`, versionId: "version-a", sha256, byteLength: bytes.length };
    await expectSanitizedFailure(objectStore.read(manifest));
    await vi.waitFor(() => expect(server.sockets.size).toBe(0), { timeout: 1000 });
  });

  it("aborts a stalled PUT without retry and closes its socket", async () => {
    const { server, objectStore } = await store("put-hang", 100);
    await expectSanitizedFailure(objectStore.put(input(), bytes));
    expect(server.requests.filter(request => request.method === "PUT")).toHaveLength(1);
    await vi.waitFor(() => expect(server.sockets.size).toBe(0), { timeout: 1000 });
  });

  it("rejects an already cancelled read without network requests", async () => {
    const { server, objectStore } = await store();
    const controller = new AbortController();
    controller.abort();
    await expectSanitizedFailure(objectStore.read({ formatVersion: 1, storeId,
      key: `pm/${raceId}/${randomUUID()}`, versionId: "version-a", sha256, byteLength: bytes.length }, controller.signal));
    expect(server.requests).toHaveLength(0);
  });

  it("rejects late read completion even before the deadline timer executes", async () => {
    const { server, objectStore } = await store();
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(5_000).mockReturnValue(8_000);
    try {
      await expectSanitizedFailure(objectStore.read({ formatVersion: 1, storeId,
        key: `pm/${raceId}/${randomUUID()}`, versionId: "version-a", sha256, byteLength: bytes.length }));
      expect(server.requests.some(request => request.search.includes("versionId=version-a"))).toBe(true);
    } finally { clock.mockRestore(); }
  });

  it("propagates worker cancellation to a hanging read and closes its socket", async () => {
    const { server, objectStore } = await store("read-hang", 60_000);
    const controller = new AbortController();
    const pending = expectSanitizedFailure(objectStore.read({ formatVersion: 1, storeId,
      key: `pm/${raceId}/${randomUUID()}`, versionId: "version-a", sha256, byteLength: bytes.length }, controller.signal));
    await vi.waitFor(() => expect(server.requests.some(request => request.search.includes("versionId=version-a"))).toBe(true));
    controller.abort();
    await pending;
    await vi.waitFor(() => expect(server.sockets.size).toBe(0), { timeout: 1000 });
  });

  it("owns upload bytes before the first await", async () => {
    const { objectStore } = await store();
    const mutable = Buffer.from(bytes);
    const pending = objectStore.put(input(), mutable);
    mutable.fill(0);
    const manifest = await pending;
    await expect(objectStore.read(manifest)).resolves.toEqual(bytes);
  });

  it("uploads the maximum 10 MiB as one PUT and rejects over-limit intent before I/O", async () => {
    const { server, objectStore } = await store();
    const maximum = Buffer.alloc(10 * 1024 * 1024, 1);
    const manifest = await objectStore.put({ ...input(), byteLength: maximum.length, sha256: createHash("sha256").update(maximum).digest("hex") }, maximum);
    expect(manifest.byteLength).toBe(maximum.length);
    expect(server.requests.filter(request => request.method === "PUT")).toHaveLength(1);
    const before = server.requests.length;
    await expectSanitizedFailure(objectStore.put({ ...input(), byteLength: maximum.length + 1 }, maximum));
    expect(server.requests).toHaveLength(before);
  });
});
