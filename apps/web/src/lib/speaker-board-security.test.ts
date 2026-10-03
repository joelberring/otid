import { describe, expect, it } from "vitest";
import { hasNoSpeakerBoardRequestBody, readSpeakerBoardJson, speakerBoardSecurityPolicy, speakerBoardSessionProof } from "./speaker-board-security";

describe("speaker cookie and request policy", () => {
  it("requires exact HTTPS production origin or explicit HTTP loopback development", () => {
    expect(speakerBoardSecurityPolicy({ NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" }))
      .toMatchObject({ secureCookies: true, cookieNames: { session: "__Host-otid-speaker-board-session" } });
    expect(speakerBoardSecurityPolicy({ NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000" }))
      .toMatchObject({ secureCookies: false, cookieNames: { session: "otid_speaker_board_session" } });
    for (const origin of ["https://otid.example/", "https://user:secret@otid.example", "https://otid.example?key=x", "http://otid.example"]) {
      expect(() => speakerBoardSecurityPolicy({ NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: origin })).toThrow();
    }
    expect(() => speakerBoardSecurityPolicy({ NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://192.168.1.2:3000" })).toThrow();
  });
  it("rejects duplicate CSRF values and does not read CSRF for a data GET", () => {
    const policy = speakerBoardSecurityPolicy({ NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" });
    const token = "c".repeat(43);
    const request = new Request("https://otid.example", { headers: {
      cookie: `__Host-otid-speaker-board-csrf=${token}; __Host-otid-speaker-board-csrf=${token}`, "x-otid-csrf": token
    } });
    expect(speakerBoardSessionProof(request, policy, true).csrfCookie).toBeNull();
    expect(speakerBoardSessionProof(request, policy, false)).toEqual({ sessionToken: null, csrfCookie: null, csrfHeader: null });
  });
  it("rejects declared overflow without consuming the body", async () => {
    let consumed = false;
    const request = { headers: new Headers({ "content-type": "application/json", "content-length": "4097" }),
      body: { getReader() { consumed = true; throw new Error("unexpected read"); } } } as unknown as Request;
    await expect(readSpeakerBoardJson(request)).rejects.toThrow();
    expect(consumed).toBe(false);
  });
  it("rejects invalid UTF8 and streamed overflow without trusting declared length", async () => {
    for (const bytes of [new Uint8Array([0xff]), new Uint8Array(4097).fill(32)]) {
      const request = new Request("https://otid.example", { method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body: bytes });
      await expect(readSpeakerBoardJson(request)).rejects.toThrow();
    }
  });
  it("stops an undeclared stream at overflow and cancels without reading the rest", async () => {
    let reads = 0, cancelled = false;
    const request = { headers: new Headers({ "content-type": "application/json" }), body: { getReader: () => ({
      read: async () => { reads++; return { done: false, value: new Uint8Array(4097) }; },
      cancel: async () => { cancelled = true; }
    }) } } as unknown as Request;
    await expect(readSpeakerBoardJson(request)).rejects.toThrow();
    expect(reads).toBe(1); expect(cancelled).toBe(true);
  });
  it("rejects logout body on the first byte and cancels the remaining stream", async () => {
    let reads = 0, cancelled = false;
    const request = { headers: new Headers(), body: { getReader: () => ({
      read: async () => { reads++; return { done: false, value: new Uint8Array([1]) }; },
      cancel: async () => { cancelled = true; }
    }) } } as unknown as Request;
    await expect(hasNoSpeakerBoardRequestBody(request)).resolves.toBe(false);
    expect(reads).toBe(1); expect(cancelled).toBe(true);
  });
});
