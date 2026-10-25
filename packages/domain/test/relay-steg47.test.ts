import { describe, expect, it } from "vitest";
import {
  courseLegPairs, distributeRelayVariants, evaluateCardReadout, fairRelayCombinations, planRelayTeamVariants, rankRelayTeams,
  relayClassLegStarts, relayLegRuleProblem, relaySeedOf, relayTeamResult, unfairRelayTeams, withProposedCourseVersion,
  type RaceSnapshot, type RelayLegCourse, type RelayLegRule, type RelayTeamChangeovers
} from "../src";

/** Steg 47: bana per sträcka, omstart (fast och flygande), placering med omstart och rättvis gafflad stafett. */
const at = (clock: string) => `2026-10-08T${clock}.000Z`;
const minutes = (value: number) => value * 60_000;
const team = (key: string, changeovers: Record<number, string>): RelayTeamChangeovers =>
  ({ key, changeovers: new Map(Object.entries(changeovers).map(([leg, time]) => [Number(leg), time])) });

describe("bana per sträcka", () => {
  const version = (id: string, codes: number[]) => ({ id, courseId: `course-${id}`, version: 1, createdAt: at("08:00:00"),
    controls: codes.map((code, index) => ({ id: `${id}-${code}`, courseVersionId: id, controlId: `c${code}`, sequence: index + 1, controlCode: code })) });
  const snapshot: RaceSnapshot = {
    race: { id: "race", eventId: "event", name: "Stafett", raceDate: "2026-10-08", snapshotVersion: 1 },
    classes: [{ id: "class", raceId: "race", name: "Stafett", courseVersionId: "lang", startRule: "FIXED" }],
    courses: [{ id: "course-lang", raceId: "race", name: "Lång", versions: [version("lang", [31, 32, 33, 34])] },
      { id: "course-kort", raceId: "race", name: "Kort", versions: [version("kort", [41, 42])] }],
    entries: [
      { id: "leg-1", raceId: "race", classId: "class", givenName: "Anna", familyName: "Ek", fixedStartTime: at("17:00:00") },
      { id: "leg-2", raceId: "race", classId: "class", givenName: "Bo", familyName: "Ek", fixedStartTime: at("17:40:00"), courseVersionId: "kort" }
    ],
    cardAssignments: [{ id: "a1", raceId: "race", entryId: "leg-1", cardNumber: "1", active: true },
      { id: "a2", raceId: "race", entryId: "leg-2", cardNumber: "2", active: true }]
  };
  const punches = (codes: number[], from: string) => codes.map((code, index) =>
    ({ code, punchedAt: new Date(Date.parse(from) + minutes(index + 1)).toISOString() }));

  it("sträckan med egen bana bedöms mot den, övriga mot klassens bana", () => {
    const short = evaluateCardReadout({ cardNumber: "2", finishPunchedAt: at("18:00:00"), punches: punches([41, 42], at("17:40:00")) }, snapshot);
    expect(short).toMatchObject({ status: "OK", courseVersionId: "kort", entryId: "leg-2" });
    const long = evaluateCardReadout({ cardNumber: "1", finishPunchedAt: at("17:40:00"), punches: punches([41, 42], at("17:00:00")) }, snapshot);
    expect(long).toMatchObject({ status: "MP", courseVersionId: "lang", missingControls: [31, 32, 33, 34] });
  });

  it("en redigerad bana följer med till sträckorna som springer den", () => {
    const proposed = withProposedCourseVersion(snapshot, "course-kort", "kort", { id: "kort-2", version: 2, createdAt: at("09:00:00"),
      controlCodes: [41, 43] });
    expect(proposed.entries.find(entry => entry.id === "leg-2")?.courseVersionId).toBe("kort-2");
    expect(evaluateCardReadout({ cardNumber: "2", finishPunchedAt: at("18:00:00"), punches: punches([41, 42], at("17:40:00")) }, proposed))
      .toMatchObject({ status: "MP", courseVersionId: "kort-2", missingControls: [43] });
  });
});

