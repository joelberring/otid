import { describe, expect, it } from "vitest";
import { archiveConnection, archiveMode, archiveSettingsProblems, memoryArchiveStore, probeArchiveStore, s3ArchiveStore, signS3 } from "../src/map-archive-store";
import { archiveSettings } from "../src/map-archive";

/** ADR-0224, PLAN.md steg L5: signeringen mot objektlagringen och inställningarna. */
describe("arkivets objektlagring", () => {
  it("signerar som AWS:s exempel för S3 (GET Object)", () => {
    const headers = signS3({ method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), headers: { range: "bytes=0-9" },
      payloadSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", region: "us-east-1",
      accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", now: new Date("2013-05-24T00:00:00Z") });
    expect(headers.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(headers).not.toHaveProperty("host");
  });

  it("läser anslutningen och läget ur miljön", () => {
    const env = { OTID_ARCHIVE_ENDPOINT: "hel1.your-objectstorage.com/", OTID_ARCHIVE_BUCKET: "otid-arkiv", OTID_ARCHIVE_ACCESS_KEY: "a", OTID_ARCHIVE_SECRET_KEY: "b" };
    expect(archiveConnection(env)).toEqual({ endpoint: "https://hel1.your-objectstorage.com", bucket: "otid-arkiv", region: "hel1", accessKey: "a", secretKey: "b" });
    expect(archiveConnection({ ...env, OTID_ARCHIVE_BUCKET: "" })).toBeNull();
    expect(archiveMode({})).toBe("off");
    expect(archiveMode({ OTID_ARCHIVE_MODE: " LOG " })).toBe("log");
    expect(archiveSettingsProblems({ OTID_ARCHIVE_MODE: "on" })[0]).toContain("OTID_ARCHIVE_ENDPOINT");
    expect(archiveSettingsProblems({ ...env, OTID_ARCHIVE_MODE: "on" })).toEqual([]);
    expect(archiveSettings({ OTID_ARCHIVE_IDLE_DAYS: "1", OTID_ARCHIVE_ACCOUNT_HOT_MB: "0" })).toMatchObject({ idleDays: 1, accountHotBytes: null, supersededHours: 24 });
  });

  it("anropar path-style med innehållets sha256 och tål att objektet saknas", async () => {
    const sha = "ab".repeat(32), calls: { method: string; url: string; hash: string }[] = [];
    const store = s3ArchiveStore({ endpoint: "https://hel1.example.test", bucket: "b", region: "hel1", accessKey: "a", secretKey: "s" }, {
      fetch: (async (url: URL, init: RequestInit) => {
        calls.push({ method: init.method!, url: url.href, hash: (init.headers as Record<string, string>)["x-amz-content-sha256"]! });
        return init.method === "PUT" ? new Response("", { status: 200 }) : new Response(null, { status: 404 });
      }) as unknown as typeof fetch });
    await store.put(sha, new Uint8Array([1, 2, 3]));
    expect(await store.get(sha)).toBeUndefined();
    expect(await store.size(sha)).toBeUndefined();
    await store.remove(sha);
    expect(calls.map(call => call.method)).toEqual(["PUT", "GET", "HEAD", "DELETE"]);
    expect(calls[0]).toMatchObject({ url: `https://hel1.example.test/b/map-content/${sha}`, hash: sha });
    await expect(store.get("../x")).rejects.toThrow("Ogiltig");
  });

  it("provet av anslutningen lämnar inget kvar och säger ifrån när objektet inte kommer tillbaka", async () => {
    const store = memoryArchiveStore();
    await probeArchiveStore(store);
    expect(store.objects.size).toBe(0);
    await expect(probeArchiveStore({ ...store, get: async () => undefined })).rejects.toThrow("provobjektet");
  });
});
