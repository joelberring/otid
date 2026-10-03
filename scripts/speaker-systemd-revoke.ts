import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../packages/database/src/index.ts";
import { revokePairingAdminAccessCredential } from "../packages/application/src/pairing-admin.ts";
import { readPrivateInput, reserveOrganizerPrivateOutput } from "./organizer-account.ts";

const STATE_DIRECTORY = "/var/lib/o-tid-private-cli-results";
const STOP_FILE = "/var/lib/o-tid/controller/closed";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function speakerSystemdRevokePaths(env: NodeJS.ProcessEnv): { requestPath: string; outputPath: string } {
  const credentials = env.CREDENTIALS_DIRECTORY;
  const invocation = env.INVOCATION_ID;
  if (env.OTID_WRITER_STOP_PROFILE !== "systemd-v1" || env.OTID_WRITER_STOP_FILE !== STOP_FILE ||
    env.STATE_DIRECTORY !== STATE_DIRECTORY || !credentials || !isAbsolute(credentials) ||
    resolve(credentials) !== credentials || !invocation || !/^[0-9a-f]{32}$/.test(invocation)) {
    throw new Error("SPEAKER_SYSTEMD_ENV_INVALID");
  }
  return {
    requestPath: join(credentials, "speaker-revoke-request"),
    outputPath: join(STATE_DIRECTORY, `speaker-revoke-${invocation}.json`)
  };
}

export function parseSpeakerSystemdRevokeRequest(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "credentialId" || keys[1] !== "formatVersion" ||
    value.formatVersion !== 1 || typeof value.credentialId !== "string" || !UUID.test(value.credentialId)) {
    throw new Error("SPEAKER_SYSTEMD_REQUEST_INVALID");
  }
  return value.credentialId;
}

export async function readSpeakerSystemdRevokeRequest(requestPath: string): Promise<string> {
  const file = await open(requestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.nlink !== 1) throw new Error("SPEAKER_SYSTEMD_REQUEST_INVALID");
    return parseSpeakerSystemdRevokeRequest(await readPrivateInput(file.createReadStream({ autoClose: false })));
  } finally {
    await file.close();
  }
}

async function main(): Promise<void> {
  if (process.argv.length !== 2 || !process.env.DATABASE_URL) throw new Error("SPEAKER_SYSTEMD_ARGUMENTS_INVALID");
  const paths = speakerSystemdRevokePaths(process.env);
  const credentialId = await readSpeakerSystemdRevokeRequest(paths.requestPath);
  const output = await reserveOrganizerPrivateOutput(paths.outputPath);
  try {
    const { db, pool } = createDatabase(process.env.DATABASE_URL);
    try {
      const result = await revokePairingAdminAccessCredential(db, {
        credentialId, capability: "VIEW_SPEAKER_BOARD"
      });
      await output.write(result);
    } finally {
      await pool.end();
    }
  } finally {
    await output.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    process.stderr.write("Speaker-spärrningen misslyckades; kontrollera privat kvittens och enhetens exitstatus.\n");
    process.exitCode = 1;
  });
}
