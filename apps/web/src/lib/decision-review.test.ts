import { describe, expect, it } from "vitest";
import { decisionReviewText, withdrawChoiceFor } from "./decision-review";

describe("beslut att se över (steg 45)", () => {
  it("säger vad avläsningen ger och vilket beslut som gäller", () => {
    expect(decisionReviewText({ decision: "DNF", status: "OK", elapsedMs: 45 * 60_000 + 12_000 }))
      .toBe("Avläsningen ger Godkänd 45:12 men beslutet Brutit gäller.");
    expect(decisionReviewText({ decision: "DNF", status: "MP" })).toBe("Avläsningen ger Felstämplad men beslutet Brutit gäller.");
    expect(withdrawChoiceFor("FINISH_TIME")).toBe("MANUAL_TIME_WITHDRAWAL");
    expect(withdrawChoiceFor("MP_CONFIRMED")).toBe("CONFIRM_MP_WITHDRAWAL");
  });
});