describe("omstart", () => {
  const rules: RelayLegRule[] = [
    { leg: 1, startMethod: "MASS_START", startTime: at("17:00:00") },
    { leg: 2, startMethod: "RESTART", startTime: at("18:00:00") },
    { leg: 3, startMethod: "CHANGEOVER" },
    { leg: 4, startMethod: "RESTART", startTime: at("19:30:00") }
  ];

  it("flera omstarter på olika sträckor med olika tider", () => {
    const starts = relayClassLegStarts(rules, [
      team("snabb", { 1: at("17:40:00"), 2: at("18:20:00"), 3: at("19:00:00") }),
      team("sen", { 1: at("18:10:00"), 2: at("19:00:00"), 3: at("19:45:00") }),
      team("bruten", {})
    ]);
    expect(starts.teams.get("snabb")!.get(2)).toEqual({ start: at("17:40:00"), restarted: false });
    expect(starts.teams.get("snabb")!.get(4)).toEqual({ start: at("19:00:00"), restarted: false });
    // Föregående sträcka kom i mål efter omstarten: nästa sträcka räknas från omstarten.
    expect(starts.teams.get("sen")!.get(2)).toEqual({ start: at("18:00:00"), restarted: true });
    expect(starts.teams.get("sen")!.get(3)).toEqual({ start: at("19:00:00"), restarted: false });
    expect(starts.teams.get("sen")!.get(4)).toEqual({ start: at("19:30:00"), restarted: true });
    // Saknad avläsning (eller brutit utan mål) på föregående sträcka: laget startar i omstarten.
    expect(starts.teams.get("bruten")!.get(2)).toEqual({ start: at("18:00:00"), restarted: true });
    expect(starts.teams.get("bruten")!.get(3)).toEqual({ restarted: false });
    expect(starts.restarts.get(2)).toEqual({ leg: 2, time: at("18:00:00") });
  });

  it("en uppskjuten omstartstid ger nya starter", () => {
    const later = rules.map(rule => rule.leg === 2 ? { ...rule, startTime: at("18:15:00") } : rule);
    const starts = relayClassLegStarts(later, [team("sen", { 1: at("18:10:00") })]);
    expect(starts.teams.get("sen")!.get(2)).toEqual({ start: at("18:10:00"), restarted: false });
  });

  it("lagets tid är summan av sträcktiderna; ett lag i omstart placeras efter lag med vanliga växlingar (SOFT TR 5.8.2)", () => {
    const normal = relayTeamResult(2, [{ leg: 1, status: "OK", elapsedMs: minutes(40) }, { leg: 2, status: "OK", elapsedMs: minutes(45) }]);
    const restarted = relayTeamResult(2, [{ leg: 1, status: "OK", elapsedMs: minutes(70) },
      { leg: 2, status: "OK", elapsedMs: minutes(10), restarted: true }]);
    expect(restarted).toMatchObject({ status: "OK", elapsedMs: minutes(80), restarted: true });
    expect(rankRelayTeams([{ key: "omstart", result: restarted }, { key: "vanlig", result: normal }])).toEqual([
      { key: "vanlig", position: 1, timeBehindMs: 0 }, { key: "omstart", position: 2, timeBehindMs: minutes(-5) }]);
    expect(rankRelayTeams([{ key: "omstart", result: restarted }, { key: "vanlig", result: normal }], { restartRanking: "BY_TIME" })).toEqual([
      { key: "omstart", position: 1, timeBehindMs: 0 }, { key: "vanlig", position: 2, timeBehindMs: minutes(5) }]);
  });
});

