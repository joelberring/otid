import { describe, expect, it } from "vitest";
import { completeStages, inClip, stageChoices, stageOf } from "./map-project-stages";

const clip = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const job = (jobId: string, name: string, createdAt: string, status = "DONE") => ({ jobId, name, status, createdAt, clip });

describe("etapperna i en delad körning", () => {
  it("läser etappen ur namnet", () => {
    expect(stageOf("Karttapullautin hela kartan – etapp 2 av 3")).toEqual({ base: "Karttapullautin hela kartan", index: 2, total: 3 });
    expect(stageOf("Karttapullautin hela kartan")).toBeUndefined();
  });

  it("ger alla etapper i omgången när alla är klara, i ordning", () => {
    const jobs = [
      job("c", "K – etapp 3 av 3", "2026-11-13T20:00:02Z"),
      job("a", "K – etapp 1 av 3", "2026-11-13T20:00:00Z"),
      job("b", "K – etapp 2 av 3", "2026-11-13T20:00:01Z"),
      // En äldre omgång med samma namn räknas inte.
      job("old", "K – etapp 1 av 3", "2026-11-12T08:00:00Z"),
      job("other", "Annan – etapp 1 av 2", "2026-11-13T20:00:00Z")
    ];
    expect(completeStages(jobs[0]!, jobs)?.map(row => row.jobId)).toEqual(["a", "b", "c"]);
    expect(completeStages(jobs[3]!, jobs)).toBeUndefined();
  });

  it("väntar tills alla etapper är klara och struntar i jobb utan etapp", () => {
    const jobs = [job("a", "K – etapp 1 av 2", "2026-11-13T20:00:00Z"), job("b", "K – etapp 2 av 2", "2026-11-13T20:00:01Z", "RUNNING")];
    expect(completeStages(jobs[0]!, jobs)).toBeUndefined();
    expect(completeStages(job("x", "K", "2026-11-13T20:00:00Z"), jobs)).toBeUndefined();
  });

  it("tar den nyaste körningen av en etapp som körts om i samma omgång", () => {
    const jobs = [job("a", "K – etapp 1 av 2", "2026-11-13T20:00:00Z", "FAILED"), job("a2", "K – etapp 1 av 2", "2026-11-13T20:05:00Z"),
      job("b", "K – etapp 2 av 2", "2026-11-13T20:00:01Z")];
    expect(completeStages(jobs[2]!, jobs)?.map(row => row.jobId)).toEqual(["a2", "b"]);
  });
  it("ger alla etapper som ett eget val, och klipprutan är halvöppen", () => {
    const clip = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const row = (jobId: string, name: string) => ({ jobId, name, status: "DONE", createdAt: "2026-11-14T06:00:00Z", clip });
    const choices = stageChoices([row("1", "Hela – etapp 1 av 2"), row("2", "Hela – etapp 2 av 2"), row("3", "Liten")]);
    expect(choices.map(choice => choice.id)).toEqual(["etapper:1", "1", "2", "3"]);
    expect(choices[0]!.stages).toEqual({ base: "Hela", total: 2 });
    expect(inClip([0, 5], clip)).toBe(true);
    expect(inClip([10, 5], clip)).toBe(false);
  });
});
