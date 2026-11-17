import { describe, expect, it } from "vitest";
import { joinCodeLocation, joinCodeProblem } from "./join-code";

/** Översynen av startsidan 2026-11-17: vart "Har du en kod?" leder, och att koden aldrig står i adressen tillbaka. */
describe("Har du en kod?", () => {
  it("leder till tävlingen, festen och gruppen", () => {
    expect(joinCodeLocation({ status: "found", target: { kind: "race", code: "abc234" } })).toBe("/t/abc234");
    expect(joinCodeLocation({ status: "found", target: { kind: "party", code: "abc234" } })).toBe("/fest/abc234");
    expect(joinCodeLocation({ status: "found", target: { kind: "group", code: "ungdom-k7m2pq9x" } })).toBe("/g/ungdom-k7m2pq9x");
  });

  it("ger startsidan ett besked utan koden", () => {
    expect(joinCodeLocation({ status: "not-found" })).toBe("/?kodfel=saknas#kod");
    expect(joinCodeLocation({ status: "rate-limited" })).toBe("/?kodfel=forsok#kod");
    expect(joinCodeLocation(undefined)).toBe("/#kod");
    expect(joinCodeProblem(new URLSearchParams(joinCodeLocation({ status: "not-found" }).slice(2, -4)).get("kodfel"))).toBe("missing");
    expect(joinCodeProblem("forsok")).toBe("busy");
    expect(joinCodeProblem("annat")).toBeUndefined();
    expect(joinCodeProblem(["saknas"])).toBeUndefined();
  });
});