describe("flygande omstart", () => {
  const rules: RelayLegRule[] = [
    { leg: 1, startMethod: "MASS_START", startTime: at("09:00:00") },
    { leg: 2, startMethod: "FLYING_RESTART", restartAfterMinutes: 60 },
    { leg: 3, startMethod: "CHANGEOVER" },
    { leg: 4, startMethod: "RESTART", startTime: at("13:00:00") },
    { leg: 5, startMethod: "FLYING_RESTART", restartAfterMinutes: 30 }
  ];

  it("kräver en gräns i minuter och ingen fast tid", () => {
    expect(relayLegRuleProblem(rules)).toBeUndefined();
    expect(relayLegRuleProblem([rules[0]!, { leg: 2, startMethod: "FLYING_RESTART" }])).toBe("MISSING_RESTART_AFTER");
    expect(relayLegRuleProblem([rules[0]!, { leg: 2, startMethod: "FLYING_RESTART", restartAfterMinutes: 60, startTime: at("10:00:00") }]))
      .toBe("UNEXPECTED_START_TIME");
    expect(relayLegRuleProblem([rules[0]!, { leg: 2, startMethod: "CHANGEOVER", restartAfterMinutes: 60 }])).toBe("UNEXPECTED_RESTART_AFTER");
  });

  it("omstartstiden är ledarlagets växling plus gränsen; lag som inte växlat då startar på den", () => {
    const teams = [
      team("ledare", { 1: at("10:00:00"), 2: at("11:00:00"), 3: at("12:00:00"), 4: at("12:40:00") }),
      team("tvåa", { 1: at("10:30:00"), 2: at("11:50:00"), 3: at("13:10:00"), 4: at("13:50:00") }),
      team("sist", { 1: at("11:15:00") }),
      team("ute", {})
    ];
    const starts = relayClassLegStarts(rules, teams);
    expect(starts.restarts.get(2)).toEqual({ leg: 2, time: at("11:00:00"), leaderChangeover: at("10:00:00"), leaderKey: "ledare",
      restartAfterMinutes: 60 });
    expect(starts.teams.get("tvåa")!.get(2)).toEqual({ start: at("10:30:00"), restarted: false });
    expect(starts.teams.get("sist")!.get(2)).toEqual({ start: at("11:00:00"), restarted: true });
    expect(starts.teams.get("ute")!.get(2)).toEqual({ start: at("11:00:00"), restarted: true });
    // Fast och flygande omstart i samma klass.
    expect(starts.teams.get("tvåa")!.get(4)).toEqual({ start: at("13:00:00"), restarted: true });
    expect(starts.restarts.get(5)).toMatchObject({ time: at("13:10:00"), leaderChangeover: at("12:40:00") });
    expect(starts.teams.get("tvåa")!.get(5)).toEqual({ start: at("13:10:00"), restarted: true });
  });

  it("ändras när ledarens växlingstid rättas; utan växling finns ingen omstartstid än", () => {
    const corrected = relayClassLegStarts(rules, [team("ledare", { 1: at("10:05:00") }), team("sist", { 1: at("11:15:00") })]);
    expect(corrected.teams.get("sist")!.get(2)).toEqual({ start: at("11:05:00"), restarted: true });
    const none = relayClassLegStarts(rules, [team("a", {}), team("b", {})]);
    expect(none.restarts.get(2)).toEqual({ leg: 2, restartAfterMinutes: 60 });
    expect(none.teams.get("a")!.get(2)).toEqual({ restarted: false });
  });

  it("linjestafett med 25 sträckor där växling, fast och flygande omstart blandas", () => {
    const legs: RelayLegRule[] = Array.from({ length: 25 }, (_, index) => index === 0
      ? { leg: 1, startMethod: "MASS_START", startTime: at("06:00:00") }
      : index % 6 === 0 ? { leg: index + 1, startMethod: "FLYING_RESTART", restartAfterMinutes: 60 }
        : index === 20 ? { leg: index + 1, startMethod: "RESTART", startTime: at("20:00:00") } : { leg: index + 1, startMethod: "CHANGEOVER" });
    expect(relayLegRuleProblem(legs)).toBeUndefined();
    const legTime = (pace: number) => Object.fromEntries(Array.from({ length: 25 }, (_, index) =>
      [index + 1, new Date(Date.parse(at("06:00:00")) + minutes((index + 1) * pace)).toISOString()]));
    const starts = relayClassLegStarts(legs, [team("fort", legTime(30)), team("sakta", legTime(45))]);
    const legSeven = starts.teams.get("sakta")!.get(7)!;
    // Ledaren växlade till sträcka 7 kl. 09:00; gränsen 60 min ger 10:00. Laget växlade 10:30.
    expect(legSeven).toEqual({ start: at("10:00:00"), restarted: true });
    expect(starts.teams.get("fort")!.get(25)!.start).toBe(legTime(30)[24]);
  });
});

