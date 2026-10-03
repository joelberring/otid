import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  read: vi.fn(),
  exists: vi.fn()
}));
vi.mock("./db", () => ({ db: {}, pool: { connect: mocks.connect } }));
vi.mock("@o-tid/application", () => ({
  publicResultUpdateEventExists: mocks.exists,
  readPublicResultEventStream: mocks.read
}));

import { createPublicResultEventStream } from "./public-result-event-stream";

const raceId = "10000000-0000-4000-8000-000000000001";
const request = () => new Request(`https://otid.example/api/public/races/${raceId}/result-events`);

describe("publik resultatström", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.connect.mockResolvedValue({ query: vi.fn().mockResolvedValue(undefined), on: vi.fn(), release: vi.fn() });
    mocks.read.mockResolvedValue({ status: "ready", eventSequences: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not leave a stream open when the client aborts before listener setup completes", async () => {
    const client = new AbortController();
    const reader = createPublicResultEventStream(new Request(request().url, { signal: client.signal }), raceId, null).getReader();
    client.abort();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });
});
