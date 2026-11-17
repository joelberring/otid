import { describe, expect, it } from "vitest";
import type { MapSourceCredentialView } from "@o-tid/contracts";
import { lantmaterietGap, lantmaterietLink, lantmaterietProblem } from "./lantmateriet-status";

const view = (patch: { available?: boolean; saved?: boolean; readable?: boolean } = {}): MapSourceCredentialView => ({
  formatVersion: 1, provider: "LANTMATERIET", available: patch.available ?? true,
  saved: patch.saved === false ? null : { method: "BASIC", hint: "abcd", updatedAt: "2026-11-17T08:00:00.000Z", readable: patch.readable ?? true }
});

describe("kopplingen till Lantmäteriet", () => {
  it("läser kontots läge ur det som är sparat", () => {
    expect(lantmaterietLink(undefined)).toBe("unknown");
    expect(lantmaterietLink(view())).toBe("connected");
    expect(lantmaterietLink(view({ saved: false }))).toBe("missing");
    expect(lantmaterietLink(view({ readable: false }))).toBe("unreadable");
    // Utan masternyckel går ingenting, sparat eller inte.
    expect(lantmaterietLink(view({ available: false }))).toBe("server");
    expect(lantmaterietLink(view({ available: false, saved: false }))).toBe("server");
  });

  it("visar ett besked innan man trycker bara när det redan syns att hämtningen inte kan gå", () => {
    expect(lantmaterietGap(undefined)).toBeUndefined();
    expect(lantmaterietGap(view())).toBeUndefined();
    expect(lantmaterietGap(view({ saved: false }))).toBe("missing");
    expect(lantmaterietGap(view({ readable: false }))).toBe("unreadable");
    expect(lantmaterietGap(view({ available: false }))).toBe("server");
  });

  it("gör serverns felkoder till rätt besked", () => {
    expect(lantmaterietProblem("SOURCE_NO_CREDENTIAL", view({ saved: false }))).toBe("missing");
    expect(lantmaterietProblem("SOURCE_NO_CREDENTIAL", undefined)).toBe("missing");
    expect(lantmaterietProblem("SOURCE_NO_CREDENTIAL", view({ readable: false }))).toBe("unreadable");
    expect(lantmaterietProblem("SOURCE_NO_CREDENTIAL", view({ available: false }))).toBe("server");
    // Nekad: fel uppgifter eller en produkt som inte är beställd går inte att skilja (401/403 i båda fallen).
    expect(lantmaterietProblem("SOURCE_REJECTED", view())).toBe("rejected");
    expect(lantmaterietProblem("REJECTED", view())).toBe("rejected");
  });

  it("låter andra fel vara vanliga fel", () => {
    for (const code of ["SOURCE_AREA_TOO_LARGE", "SOURCE_THROTTLED", "SOURCE_UNAVAILABLE", "GEO_JOB_BUSY", undefined]) {
      expect(lantmaterietProblem(code, view())).toBeUndefined();
    }
  });
});
