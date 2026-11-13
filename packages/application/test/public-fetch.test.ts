import { EventEmitter } from "node:events";
import type { request as httpsRequest } from "node:https";
import { describe, expect, it } from "vitest";
import { guardedLookup, isPublicAddress, publicFetch, PublicFetchError, validatePublicUrl } from "../src/public-fetch";

describe("publika adresser", () => {
  it("IPv4: privata, loopback, link-local, CGNAT och reserverade nej; publika ja", () => {
    for (const address of ["10.0.0.1", "10.255.255.255", "127.0.0.1", "127.1.2.3", "0.0.0.0", "0.1.2.3", "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "100.64.0.1", "100.127.255.255", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.255",
      "240.0.0.1", "255.255.255.255", "1.2.3", "256.1.1.1"]) expect(isPublicAddress(address), address).toBe(false);
    for (const address of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "193.10.4.5", "169.253.1.1"]) expect(isPublicAddress(address), address).toBe(true);
  });

  it("IPv6: loopback, ospecificerad, link-local, ULA, multicast, dokumentation och Teredo nej; global unicast ja", () => {
    for (const address of ["::1", "::", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "2001::1", "2001:1::1", "64:ff9b::808:808", "100::1", "fec0::1", "::10.0.0.1", "1:2:3", "2001:db8::1::2"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ["2001:4860:4860::8888", "2a00:1450:4001::200e", "2606:4700::1111", "[2606:4700::1111]"]) expect(isPublicAddress(address), address).toBe(true);
  });

  it("IPv4-mappade IPv6-adresser prövas som IPv4 (både punkt- och hexform)", () => {
    for (const address of ["::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:a00:1", "::ffff:7f00:1", "::ffff:c0a8:101", "0:0:0:0:0:ffff:10.0.0.1"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicAddress("::ffff:808:808")).toBe(true);
    // 6to4 bär en IPv4-adress: 2002:0a00:0001:: är 10.0.0.1.
    expect(isPublicAddress("2002:a00:1::")).toBe(false);
    expect(isPublicAddress("2002:808:808::")).toBe(true);
  });

  it("allt som inte är en adress är nej", () => {
    for (const address of ["", "example.com", "fe80::1%eth0", "1.2.3.4.5", "::ffff:1.2.3.4.5"]) expect(isPublicAddress(address), address).toBe(false);
  });
});

describe("adressens form", () => {
  it("bara https, port 443, inga användaruppgifter", () => {
    expect(validatePublicUrl("https://opengeodata.goteborg.se/services/ortofoto/wms/v1")).toMatchObject({ ok: true });
    expect(validatePublicUrl("https://exempel.se:443/wms")).toMatchObject({ ok: true });
    expect(validatePublicUrl("http://exempel.se/wms")).toEqual({ ok: false, reason: "not-https" });
    expect(validatePublicUrl("ftp://exempel.se/wms")).toEqual({ ok: false, reason: "not-https" });
    expect(validatePublicUrl("https://exempel.se:8443/wms")).toEqual({ ok: false, reason: "port" });
    expect(validatePublicUrl("https://anna:hemligt@exempel.se/wms")).toEqual({ ok: false, reason: "credentials" });
    expect(validatePublicUrl("https://anna@exempel.se/wms")).toEqual({ ok: false, reason: "credentials" });
    expect(validatePublicUrl("inte en adress")).toEqual({ ok: false, reason: "invalid-url" });
    expect(validatePublicUrl("")).toEqual({ ok: false, reason: "invalid-url" });
  });

  it("IP-nummer och localhost i adressen avvisas, också i omskrivna former", () => {
    for (const address of ["https://127.0.0.1/", "https://10.0.0.5/wms", "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://[::ffff:10.0.0.1]/",
      "https://[::ffff:a00:1]/", "https://[fd00::1]/", "https://2130706433/", "https://0x7f.1/", "https://0177.0.0.1/", "https://localhost/", "https://x.localhost/", "https://100.64.0.1/"]) {
      expect(validatePublicUrl(address), address).toEqual({ ok: false, reason: "private-address" });
    }
    expect(validatePublicUrl("https://8.8.8.8/wms")).toMatchObject({ ok: true });
    expect(validatePublicUrl("https://[2606:4700::1111]/wms")).toMatchObject({ ok: true });
  });
});

describe("uppslaget som anslutningen använder", () => {
  const resolver = (addresses: string[]) => (_host: string, _options: unknown, callback: (error: null, found: { address: string; family: number }[]) => void) =>
    callback(null, addresses.map(address => ({ address, family: address.includes(":") ? 6 : 4 })));
  const run = (addresses: string[], options: { all?: boolean } = {}) => new Promise<{ error: Error | null; address: unknown; family: unknown }>(resolve =>
    guardedLookup(resolver(addresses) as never)("exempel.se", options as never, (error, address, family) => resolve({ error, address, family })));

  it("släpper igenom publika adresser, med eller utan all", async () => {
    expect(await run(["8.8.8.8"])).toEqual({ error: null, address: "8.8.8.8", family: 4 });
    expect(await run(["8.8.8.8", "2606:4700::1111"], { all: true })).toMatchObject({ error: null, address: [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700::1111", family: 6 }] });
  });

  it("avvisar värden om någon adress är icke-publik (DNS som pekar in i nätet, eller bara delvis)", async () => {
    for (const addresses of [["10.0.0.1"], ["8.8.8.8", "127.0.0.1"], ["169.254.169.254"], ["::ffff:10.0.0.1"], ["fd00::1"], ["2606:4700::1111", "192.168.0.1"]]) {
      const result = await run(addresses, { all: true });
      expect(result.error, addresses.join()).toBeInstanceOf(PublicFetchError);
      expect((result.error as PublicFetchError).reason).toBe("private-address");
    }
  });

  it("ett uppslag utan adresser och ett uppslagsfel är fel", async () => {
    expect((await run([])).error).toMatchObject({ code: "ENOTFOUND" });
    const failing = await new Promise<Error | null>(resolve => guardedLookup(((_h: string, _o: unknown, cb: (error: Error) => void) => cb(new Error("dns"))) as never)("x.se", {} as never, error => resolve(error)));
    expect(failing?.message).toBe("dns");
  });
});

/** En falsk https-förfrågan: svaret byggs av testet; ingen anslutning görs. */
type FakeResponse = EventEmitter & { statusCode?: number; headers: Record<string, string>; resume: () => void };
/** `answer` sätter status och huvuden och kan returnera det som sedan skickas (data, slut). */
function fakeTransport(answer: (response: FakeResponse) => (() => void) | void) {
  const seen: { lookup: unknown; agent: unknown; url: string }[] = [];
  const transport = ((url: URL, options: { lookup: unknown; agent: unknown }, callback: (response: unknown) => void) => {
    seen.push({ lookup: options.lookup, agent: options.agent, url: url.href });
    const request = Object.assign(new EventEmitter(), { destroy: () => request, end: () => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} as Record<string, string>, resume: () => undefined });
      const later = answer(response);
      callback(response);
      later?.();
    } });
    return request;
  }) as unknown as typeof httpsRequest;
  return { transport, seen };
}
const OPTIONS = { timeoutMs: 1000, maxBytes: 10 };

