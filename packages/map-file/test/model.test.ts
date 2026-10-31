import { MapFileError } from "../src";

describe("MapFileError", () => {
  it("bär en kod", () => {
    const error = new MapFileError("TRUNCATED", "Filen är avkortad");
    expect(error.code).toBe("TRUNCATED");
    expect(error).toBeInstanceOf(Error);
  });
});
