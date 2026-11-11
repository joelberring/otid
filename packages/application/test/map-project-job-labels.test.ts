import { describe, expect, it } from "vitest";
import { isom2000To2017, usesIsom2000 } from "../src/map-project-job-labels";

describe("klassrastret och äldre symbolnummer", () => {
  it("känner igen ISOM 2000 på ytor med 526, 527 eller 529", () => {
    expect(usesIsom2000([101, 310, 526])).toBe(true);
    expect(usesIsom2000([403, 521, 520, 501])).toBe(false);
  });
  it("räknar om punkthöjd, sankmark, berg i dagen och byggnad till ISOM 2017-2", () => {
    expect([112, 113, 310, 311, 309, 212, 526, 527, 529, 507].map(isom2000To2017)).toEqual([109, 110, 308, 310, 307, 214, 521, 520, 501, 506]);
    expect([101, 403, 406].map(isom2000To2017)).toEqual([101, 403, 406]);
  });
});