describe("publicFetch", () => {
  it("avvisar fel adresser utan att göra någon förfrågan", async () => {
    const { transport, seen } = fakeTransport(() => undefined);
    for (const [address, reason] of [["http://exempel.se/", "not-https"], ["https://exempel.se:444/", "port"], ["https://a:b@exempel.se/", "credentials"], ["https://127.0.0.1/", "private-address"],
      ["https://[::ffff:10.0.0.1]/", "private-address"]] as const) {
      await expect(publicFetch(address, OPTIONS, transport), address).rejects.toMatchObject({ reason });
    }
    expect(seen).toHaveLength(0);
  });

  it("ansluter med den kontrollerande lookup och utan delad anslutning, och läser svaret", async () => {
    const { transport, seen } = fakeTransport(response => { response.headers["content-type"] = "image/png"; return () => { response.emit("data", Buffer.from([1, 2, 3])); response.emit("end"); }; });
    const result = await publicFetch("https://exempel.se/wms?a=1", OPTIONS, transport);
    expect(result).toEqual({ status: 200, contentType: "image/png", body: new Uint8Array([1, 2, 3]) });
    expect(seen[0]).toMatchObject({ agent: false, url: "https://exempel.se/wms?a=1" });
    expect(typeof seen[0]!.lookup).toBe("function");
  });

  it("en omdirigering är ett fel (ingen följs)", async () => {
    const { transport } = fakeTransport(response => { response.statusCode = 302; response.headers.location = "https://10.0.0.1/"; });
    await expect(publicFetch("https://exempel.se/", OPTIONS, transport)).rejects.toMatchObject({ reason: "redirect" });
  });

  it("för stort svar avbryts, också när längden inte är angiven", async () => {
    const declared = fakeTransport(response => { response.headers["content-length"] = "11"; });
    await expect(publicFetch("https://exempel.se/", OPTIONS, declared.transport)).rejects.toMatchObject({ reason: "too-large" });
    const streamed = fakeTransport(response => () => { response.emit("data", Buffer.alloc(6)); response.emit("data", Buffer.alloc(6)); response.emit("end"); });
    await expect(publicFetch("https://exempel.se/", OPTIONS, streamed.transport)).rejects.toMatchObject({ reason: "too-large" });
  });

  it("tiden går ut, och fel i anslutningen (också ett avslag från uppslaget) blir rätt orsak", async () => {
    const silent = (() => Object.assign(new EventEmitter(), { destroy: () => undefined, end: () => undefined })) as unknown as typeof httpsRequest;
    await expect(publicFetch("https://exempel.se/", { timeoutMs: 20, maxBytes: 10 }, silent)).rejects.toMatchObject({ reason: "timeout" });
    const broken = (error: Error) => (() => { const request = Object.assign(new EventEmitter(), { destroy: () => undefined, end: () => request.emit("error", error) }); return request; }) as unknown as typeof httpsRequest;
    await expect(publicFetch("https://exempel.se/", OPTIONS, broken(new PublicFetchError("private-address")))).rejects.toMatchObject({ reason: "private-address" });
    await expect(publicFetch("https://exempel.se/", OPTIONS, broken(Object.assign(new Error("x"), { cause: new PublicFetchError("private-address") })))).rejects.toMatchObject({ reason: "private-address" });
    await expect(publicFetch("https://exempel.se/", OPTIONS, broken(new Error("ECONNRESET")))).rejects.toMatchObject({ reason: "network" });
  });

  it("en riktig anslutning till localhost avvisas av uppslaget (inget nätverk lämnas)", async () => {
    await expect(publicFetch("https://localhost/", { timeoutMs: 2000, maxBytes: 10 })).rejects.toMatchObject({ reason: "private-address" });
  });

  it("uppslaget med en egen resolver som svarar med ett internt nät avvisar anslutningen", async () => {
    const resolve = ((_h: string, _o: unknown, cb: (error: null, found: { address: string; family: number }[]) => void) => cb(null, [{ address: "10.1.2.3", family: 4 }])) as never;
    await expect(publicFetch("https://tjanst.example/", { timeoutMs: 2000, maxBytes: 10 }, undefined, resolve)).rejects.toMatchObject({ reason: "private-address" });
  });
});
