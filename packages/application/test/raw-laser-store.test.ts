import { describe, expect, it } from "vitest";
import { rawLaserFileName, rawLaserRunKey } from "../src/map-project-raw-laser";
import { presignS3, s3RawLaserStore } from "../src/raw-laser-store";

describe("rå laserdata i förrådet (PLAN.md M6)", () => {
  it("signerar en länk som AWS eget exempel (Signature Version 4 i frågesträngen)", () => {
    const url = presignS3({ method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), region: "us-east-1",
      accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", now: new Date("2013-05-24T00:00:00Z"), seconds: 86400 });
    expect(url).toContain("X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request");
    expect(url.endsWith("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404")).toBe(true);
  });

  it("ger länkar för objekt under raw-laser/ och högst 7 dygn", () => {
    const store = s3RawLaserStore({ endpoint: "https://hel1.your-objectstorage.com", bucket: "otid", region: "hel1", accessKey: "A", secretKey: "S" });
    const key = "raw-laser/0f8e1c2a-1111-4111-8111-111111111111/laserdata.zip";
    const get = new URL(store.downloadUrl(key, "rå laserdata.zip", 7 * 86400, new Date("2026-11-22T12:00:00Z")));
    expect(get.pathname).toBe(`/otid/${key}`);
    expect(get.searchParams.get("X-Amz-Expires")).toBe("604800");
    expect(get.searchParams.get("response-content-disposition")).toBe(`attachment; filename="ra_laserdata.zip"; filename*=UTF-8''r%C3%A5%20laserdata.zip`);
    expect(() => store.downloadUrl(key, "x.zip", 7 * 86400 + 1)).toThrow();
    expect(() => store.uploadUrl("map-content/abc", 60)).toThrow();
    expect(new URL(store.uploadUrl(key, 3600)).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("namnger filen och hittar körningen för en delad körning", () => {
    expect(rawLaserFileName("Kungshatt – etapp 1 av 2", new Date("2026-11-22T12:00:00Z"))).toBe("ra-laserdata-Kungshatt-etapp-1-av-2-2026-11-22.zip");
    expect(rawLaserFileName(undefined, new Date("2026-11-22T12:00:00Z"))).toBe("ra-laserdata-laserdata-2026-11-22.zip");
    const group = "0f8e1c2a-1111-4111-8111-111111111111";
    expect(rawLaserRunKey({ id: "a", request: { split: { group } } })).toBe(group);
    expect(rawLaserRunKey({ id: "b", request: { merge: { group } } })).toBe(group);
    expect(rawLaserRunKey({ id: "c", request: {} })).toBe("c");
  });
});
