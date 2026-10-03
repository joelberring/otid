import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertCaptureOutputAllowed,
  isPathInside,
  parseCaptureArguments,
  parseReplayArguments
} from "../src/cli-arguments.js";

describe("capture CLI arguments", () => {
  it("requires explicit port, baud and output", () => {
    expect(() => parseCaptureArguments(["--port", "/dev/cu.test", "--out", "/tmp/capture"])).toThrow(
      "requires --baud"
    );
    expect(() => parseCaptureArguments(["--baud", "38400", "--out", "/tmp/capture"])).toThrow(
      "requires --port"
    );
    expect(() => parseCaptureArguments(["--port", "/dev/cu.test", "--baud", "38400"])).toThrow(
      "requires --out"
    );
  });

  it("parses exact integer baud and explicit repository opt-in", () => {
    expect(parseCaptureArguments([
      "--port=/dev/cu.test",
      "--baud=38400",
      "--out=/tmp/capture",
      "--allow-repository-output"
    ])).toEqual({
      port: "/dev/cu.test",
      baudRate: 38_400,
      outputDirectory: "/tmp/capture",
      allowRepositoryOutput: true
    });
    expect(() => parseCaptureArguments(["--port=x", "--baud=38400.5", "--out=/tmp/x"])).toThrow(
      "positive integer"
    );
  });

  it("requires exactly one final manifest for replay", () => {
    expect(parseReplayArguments(["/tmp/session.json"])).toEqual({ manifestPath: "/tmp/session.json" });
    expect(() => parseReplayArguments([])).toThrow("Usage");
    expect(() => parseReplayArguments(["one", "two"])).toThrow("Usage");
  });
});

describe("capture output boundary", () => {
  it("recognizes lexical containment", () => {
    expect(isPathInside("/repo", "/repo/captures")).toBe(true);
    expect(isPathInside("/repo", "/repo-other/captures")).toBe(false);
  });

  it("rejects repository output and a symlink resolving into it", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "otid-output-boundary-"));
    const repository = path.join(base, "repository");
    const outside = path.join(base, "outside");
    await mkdir(path.join(repository, "captures"), { recursive: true });
    await mkdir(outside);
    await symlink(path.join(repository, "captures"), path.join(outside, "capture-link"));

    await expect(assertCaptureOutputAllowed(path.join(repository, "captures"), repository, false)).rejects.toThrow(
      "requires --allow-repository-output"
    );
    await expect(assertCaptureOutputAllowed(path.join(outside, "capture-link"), repository, false)).rejects.toThrow(
      "requires --allow-repository-output"
    );
    await expect(
      assertCaptureOutputAllowed(path.join(outside, "capture-link", "not-created-yet"), repository, false)
    ).rejects.toThrow("requires --allow-repository-output");
    await expect(assertCaptureOutputAllowed(path.join(repository, "captures"), repository, true)).resolves.toBeUndefined();
  });
});
