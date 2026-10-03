import { describe, expect, it } from "vitest";
import { crc16, encodeCommand, encodeStationFrame, FrameDecoder, NAK } from "../src";

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

describe("crc16", () => {
  it("matchar kända ramar från SPORTident-stationer", () => {
    // Allmänt publicerade exempel: sätt direktläge och läs systemdata.
    expect(crc16(Uint8Array.of(0xf0, 0x01, 0x4d))).toBe(0x6d0a);
    expect(crc16(Uint8Array.of(0x83, 0x02, 0x00, 0x80))).toBe(0xbf17);
    expect(crc16(Uint8Array.of(0xe0, 0x00))).toBe(0xe000);
  });

  it("ger 0 för tom eller enbytes indata", () => {
    expect(crc16(new Uint8Array())).toBe(0);
    expect(crc16(Uint8Array.of(0x12))).toBe(0);
  });
});

describe("encodeCommand", () => {
  it("bygger en hel kommandoram med väckbyte", () => {
    expect(hex(encodeCommand(0xf0, [0x4d]))).toBe("ff 02 f0 01 4d 6d 0a 03");
    expect(hex(encodeCommand(0x83, [0x00, 0x80], { wakeup: false }))).toBe("02 83 02 00 80 bf 17 03");
  });
});

describe("FrameDecoder", () => {
  const frame = encodeStationFrame(0xe8, 10, [0x0f, 0x7a, 0x12, 0x01]);
  const other = encodeStationFrame(0xe7, 10, [0, 0, 0, 0]);

  it("tolkar en hel ram", () => {
    const events = new FrameDecoder().push(frame);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.kind).toBe("frame");
    if (event.kind !== "frame") return;
    expect(event.frame.command).toBe(0xe8);
    expect(event.frame.stationCode).toBe(10);
    expect(Array.from(event.frame.data)).toEqual([0x0f, 0x7a, 0x12, 0x01]);
    expect(event.frame.raw).toEqual(frame);
  });

  it("klarar alla chunkgränser", () => {
    const stream = Uint8Array.from([...frame, ...other]);
    for (let cut1 = 0; cut1 <= stream.length; cut1 += 1) {
      for (let cut2 = cut1; cut2 <= stream.length; cut2 += 1) {
        const decoder = new FrameDecoder();
        const events = [
          ...decoder.push(stream.subarray(0, cut1)),
          ...decoder.push(stream.subarray(cut1, cut2)),
          ...decoder.push(stream.subarray(cut2))
        ];
        expect(events.map((e) => (e.kind === "frame" ? e.frame.command : e.kind))).toEqual([0xe8, 0xe7]);
      }
    }
  });

  it("klarar en byte i taget", () => {
    const decoder = new FrameDecoder();
    const events = Array.from(frame).flatMap((byte) => decoder.push(Uint8Array.of(byte)));
    expect(events.filter((e) => e.kind === "frame")).toHaveLength(1);
  });

  it("hoppar över skräp och väckbytes före ramen", () => {
    const events = new FrameDecoder().push(Uint8Array.from([0xff, 0xff, 0x00, 0x42, ...frame]));
    expect(events.map((e) => e.kind)).toEqual(["frame"]);
  });

  it("rapporterar fel kontrollsumma och hittar nästa ram", () => {
    const broken = Uint8Array.from(frame);
    broken[5] = broken[5]! ^ 0x01;
    const events = new FrameDecoder().push(Uint8Array.from([...broken, ...other]));
    expect(events[0]).toMatchObject({ kind: "error", reason: "crc" });
    const frames = events.filter((e) => e.kind === "frame");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.kind === "frame" && frames[0]!.frame.command).toBe(0xe7);
  });

  it("rapporterar saknad ETX och hittar nästa ram", () => {
    const broken = Uint8Array.from(frame);
    broken[broken.length - 1] = 0x00;
    const events = new FrameDecoder().push(Uint8Array.from([...broken, ...other]));
    expect(events[0]).toMatchObject({ kind: "error", reason: "missing-etx" });
    expect(events.some((e) => e.kind === "frame" && e.frame.command === 0xe7)).toBe(true);
  });

  it("levererar dubbletter som två ramar (dubblettskydd ligger högre upp)", () => {
    const events = new FrameDecoder().push(Uint8Array.from([...frame, ...frame]));
    expect(events.filter((e) => e.kind === "frame")).toHaveLength(2);
  });

  it("väntar på en trunkerad ram och kastar den vid flush", () => {
    const decoder = new FrameDecoder();
    expect(decoder.push(frame.subarray(0, 6))).toEqual([]);
    expect(decoder.pendingBytes).toBe(6);
    const flushed = decoder.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({ kind: "error", reason: "truncated" });
    expect(decoder.pendingBytes).toBe(0);
    // Efter flush fungerar avkodaren som vanligt.
    expect(decoder.push(other).map((e) => e.kind)).toEqual(["frame"]);
  });

  it("rapporterar NAK", () => {
    expect(new FrameDecoder().push(Uint8Array.of(NAK))).toEqual([{ kind: "nak" }]);
  });
});
