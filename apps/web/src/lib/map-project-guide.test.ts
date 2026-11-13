import { describe, expect, it } from "vitest";
import type { GeoJobView } from "@o-tid/contracts";
import { estimateMinutes, guideDefaultArea, guideState, laserAreaSize, latestAreaJob, type GuideInput } from "./map-project-guide";
import { defaultLaserInterval, defaultLaserJob, laserIntervals, laserJobBody } from "./map-project-laser-request";

const STAGE = "11111111-1111-4111-8111-111111111111";
function job(patch: Partial<GeoJobView>): GeoJobView {
  return { jobId: "a", name: "Karttapullautin hela kartan", kind: "PULLAUTIN", status: "DONE", tiles: 1, settings: {},
    clip: { minX: 670_000, minY: 6_580_000, maxX: 672_000, maxY: 6_581_000 }, areaId: null, scannedAt: null, cliffs: null, extras: [], progress: null, error: null,
    layerId: null, skippedSteps: [], moistureLayerId: null, moisture: null, vegetation: null, outputs: [], createdBy: { accountId: "x", name: null }, own: true,
    createdAt: "2026-11-13T08:00:00.000Z", finishedAt: "2026-11-13T08:20:00.000Z", ...patch };
}
const base: GuideInput = { credential: "ready", tooLarge: undefined, job: undefined, loadable: false, candidates: false, placed: false };
const small = { south: 59.2, west: 18, north: 59.22, east: 18.04 };

describe("guiden Ny grundkarta: vilket steg", () => {
  it("börjar på Hämta och kör när området ryms och uppgifterna finns; steg 1 är avbockat", () => {
    const state = guideState(base);
    expect(state).toMatchObject({ step: "run", detail: "ready", finished: false });
    expect(state.marks).toEqual({ area: "done", run: "current", wait: "todo", review: "todo" });
  });

  it("står på Område när området är för stort, oavsett uppgifterna", () => {
    expect(guideState({ ...base, tooLarge: "tiles", credential: "missing" })).toMatchObject({ step: "area", detail: "too-large" });
    expect(guideState({ ...base, tooLarge: "search" }).marks).toEqual({ area: "current", run: "todo", wait: "todo", review: "todo" });
  });

  it("ber om uppgifterna till Lantmäteriet när de saknas, och väntar medan de läses", () => {
    expect(guideState({ ...base, credential: "missing" })).toMatchObject({ step: "run", detail: "credential" });
    expect(guideState({ ...base, credential: "unknown" })).toMatchObject({ step: "run", detail: "checking" });
  });

  it("står på Vänta medan körningen väntar eller pågår, också utan uppgifter och med för stort område", () => {
    expect(guideState({ ...base, job: { status: "QUEUED" }, credential: "missing", tooLarge: "tiles" })).toMatchObject({ step: "wait", detail: "queued" });
    expect(guideState({ ...base, job: { status: "RUNNING" } }).marks).toEqual({ area: "done", run: "done", wait: "current", review: "todo" });
  });

  it("går till Granska när körningen är klar: läs in, kandidater, inlagt", () => {
    const done = { ...base, job: { status: "DONE" as const }, loadable: true };
    expect(guideState(done)).toMatchObject({ step: "review", detail: "load", finished: false });
    expect(guideState({ ...done, candidates: true })).toMatchObject({ step: "review", detail: "candidates", finished: false });
    const placed = guideState({ ...done, placed: true });
    expect(placed).toMatchObject({ step: "review", detail: "placed", finished: true });
    expect(placed.marks).toEqual({ area: "done", run: "done", wait: "done", review: "done" });
    // Nya kandidater ur en körning som redan lagts in: guiden öppnar granskningen igen.
    expect(guideState({ ...done, placed: true, candidates: true }).finished).toBe(false);
  });

  it("går tillbaka till Hämta och kör efter en misslyckad körning eller en utan grundkartans filer", () => {
    expect(guideState({ ...base, job: { status: "FAILED" } })).toMatchObject({ step: "run", detail: "failed" });
    expect(guideState({ ...base, job: { status: "DONE" }, loadable: false })).toMatchObject({ step: "run", detail: "unusable" });
    expect(guideState({ ...base, job: { status: "FAILED" }, tooLarge: "tiles" })).toMatchObject({ step: "area" });
  });
});

