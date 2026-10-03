import { describe, expect, it } from "vitest";
import { parseDemoCliArguments } from "../src/demo-cli-input";
describe("demo CLI input", () => {
  it("requires explicit confirmation and private output exactly once", () => {
    expect(parseDemoCliArguments(["--private-output", "/private/tmp/demo/access.json", "--confirm", "synthetic-empty-database"]))
      .toEqual({ outputPath: "/private/tmp/demo/access.json", confirmation: "synthetic-empty-database" });
  });
  it("rejects missing, repeated and unknown arguments without exposing values", () => {
    for (const args of [[], ["--confirm"], ["--confirm", "wrong", "--private-output", "/private/secret"],
      ["--confirm", "synthetic-empty-database", "--confirm", "synthetic-empty-database"],
      ["--database-url", "SECRET", "--private-output", "/private/secret"],
      ["--confirm", "synthetic-empty-database", "--private-output", ""],
      ["--confirm", "synthetic-empty-database", "--private-output", "/private/secret", "extra"]]) {
      expect(() => parseDemoCliArguments(args)).toThrow("DEMO_ARGUMENTS_INVALID");
    }
  });
});
