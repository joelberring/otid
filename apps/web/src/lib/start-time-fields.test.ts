import { expect, it } from "vitest";
import { parseStartTimeFields } from "./start-time-fields";

it("composes minutes as zero seconds and retains seconds/milliseconds", () => {
  expect(parseStartTimeFields("2026-09-09", "11:00", "+02:00")).toBe("2026-09-09T09:00:00.000Z");
  expect(parseStartTimeFields(" 2026-09-09 ", " 11:00:12.123 ", " +02:00 ")).toBe("2026-09-09T09:00:12.123Z");
  expect(parseStartTimeFields("2026-09-09", "11:00:12.1", "Z")).toBe("2026-09-09T11:00:12.100Z");
});
it("keeps explicit offsets distinct across repeated DST hour and midnight", () => {
  expect(parseStartTimeFields("2026-10-25", "02:30", "+02:00")).toBe("2026-10-25T00:30:00.000Z");
  expect(parseStartTimeFields("2026-10-25", "02:30", "+01:00")).toBe("2026-10-25T01:30:00.000Z");
  expect(parseStartTimeFields("2026-09-09", "00:01", "+02:00")).toBe("2026-09-08T22:01:00.000Z");
});
it("rejects missing, invalid or ambiguous fields without guessing", () => {
  for (const [date, time, offset] of [
    ["", "11:00", "+02:00"], ["2026-02-30", "11:00", "+02:00"],
    ["2026-09-09", "24:00", "+02:00"], ["2026-09-09", "11:60", "+02:00"],
    ["2026-09-09", "11:00", ""], ["2026-09-09", "11:00", "Europe/Stockholm"],
    ["2026-09-09", "11:00", "+14:01"], ["2026-09-09", "11:00:01.1234", "Z"],
    ["2026-09-09", "1:00", "+02:00"], ["2026-09-09", "11:00.1", "Z"]
  ]) expect(parseStartTimeFields(date!, time!, offset!)).toBeNull();
});