describe("guiden Ny grundkarta: områdets storlek", () => {
  it("räknar laserrutor ur rutnätet på 2,5 km och godtar ett litet område", () => {
    expect(laserAreaSize(small, { minX: 670_100, minY: 6_580_100, maxX: 672_400, maxY: 6_582_400 })).toEqual({ tiles: 1, km2: 5.29, tooLarge: undefined });
    expect(laserAreaSize(small, { minX: 672_400, minY: 6_580_100, maxX: 672_600, maxY: 6_582_600 }).tiles).toBe(4);
    expect(laserAreaSize(small, { minX: 670_000, minY: 6_580_000, maxX: 672_500, maxY: 6_582_500 }).tiles).toBe(1);
  });

  it("säger ifrån när rutorna blir fler än en körning tar, enligt rutnätet eller sökningens svar", () => {
    expect(laserAreaSize(small, { minX: 670_000, minY: 6_580_000, maxX: 685_000, maxY: 6_590_000 })).toMatchObject({ tiles: 24, tooLarge: undefined });
    expect(laserAreaSize(small, { minX: 670_000, minY: 6_580_000, maxX: 685_100, maxY: 6_590_000 })).toMatchObject({ tiles: 28, tooLarge: "tiles" });
    expect(laserAreaSize(small, { minX: 670_100, minY: 6_580_100, maxX: 672_400, maxY: 6_582_400 }, 26)).toMatchObject({ tiles: 26, tooLarge: "tiles" });
  });

  it("säger ifrån när rutan är för stor för sökningen", () => {
    expect(laserAreaSize({ south: 59, west: 18, north: 59.3, east: 18.1 }, undefined).tooLarge).toBe("search");
    expect(laserAreaSize({ south: 59, west: 18, north: 59.2, east: 18.3 }, undefined).tooLarge).toBe("search");
  });
});

describe("guiden Ny grundkarta: körningen för området", () => {
  const jobs = [job({ jobId: "old", createdAt: "2026-11-10T08:00:00.000Z" }), job({ jobId: "new", createdAt: "2026-11-12T08:00:00.000Z", status: "RUNNING" }),
    job({ jobId: "stage", areaId: STAGE, createdAt: "2026-11-11T08:00:00.000Z" }), job({ jobId: "dwg", kind: "DWG", createdAt: "2026-11-13T09:00:00.000Z" }),
    job({ jobId: "cancelled", status: "CANCELLED", createdAt: "2026-11-13T10:00:00.000Z" }),
    job({ jobId: "sample", createdAt: "2026-11-13T11:00:00.000Z", clip: { minX: 670_000, minY: 6_580_000, maxX: 670_250, maxY: 6_580_250 } })];

  it("tar den senaste för just det området, utan avbrutna, DWG-ritningar och provrutor", () => {
    expect(latestAreaJob(jobs, null)?.jobId).toBe("new");
    expect(latestAreaJob(jobs, STAGE)?.jobId).toBe("stage");
    expect(latestAreaJob(jobs, "22222222-2222-4222-8222-222222222222")).toBeUndefined();
    // En mycket liten karta utan större körning är ingen provruta.
    expect(latestAreaJob(jobs.filter(row => row.jobId === "sample"), null)?.jobId).toBe("sample");
  });

  it("lämnar körningen bakom sig efter Ny körning, tills en nyare finns", () => {
    expect(latestAreaJob(jobs, null, "new")).toBeUndefined();
    expect(latestAreaJob([...jobs, job({ jobId: "newer", createdAt: "2026-11-13T12:00:00.000Z" })], null, "new")?.jobId).toBe("newer");
  });

  it("börjar på området där den senaste körningen gjordes, om delen finns kvar", () => {
    expect(guideDefaultArea(jobs, [STAGE])).toBe("");
    expect(guideDefaultArea(jobs.filter(row => row.jobId !== "new"), [STAGE])).toBe(STAGE);
    expect(guideDefaultArea(jobs.filter(row => row.jobId !== "new"), [])).toBe("");
    expect(guideDefaultArea([], [STAGE])).toBe("");
  });
});

