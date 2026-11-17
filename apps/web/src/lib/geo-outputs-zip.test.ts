import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { geoOutputsSize, geoZipName, megabytes, zipGeoOutputs } from "./geo-outputs-zip";

const job = { jobId: "11111111-1111-4111-8111-111111111111", name: "Järflotta norr 1", outputs: [
  { name: "skuggning.png", mediaType: "image/png", byteSize: 3 }, { name: "skuggning.pgw", mediaType: "text/plain", byteSize: 2 }] };

describe("laserkörningens filer som zip", () => {
  it("namnger zip-filen ur körningens namn", () => {
    expect(geoZipName("Järflotta norr 1")).toBe("Jarflotta-norr-1-underlag.zip");
    expect(geoZipName("  ///  ")).toBe("laser-underlag.zip");
  });
  it("skriver storleken i MB", () => {
    expect(megabytes(10)).toBe("0,1");
    expect(megabytes(3.26 * 1024 * 1024)).toBe("3,3");
    expect(megabytes(42.4 * 1024 * 1024, ".")).toBe("42");
    expect(geoOutputsSize(job)).toBe(5);
  });
  it("hämtar varje fil och packar dem under sina namn", async () => {
    const asked: string[] = [], steps: string[] = [];
    const fetcher = (async (url: string) => { asked.push(url); return new Response(new Uint8Array(url.endsWith(".png") ? [1, 2, 3] : [4, 5])); }) as typeof fetch;
    const result = await zipGeoOutputs("/api/organizer/map-projects/p", job, (done, total) => steps.push(`${done}/${total}`), fetcher);
    expect(asked).toEqual([`/api/organizer/map-projects/p/geo-jobs/${job.jobId}/outputs/skuggning.png`, `/api/organizer/map-projects/p/geo-jobs/${job.jobId}/outputs/skuggning.pgw`]);
    expect(steps).toEqual(["0/2", "1/2", "2/2"]);
    if (result.status !== "ok") throw new Error("zip saknas");
    expect(result.fileName).toBe("Jarflotta-norr-1-underlag.zip");
    const files = unzipSync(result.bytes);
    expect([...files["skuggning.png"]!]).toEqual([1, 2, 3]);
    expect([...files["skuggning.pgw"]!]).toEqual([4, 5]);
  });
  it("avbryter och säger vilken fil som inte gick att hämta", async () => {
    const fetcher = (async (url: string) => new Response(null, { status: url.endsWith(".pgw") ? 404 : 200 })) as typeof fetch;
    expect(await zipGeoOutputs("/b", job, undefined, fetcher)).toEqual({ status: "failed", name: "skuggning.pgw" });
  });
});
