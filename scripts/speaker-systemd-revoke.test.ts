import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reserveOrganizerPrivateOutput } from "./organizer-account.ts";
import {
  parseSpeakerSystemdRevokeRequest, readSpeakerSystemdRevokeRequest, speakerSystemdRevokePaths
} from "./speaker-systemd-revoke.ts";

const credentialId = "123e4567-e89b-42d3-a456-426614174000";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("TASK193 fixed speaker revoke start", () => {
  it("accepts only the fixed systemd profile and invocation-scoped private result path", () => {
    const env = {
      OTID_WRITER_STOP_PROFILE: "systemd-v1",
      OTID_WRITER_STOP_FILE: "/var/lib/o-tid/controller/closed",
      STATE_DIRECTORY: "/var/lib/o-tid-private-cli-results",
      CREDENTIALS_DIRECTORY: "/run/credentials/otid-speaker-revoke.service",
      INVOCATION_ID: "a".repeat(32)
    };
    expect(speakerSystemdRevokePaths(env)).toEqual({
      requestPath: "/run/credentials/otid-speaker-revoke.service/speaker-revoke-request",
      outputPath: `/var/lib/o-tid-private-cli-results/speaker-revoke-${"a".repeat(32)}.json`
    });
    expect(() => speakerSystemdRevokePaths({ ...env, OTID_WRITER_STOP_FILE: "/tmp/closed" })).toThrow();
    expect(() => speakerSystemdRevokePaths({ ...env, INVOCATION_ID: "../bad" })).toThrow();
  });

  it("reads only a strict versioned request from a regular file without following a symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otid-speaker-revoke-"));
    directories.push(directory);
    const requestPath = join(directory, "request.json");
    await writeFile(requestPath, JSON.stringify({ formatVersion: 1, credentialId }));
    expect(await readSpeakerSystemdRevokeRequest(requestPath)).toBe(credentialId);
    expect(() => parseSpeakerSystemdRevokeRequest({ formatVersion: 1, credentialId, issue: true })).toThrow();
    expect(() => parseSpeakerSystemdRevokeRequest({ formatVersion: 2, credentialId })).toThrow();
    expect(() => parseSpeakerSystemdRevokeRequest({ formatVersion: 1, credentialId: credentialId.toUpperCase() })).toThrow();
    const linkedPath = join(directory, "link.json");
    await symlink(requestPath, linkedPath);
    await expect(readSpeakerSystemdRevokeRequest(linkedPath)).rejects.toThrow();
  });

  it("reserves a fresh 0600 receipt and refuses a retry collision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "otid-speaker-result-"));
    directories.push(directory);
    const resultPath = join(await realpath(directory), "speaker-revoke-aaaa.json");
    const result = { status: "revoked", credentialId, revokedAt: "2026-09-27T10:00:00.000Z" };
    const output = await reserveOrganizerPrivateOutput(resultPath);
    await output.write(result);
    await output.close();
    expect((await stat(resultPath)).mode & 0o777).toBe(0o600);
    await expect(reserveOrganizerPrivateOutput(resultPath)).rejects.toThrow("ORGANIZER_OUTPUT_INVALID");
    expect(JSON.parse(await readFile(resultPath, "utf8"))).toEqual(result);
  });
});
