import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackingBridge, TrackingFix, TrackingPermission, TrackingStatus, TrackingStopped } from "./otid-tracking";
import { appPositionSource, liveFixArrival, orderFixes, replayJournal, type PositionFix, type PositionProblem } from "./position-source";

const fix = (seq: number): TrackingFix => ({ seq, latitude: 59.3 + seq / 1e5, longitude: 18.0, accuracyM: 5, t: 1_000_000 + seq * 1000, receivedAt: 1_000_500 + seq * 1000 });
const seqs = (fixes: readonly { seq?: number | undefined }[]) => fixes.map(item => item.seq);

describe("appens journal spelas upp (ADR-0227)", () => {
  it("ordning efter seq, inga dubbletter, bara efter den senast räknade och inga punkter med fel form", () => {
    const broken = { ...fix(9), latitude: Number.NaN };
    expect(seqs(orderFixes(2, [fix(5), fix(3), fix(4), fix(3), fix(1), fix(2), broken]))).toEqual([3, 4, 5]);
    expect(orderFixes(5, [fix(5), fix(4)])).toEqual([]);
  });

  it("en punkt direkt från appen: dubblett, nästa eller lucka", () => {
    expect(liveFixArrival(4, 4)).toBe("duplicate");
    expect(liveFixArrival(4, 2)).toBe("duplicate");
    expect(liveFixArrival(4, 5)).toBe("next");
    expect(liveFixArrival(4, 7)).toBe("gap");
    expect(liveFixArrival(0, 1)).toBe("next");
  });

  it("sida för sida tills journalen är slut, utan att tappa eller upprepa punkter", async () => {
    const journal = Array.from({ length: 11 }, (_, index) => fix(index + 1));
    const reads: number[] = [];
    // Sidorna kommer i oordning och med en upprepad punkt; uppspelningen ger ändå varje punkt en gång i ordning.
    const read = async (afterSeq: number, limit: number) => {
      reads.push(afterSeq);
      const page = journal.filter(item => item.seq > afterSeq).slice(0, limit);
      return { fixes: [...page].reverse().concat(page.slice(0, 1)), lastSeq: 11 };
    };
    const delivered: TrackingFix[] = [];
    expect(await replayJournal(read, 3, page => delivered.push(...page), 3)).toBe(11);
    expect(seqs(delivered)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(reads).toEqual([3, 6, 9]);
  });

  it("en lucka i journalen stoppar inte uppspelningen, och en modul som svarar fel ger ingen oändlig loop", async () => {
    const journal = [fix(1), fix(2), fix(4), fix(5)];
    const delivered: TrackingFix[] = [];
    await replayJournal(async (afterSeq, limit) => ({ fixes: journal.filter(item => item.seq > afterSeq).slice(0, limit), lastSeq: 5 }), 0,
      page => delivered.push(...page), 2);
    expect(seqs(delivered)).toEqual([1, 2, 4, 5]);
    const stuck = vi.fn(async () => ({ fixes: [fix(1)], lastSeq: 9 }));
    expect(await replayJournal(stuck, 1, () => undefined)).toBe(1);
    expect(stuck).toHaveBeenCalledTimes(1);
  });
});

/** En falsk modul: journalen i minnet, händelserna med `emit`. */
function fakeBridge(status: Partial<TrackingStatus> = {}) {
  const journal: TrackingFix[] = [];
  const listeners: { fix: ((item: TrackingFix) => void)[]; stopped: ((event: TrackingStopped) => void)[] } = { fix: [], stopped: [] };
  const bridge = {
    requestPermission: vi.fn(async (): Promise<TrackingPermission> => ({ location: "granted", precise: true, notifications: "granted" })),
    start: vi.fn(async () => ({ lastSeq: journal.length })),
    stop: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ tracking: false, sessionId: null, lastSeq: 0, stopAtMs: null, stoppedBy: null, ...status })),
    read: vi.fn(async ({ afterSeq, limit }: { afterSeq: number; limit: number }) =>
      ({ fixes: journal.filter(item => item.seq > afterSeq).slice(0, limit), lastSeq: journal.length })),
    addListener: vi.fn((event: "fix" | "stopped", listener: never) => {
      (listeners[event] as unknown[]).push(listener);
      return Promise.resolve({ remove: () => { listeners[event] = listeners[event].filter(item => item !== listener) as never; } });
    })
  };
  return { bridge: bridge as unknown as TrackingBridge, mocks: bridge, journal, listeners,
    emit: (item: TrackingFix) => { journal.push(item); for (const listener of listeners.fix) listener(item); } };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const session = { sessionId: "run-1", stopAtMs: 2_000_000, title: "O-Tid", text: "Bingo", afterSeq: 0, forceStart: false };

