import { describe, expect, it } from "vitest";
import type { SportidentReadoutPayload } from "@o-tid/contracts";
import { evaluateLocally } from "./evaluate";
import { exerciseRunners } from "./exercise";
import { relayExerciseWindow } from "./relay";
import { ids, RELAY_CARDS, relayTestPackage } from "./test-support";

const payload = (card: number, from: string, finish: string): SportidentReadoutPayload => {
  const start = Date.parse(from), end = Date.parse(finish);
  return { cardNumber: String(card), cardType: "SI10", finishPunchedAt: finish, untimedPunchCodes: [], frames: ["02"], simulated: true,
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: new Date(start + (index + 1) * (end - start) / 4).toISOString() })) };
};

describe("stafett i avläsningsvyn", () => {
  it("sträcka 2 startar när sträcka 1 gick i mål och sista sträckan visar lagets tid", () => {
    const pkg = relayTestPackage();
    const first = payload(RELAY_CARDS.first, "2026-10-01T17:00:00.000Z", "2026-10-01T17:31:00.000Z");
    const legOne = evaluateLocally(first, pkg);
    expect(legOne).toMatchObject({ status: "OK", elapsedMs: 31 * 60_000,
      relay: { teamNumber: 12, teamName: "OK Test", leg: 1, legCount: 2, team: { status: "RUNNING", currentLeg: 2 } } });
    const second = payload(RELAY_CARDS.second, "2026-10-01T17:31:00.000Z", "2026-10-01T18:00:00.000Z");
    // Utan sträcka 1 i den här webbläsaren eller i paketet är växlingen okänd.
    expect(evaluateLocally(second, pkg)).toMatchObject({ status: "MP", reason: "MISSING_START" });
    const legTwo = evaluateLocally(second, pkg, [first, second]);
    expect(legTwo).toMatchObject({ status: "OK", elapsedMs: 29 * 60_000,
      relay: { leg: 2, team: { status: "OK", elapsedMs: 60 * 60_000 } } });
    // Paketets sträckresultat räcker när sträcka 1 lästes av någon annanstans.
    const known = { ...pkg, relay: { ...pkg.relay!, legResults: [{ entryId: ids.entry, status: "OK" as const,
      finishTime: "2026-10-01T17:31:00.000Z", elapsedMs: 31 * 60_000 }] } };
    expect(evaluateLocally(second, known)).toMatchObject({ status: "OK", relay: { team: { status: "OK", elapsedMs: 60 * 60_000 } } });
  });

  it("övningsstationen visar lag och sträcka och lägger sträckorna efter varandra", () => {
    const pkg = relayTestPackage();
    expect(exerciseRunners(pkg).map((runner) => runner.label)).toEqual([
      `Anna Berg · Stafett · Lag 12 · Sträcka 1 · ${RELAY_CARDS.first}`, `Bo Ek · Stafett · Lag 12 · Sträcka 2 · ${RELAY_CARDS.second}`]);
    const now = new Date("2026-10-01T19:00:05.000Z");
    const first = relayExerciseWindow(pkg, ids.entry, now)!;
    const second = relayExerciseWindow(pkg, exerciseRunners(pkg)[1]!.entryId, new Date(now.getTime() + 20_000))!;
    expect(first.startAt.toISOString()).toBe("2026-10-01T17:00:00.000Z");
    expect(second.startAt.getTime()).toBeGreaterThanOrEqual(first.finishAt.getTime());
    expect(second.finishAt.getTime()).toBeGreaterThan(second.startAt.getTime());
    expect(relayExerciseWindow(pkg, ids.entry, new Date("2026-10-01T17:02:00.000Z"))).toBeUndefined();
  });
});
