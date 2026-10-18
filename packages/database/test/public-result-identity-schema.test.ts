import { describe, expect, it } from "vitest";
import { entries } from "../src/schema";

describe("TASK089 public result identity schema", () => {
  it("keeps an opaque generated identity on the race-scoped entry", () => {
    expect(entries.publicResultId.name).toBe("public_result_id");
    expect(entries.publicResultId.notNull).toBe(true);
  });
});
