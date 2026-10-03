import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FixedStartSlotPlans } from "./fixed-start-slot-plans";

describe("TASK108 startplansskal", () => {
  it("visar den försiktiga svenska förklaringen innan en privat rapport begärs", () => {
    const html = renderToStaticMarkup(<FixedStartSlotPlans raceId="10000000-0000-4000-8000-000000000001" disabled={false} />);
    expect(html).toContain("Planerade startluckor");
    expect(html).toContain("endast luckor från senaste sparade lottning");
    expect(html).toContain("inte en bokning");
    expect(html).not.toContain("Ada Andersson");
  });
});
