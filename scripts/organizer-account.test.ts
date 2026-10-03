import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseOrganizerAccountArguments,
  readPrivateInput,
  reserveOrganizerPrivateOutput,
  validateOrganizerAccountTarget
} from "./organizer-account.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("TASK150 organizer account CLI", () => {
  it("parses only command, confirmation, and private output path", () => {
    expect(parseOrganizerAccountArguments(["provision", "--confirm", "production-organizer-account", "--private-output", "/private/account.json"]))
      .toEqual({ command: "provision", confirmation: "production-organizer-account", outputPath: "/private/account.json" });
    expect(() => parseOrganizerAccountArguments(["provision", "--password", "plaintext"]))
      .toThrow("ORGANIZER_ARGUMENTS_INVALID");
  });

  it("requires a production confirmation or a matching isolated test database", () => {
    const prod = parseOrganizerAccountArguments(["provision", "--confirm", "production-organizer-account", "--private-output", "/private/a"]);
    expect(validateOrganizerAccountTarget({ command: prod, nodeEnv: "production", databaseUrl: "postgres://prod", testDatabaseUrl: undefined }))
      .toBe("postgres://prod");
    const test = parseOrganizerAccountArguments(["rotate", "--confirm", "synthetic-test-database", "--private-output", "/private/a"]);
    const isolatedUrl = "postgresql://localhost:5432/otid_task150_cli_test";
    expect(validateOrganizerAccountTarget({ command: test, nodeEnv: "test", databaseUrl: isolatedUrl, testDatabaseUrl: isolatedUrl }))
      .toBe(isolatedUrl);
    const genericIsolatedUrl = "postgresql://localhost:5432/otid_test_cli";
    expect(validateOrganizerAccountTarget({ command: test, nodeEnv: "test", databaseUrl: genericIsolatedUrl, testDatabaseUrl: genericIsolatedUrl }))
      .toBe(genericIsolatedUrl);
    for (const unsafeUrl of [
      "postgresql://localhost:5432/otid_competition",
      "postgresql://db.internal:5432/otid_test_cli",
      "postgresql://localhost:5432/otid_demo_test"
    ]) {
      expect(() => validateOrganizerAccountTarget({ command: test, nodeEnv: "test", databaseUrl: unsafeUrl, testDatabaseUrl: unsafeUrl }))
        .toThrow("ORGANIZER_TARGET_INVALID");
    }
    expect(() => validateOrganizerAccountTarget({ command: test, nodeEnv: "test", databaseUrl: "postgresql://localhost/otid_test_cli", testDatabaseUrl: "postgresql://localhost/otid_test_other" }))
      .toThrow("ORGANIZER_TARGET_INVALID");
    expect(() => validateOrganizerAccountTarget({ command: test, nodeEnv: "development", databaseUrl: "postgres://local", testDatabaseUrl: undefined }))
      .toThrow("ORGANIZER_TARGET_INVALID");
  });

  it("reads bounded JSON stdin without accepting malformed or oversized data", async () => {
    async function* source(text: string) { yield Buffer.from(text); }
    await expect(readPrivateInput(source('{"loginName":"organizer","displayName":"Arrangör"}')))
      .resolves.toEqual({ loginName: "organizer", displayName: "Arrangör" });
    await expect(readPrivateInput(source("not json"))).rejects.toThrow("ORGANIZER_INPUT_INVALID");
    await expect(readPrivateInput(source("x".repeat(17 * 1024)))).rejects.toThrow("ORGANIZER_INPUT_INVALID");
  });

  it("writes once to a newly created 0600 file in a private directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otid-organizer-cli-"));
    directories.push(directory);
    const path = join(await realpath(directory), "credentials.json");
    const output = await reserveOrganizerPrivateOutput(path);
    await output.write({ accountId: "synthetic", password: "generated-secret" });
    await output.close();
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ accountId: "synthetic", password: "generated-secret" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
