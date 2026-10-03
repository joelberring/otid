import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admissionClosed: false,
  connect: vi.fn(),
  read: vi.fn(),
  exists: vi.fn()
}));
vi.mock("./db", () => ({ db: {}, pool: { connect: mocks.connect } }));
vi.mock("@o-tid/application", () => ({
  publicResultUpdateEventExists: mocks.exists,
  readPublicResultEventStream: mocks.read
}));
vi.mock("./writer-stop-admission", () => ({ writerAdmissionClosed: () => mocks.admissionClosed }));

import { createPublicResultEventStream } from "./public-result-event-stream";

const raceId = "10000000-0000-4000-8000-000000000001";
const request = () => new Request(`https://otid.example/api/public/races/${raceId}/result-events`);

describe("TASK211 managed SSE quiescence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.admissionClosed = false;
    mocks.connect.mockResolvedValue({ query: vi.fn().mockResolvedValue(undefined), on: vi.fn(), release: vi.fn() });
    mocks.read.mockResolvedValue({ status: "ready", eventSequences: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("closes before acquiring the listener when admission is already closed", async () => {
    mocks.admissionClosed = true;
    const reader = createPublicResultEventStream(request(), raceId, null).getReader();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("closes an existing stream on the next heartbeat without another event", async () => {
    const reader = createPublicResultEventStream(request(), raceId, null).getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: reset");
    mocks.admissionClosed = true;
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it("does not leave a stream open when the client aborts before listener setup completes", async () => {
    const client = new AbortController();
    const reader = createPublicResultEventStream(new Request(request().url, { signal: client.signal }), raceId, null).getReader();
    client.abort();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });
});