describe("rättvis gafflad stafett", () => {
  const variant = (code: string, controls: number[]) => ({ code, controlCodes: controls });
  // Tre gafflingar A/B/C efter kontroll 31 (klassisk 3-sträckors stafett: ABC, BCA, CAB per lag).
  const abc = [variant("A", [31, 41, 50]), variant("B", [31, 42, 50]), variant("C", [31, 43, 50])];
  const legs = (course: typeof abc, count: number, key = "bana"): RelayLegCourse[] =>
    Array.from({ length: count }, (_, index) => ({ leg: index + 1, courseKey: key, variants: course }));
  const signature = (plan: ReadonlyMap<number, string>) => [...plan.entries()].sort(([left], [right]) => left - right).map(([, code]) => code).join("");

  it("varje lag springer varje variant en gång och varje variant används jämnt per sträcka", () => {
    const plans = distributeRelayVariants({ seed: 7, legs: legs(abc, 3), teamCount: 6, mode: "EVEN" });
    for (const plan of plans) expect([...signature(plan)].sort().join("")).toBe("ABC");
    for (const leg of [1, 2, 3]) {
      const used = plans.map(plan => plan.get(leg));
      expect(["A", "B", "C"].map(code => used.filter(value => value === code).length)).toEqual([2, 2, 2]);
    }
    expect(distributeRelayVariants({ seed: 7, legs: legs(abc, 3), teamCount: 6, mode: "EVEN" }).map(signature))
      .toEqual(plans.map(signature));
    expect(unfairRelayTeams(plans.map((plan, index) => ({ key: String(index), legs: [...plan].map(([leg, code]) =>
      ({ leg, controlCodes: abc.find(row => row.code === code)!.controlCodes })) })))).toEqual([]);
  });

  it("fler varianter än sträckor: två gafflingspunkter med tre val ger nio varianter och rättvisa lag", () => {
    const nine = ["A", "B", "C"].flatMap((first, firstIndex) => ["D", "E", "F"].map((second, secondIndex) =>
      variant(`${first}${second}`, [31, 41 + firstIndex, 50, 61 + secondIndex, 70])));
    expect(fairRelayCombinations(nine, 3).length).toBeGreaterThan(0);
    const plans = distributeRelayVariants({ seed: 11, legs: legs(nine, 3), teamCount: 9, mode: "EVEN" });
    const fairness = unfairRelayTeams(plans.map((plan, index) => ({ key: String(index), legs: [...plan].map(([leg, code]) =>
      ({ leg, controlCodes: nine.find(row => row.code === code)!.controlCodes })) })));
    expect(fairness).toEqual([]);
    for (const leg of [1, 2, 3]) expect(new Set(plans.map(plan => plan.get(leg))).size).toBe(9);
  });

  it("flera banor: lång på sträcka 1 och 3 med två varianter, kort utan gaffling på sträcka 2", () => {
    const long = [variant("1", [31, 32, 50]), variant("2", [32, 31, 50])];
    const plan = planRelayTeamVariants({ seed: 3, mode: "EVEN", existing: [], legs: [
      { leg: 1, courseKey: "lang", variants: long }, { leg: 2, courseKey: "kort", variants: [] }, { leg: 3, courseKey: "lang", variants: long }] });
    expect(plan.has(2)).toBe(false);
    expect([plan.get(1), plan.get(3)].sort()).toEqual(["1", "2"]);
    const next = planRelayTeamVariants({ seed: 3, mode: "EVEN", existing: [plan], legs: [
      { leg: 1, courseKey: "lang", variants: long }, { leg: 2, courseKey: "kort", variants: [] }, { leg: 3, courseKey: "lang", variants: long }] });
    expect(next.get(1)).toBe(plan.get(3));
  });

  it("bestämd variant på en sträcka gäller alla lag", () => {
    const plan = planRelayTeamVariants({ seed: 1, mode: "EVEN", existing: [], legs: legs(abc, 3).map(leg => leg.leg === 2
      ? { ...leg, fixedVariant: "B" } : leg) });
    expect(plan.get(2)).toBe("B");
  });

  it("fulgaffling: inga rättvisa kombinationer krävs, varianterna sprids jämnt per sträcka och över lagen", () => {
    const uneven = [variant("X", [31, 41, 50]), variant("Y", [31, 42, 43, 50])];
    expect(fairRelayCombinations(uneven, 3)).toEqual([]);
    const plans = distributeRelayVariants({ seed: 5, legs: legs(uneven, 3), teamCount: 4, mode: "UNEVEN" });
    for (const leg of [1, 2, 3]) expect(plans.filter(plan => plan.get(leg) === "X").length).toBe(2);
    for (const plan of plans) expect(new Set(plan.values()).size).toBe(2);
  });

  it("kontrollen per lag visar laget som inte springer samma sträckor som de andra", () => {
    const run = (key: string, codes: string) => ({ key, legs: [...codes].map((code, index) =>
      ({ leg: index + 1, controlCodes: abc.find(row => row.code === code)!.controlCodes })) });
    const unfair = unfairRelayTeams([run("1", "ABC"), run("2", "BCA"), run("3", "AAC")]);
    expect(unfair).toEqual([{ key: "3", missing: [{ from: 31, to: 42 }, { from: 42, to: 50 }], extra: [{ from: 31, to: 41 }, { from: 41, to: 50 }] }]);
    expect(courseLegPairs([31])).toEqual(["START>31", "31>FINISH"]);
  });

  it("fröet ur klassens id är stabilt och aldrig noll", () => {
    expect(relaySeedOf("klass")).toBe(relaySeedOf("klass"));
    expect(relaySeedOf("")).not.toBe(0);
  });
});
