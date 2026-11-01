import { describe, expect, it } from "vitest";
import { createCourseSettingEventStream, formatCourseSettingEvent, presenceOf, publishCourseSettingEvent } from "./course-setting-events";

/** Steg 66: banläggningens nav – händelser till öppna editorer för tävlingen och närvaron. */
const race = "10000000-0000-4000-8000-0000000000a1";
const anna = { accountId: "10000000-0000-4000-8000-000000000001", displayName: "Anna", level: "EDIT" as const };
const bo = { accountId: "10000000-0000-4000-8000-000000000002", displayName: "Bo", level: "SUGGEST" as const };

async function read(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
}

describe("banläggningens ström", () => {
  it("skickar närvaron först, sedan besked till alla öppna editorer för tävlingen, och glömmer den som stänger", async () => {
    const first = new AbortController(), second = new AbortController();
    const a = createCourseSettingEventStream(new Request("http://x", { signal: first.signal }), race, anna)!.getReader();
    expect(await read(a)).toBe(`event: presence\ndata: ${JSON.stringify([anna])}\n\n`);
    const b = createCourseSettingEventStream(new Request("http://x", { signal: second.signal }), race, bo)!.getReader();
    // Anna får veta att Bo kom; Bo får närvaron med båda.
    expect(await read(a)).toContain('"Bo"');
    expect(await read(b)).toContain('"Anna"');
    publishCourseSettingEvent(race, { type: "version", version: 4, by: anna.accountId });
    expect(await read(a)).toBe(`event: version\ndata: {"version":4,"by":"${anna.accountId}"}\n\n`);
    expect(await read(b)).toContain("event: version");
    publishCourseSettingEvent("10000000-0000-4000-8000-0000000000a2", { type: "notes", by: "x" });
    second.abort();
    await b.cancel();
    expect(presenceOf(race).map(person => person.displayName)).toEqual(["Anna"]);
    expect(await read(a)).toContain("event: presence");
    first.abort();
    await a.cancel();
    expect(presenceOf(race)).toEqual([]);
    expect(new TextDecoder().decode(formatCourseSettingEvent({ type: "notes", by: "x" }))).toBe('event: notes\ndata: {"by":"x"}\n\n');
  });
});