describe("appens positionskälla", () => {
  beforeEach(() => { vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" })); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("startar loppets spårning, räknar ikapp efter den senast räknade och tar nya punkter i ordning; en lucka läses ur journalen", async () => {
    const fake = fakeBridge();
    fake.journal.push(fix(1), fix(2), fix(3));
    const got: { seq: number[]; live: boolean }[] = [];
    const problems: (PositionProblem | undefined)[] = [];
    const watch = appPositionSource(fake.bridge, { ...session, afterSeq: 1 }).watch({
      onFixes: (fixes: readonly PositionFix[], live) => got.push({ seq: fixes.map(item => item.seq!), live }), onProblem: problem => problems.push(problem) });
    await settle();
    expect(fake.mocks.start).toHaveBeenCalledWith({ sessionId: "run-1", stopAtMs: 2_000_000, title: "O-Tid", text: "Bingo" });
    expect(got).toEqual([{ seq: [2, 3], live: false }]);
    expect(problems).toEqual([undefined]);
    fake.emit(fix(4));
    fake.listeners.fix.forEach(listener => listener(fix(4)));
    fake.journal.push(fix(5));
    fake.emit(fix(6));
    await settle();
    expect(got.slice(1)).toEqual([{ seq: [4], live: true }, { seq: [5, 6], live: false }]);
    watch.stop();
    fake.emit(fix(7));
    await settle();
    expect(got).toHaveLength(3);
    expect(fake.mocks.stop).not.toHaveBeenCalled();
  });

  it("när sidan syns igen räknas journalen ikapp; positionens tid är punktens t", async () => {
    const fake = fakeBridge({ tracking: true, sessionId: "run-1" });
    const got: PositionFix[] = [];
    appPositionSource(fake.bridge, session).watch({ onFixes: fixes => got.push(...fixes), onProblem: () => undefined });
    await settle();
    expect(fake.mocks.start).not.toHaveBeenCalled();
    fake.journal.push(fix(1), fix(2));
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(got.map(item => [item.seq, item.t])).toEqual([[1, fix(1).t], [2, fix(2).t]]);
  });

  it("stoppad av maxtiden eller systemet: ett problem, och ingen tyst omstart", async () => {
    const fake = fakeBridge({ tracking: false, sessionId: "run-1", stoppedBy: "deadline" });
    const problems: (PositionProblem | undefined)[] = [];
    appPositionSource(fake.bridge, session).watch({ onFixes: () => undefined, onProblem: problem => problems.push(problem) });
    await settle();
    expect(problems).toEqual(["trackingDeadline"]);
    expect(fake.mocks.start).not.toHaveBeenCalled();
    fake.listeners.stopped.forEach(listener => listener({ sessionId: "run-1", stoppedBy: "system" }));
    fake.listeners.stopped.forEach(listener => listener({ sessionId: "annat", stoppedBy: "deadline" }));
    expect(problems).toEqual(["trackingDeadline", "trackingStopped"]);
    // Löparens tryck på «Starta GPS igen» startar.
    appPositionSource(fake.bridge, { ...session, forceStart: true }).watch({ onFixes: () => undefined, onProblem: () => undefined });
    await settle();
    expect(fake.mocks.start).toHaveBeenCalledTimes(1);
  });

  it("nekad plats visas som ett problem och spårningen startas inte", async () => {
    const fake = fakeBridge();
    fake.mocks.requestPermission.mockResolvedValueOnce({ location: "denied", precise: false, notifications: "granted" });
    const problems: (PositionProblem | undefined)[] = [];
    appPositionSource(fake.bridge, session).watch({ onFixes: () => undefined, onProblem: problem => problems.push(problem) });
    await settle();
    expect(problems).toEqual(["appDenied"]);
    expect(fake.mocks.start).not.toHaveBeenCalled();
  });

  it("ett fel i modulen blir ett problem, inte tystnad", async () => {
    const fake = fakeBridge();
    fake.mocks.start.mockRejectedValueOnce(new Error("appen syns inte"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const problems: (PositionProblem | undefined)[] = [];
    appPositionSource(fake.bridge, session).watch({ onFixes: () => undefined, onProblem: problem => problems.push(problem) });
    await settle();
    expect(problems).toEqual(["trackingFailed"]);
    expect(error).toHaveBeenCalled();
  });
});