describe("guiden Ny grundkarta: ungefärlig tid", () => {
  const running = job({ jobId: "now", status: "RUNNING", finishedAt: null, clip: { minX: 670_000, minY: 6_580_000, maxX: 675_000, maxY: 6_584_000 } });

  it("gissar efter ytan när projektet inte har några klara körningar", () => {
    // 20 km² × 2 min + 5 min.
    expect(estimateMinutes(running, [running])).toEqual({ minutes: 45, basis: "guess" });
    expect(estimateMinutes(job({ jobId: "liten", clip: { minX: 0, minY: 0, maxX: 300, maxY: 300 } }), [])).toEqual({ minutes: 5, basis: "guess" });
  });

  it("använder takten i projektets klara körningar när de finns", () => {
    // 2 km² på 20 minuter = 10 min per km²; 20 km² blir 200 minuter.
    expect(estimateMinutes(running, [running, job({ jobId: "done" })])).toEqual({ minutes: 200, basis: "history" });
  });
});

describe("guidens körning med förvalen", () => {
  const tile = { id: "24E001_658_67_2550", datetime: "2024-05-20T00:00:00Z", href: "https://exempel.se/a.laz", bbox: null, bytes: 123, epsg: 3006 };
  const clip = { minX: 1, minY: 2, maxX: 3, maxY: 4 };

  it("är samma begäran som laserpanelens förval: fuktighet, vegetation, marktäcke och byggnader", () => {
    const extras = [{ kind: "LAND_COVER" as const, id: "m", href: "https://exempel.se/m.zip" }, { kind: "BUILDINGS" as const, id: "b", href: "https://exempel.se/b.zip" }];
    expect(defaultLaserJob("Karttapullautin Del 2", { tiles: [tile], clip, areaId: STAGE, extras })).toEqual({ formatVersion: 1, kind: "PULLAUTIN", name: "Karttapullautin Del 2",
      settings: { contour_interval: 5, formline: 2 }, tiles: [{ id: tile.id, href: tile.href, bbox: null, epsg: 3006, datetime: tile.datetime }], clip, areaId: STAGE, extras,
      moisture: { channelHa: 1, wetMeters: 0.3, moistMeters: 0.6 }, vegetation: { minAreaM2: 300 } });
  });

  it("en sprintkarta körs med ekvidistansen 2,5 m och belagd yta ur lasern, och 2 m går att välja", () => {
    expect(defaultLaserJob("Karttapullautin hela kartan", { tiles: [tile], clip, areaId: undefined, extras: [] }, true).settings).toEqual({ contour_interval: 2.5, formline: 2, paved: 1 });
    // Laserpanelen: en handskriven inställning går före förvalet, och en skogskarta får ingen belagd yta.
    const panel = (sprint: boolean, typed: Record<string, number> = {}) => laserJobBody({ name: "Prov", interval: 2, formline: 2, sprint, chosen: { settings: typed, cliffs: undefined },
      target: { tiles: [tile], clip, extras: [] } }).settings;
    expect(panel(true)).toEqual({ contour_interval: 2, formline: 2, paved: 1 });
    expect(panel(true, { paved: 0 })).toEqual({ contour_interval: 2, formline: 2, paved: 0 });
    expect(panel(false)).toEqual({ contour_interval: 2, formline: 2 });
    expect(defaultLaserInterval(false)).toBe(5);
    expect(laserIntervals(true)).toEqual([2, 2.5, 5]);
    expect(laserIntervals(false)).toEqual([2.5, 5]);
  });

  it("utelämnar etappen för hela kartan och produkterna när inga hittades", () => {
    const body = defaultLaserJob("Karttapullautin hela kartan", { tiles: [tile], clip, areaId: undefined, extras: [] });
    expect(body).not.toHaveProperty("areaId");
    expect(body).not.toHaveProperty("extras");
    expect(body).not.toHaveProperty("cliffs");
  });
});
