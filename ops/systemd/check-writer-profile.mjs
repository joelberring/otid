import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const PROFILE = "systemd-v1";
export const MARKER = "/var/lib/o-tid/controller/closed";

export const UNIT_DIRECTORY = "/etc/systemd/system";
const RELEASE_ROOT = "/opt/o-tid";
const CREDENTIAL_ROOT = "/etc/o-tid/writer-credentials";
const REQUEST_ROOT = "/etc/o-tid/cli-requests";
const CONTROLLER_ROOT = "/var/lib/o-tid/controller";
const LAUNCHER = "/opt/o-tid/ops/systemd/writer-start.sh";
const START_CHECK = "/opt/o-tid/ops/systemd/check-writer-start.mjs";
const WEB_SERVER = "/opt/o-tid/apps/web/.next/standalone/apps/web/server.js";

export const WRITER_PROFILE_UNITS = {
  "otid-web.service": {
    command: `/bin/sh ${LAUNCHER} /usr/bin/node /opt/o-tid/apps/web/.next/standalone/apps/web/server.js`,
    credentials: {
      "database-url": `${CREDENTIAL_ROOT}/database-url`,
      "map-store-access-key": `${CREDENTIAL_ROOT}/map-store-access-key`,
      "map-store-secret-key": `${CREDENTIAL_ROOT}/map-store-secret-key`,
      "route-store-access-key": `${CREDENTIAL_ROOT}/route-store-access-key`,
      "route-store-secret-key": `${CREDENTIAL_ROOT}/route-store-secret-key`,
      "eventor-master-key-id": `${CREDENTIAL_ROOT}/eventor-master-key-id`,
      "eventor-master-key-base64": `${CREDENTIAL_ROOT}/eventor-master-key-base64`,
      "package-signing-private-key-pem": `${CREDENTIAL_ROOT}/package-signing-private-key-pem`
    }
  },
  "otid-db-migrate.service": {
    command: `/bin/sh ${LAUNCHER} /usr/bin/pnpm --filter @o-tid/database migrate`,
    credentials: { "database-url": `${CREDENTIAL_ROOT}/database-url` }
  },
  "otid-speaker-revoke.service": {
    command: `/bin/sh ${LAUNCHER} /usr/bin/pnpm --silent speaker:access:revoke:systemd`,
    credentials: {
      "database-url": `${CREDENTIAL_ROOT}/database-url`,
      "speaker-revoke-request": `${REQUEST_ROOT}/speaker-revoke.json`
    }
  }
};

function linesWith(text, prefix) {
  return text.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
}

function assertCondition(value, code) {
  if (!value) throw new Error(code);
}

function safeRootObject(state, kind, code) {
  assertCondition(state.uid === 0 && (state.mode & 0o022) === 0, code);
  assertCondition(kind === "directory" ? state.isDirectory() : state.isFile(), code);
}

async function checkRootChain(path, kind, io, code) {
  const paths = [];
  for (let current = path; current !== "/"; current = dirname(current)) paths.unshift(current);
  paths.unshift("/");
  let finalState;
  for (const [index, current] of paths.entries()) {
    const state = await io.lstat(current);
    safeRootObject(state, index === paths.length - 1 ? kind : "directory", code);
    finalState = state;
  }
  return finalState;
}

async function checkPrivateFile(path, io, code) {
  const state = await checkRootChain(path, "file", io, code);
  assertCondition((state.mode & 0o077) === 0 && state.nlink === 1 && state.size > 0, code);
}

async function checkUnit(name, expected, io) {
  const path = `${UNIT_DIRECTORY}/${name}`;
  const state = await checkRootChain(path, "file", io, "WRITER_PROFILE_UNIT_UNSAFE");
  assertCondition(state.nlink === 1, "WRITER_PROFILE_UNIT_UNSAFE");
  const templatePath = `${RELEASE_ROOT}/ops/systemd/${name}.example`;
  await checkRootChain(templatePath, "file", io, "WRITER_PROFILE_RELEASE_UNSAFE");
  const text = await io.readFile(path, "utf8");
  assertCondition(text === await io.readFile(templatePath, "utf8"), "WRITER_PROFILE_UNIT_DIFFERS_FROM_RELEASE");
  assertCondition(linesWith(text, "User=").length === 1 && linesWith(text, "User=")[0] === "User=otid-writer",
    "WRITER_PROFILE_IDENTITY_INVALID");
  assertCondition(linesWith(text, "Group=").length === 1 && linesWith(text, "Group=")[0] === "Group=otid-writer",
    "WRITER_PROFILE_IDENTITY_INVALID");
  assertCondition(linesWith(text, "Environment=OTID_WRITER_STOP_PROFILE=").length === 1 &&
    linesWith(text, "Environment=OTID_WRITER_STOP_PROFILE=")[0] === `Environment=OTID_WRITER_STOP_PROFILE=${PROFILE}`,
  "WRITER_PROFILE_MARKER_INVALID");
  assertCondition(linesWith(text, "Environment=OTID_WRITER_STOP_FILE=").length === 1 &&
    linesWith(text, "Environment=OTID_WRITER_STOP_FILE=")[0] === `Environment=OTID_WRITER_STOP_FILE=${MARKER}`,
  "WRITER_PROFILE_MARKER_INVALID");
  assertCondition(linesWith(text, "ExecStart=").length === 1 &&
    linesWith(text, "ExecStart=")[0] === `ExecStart=${expected.command}`, "WRITER_PROFILE_COMMAND_INVALID");
  const actualCredentials = Object.fromEntries(linesWith(text, "LoadCredential=").map((line) => {
    const entry = line.slice("LoadCredential=".length);
    const separator = entry.indexOf(":");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  assertCondition(JSON.stringify(actualCredentials) === JSON.stringify(expected.credentials),
    "WRITER_PROFILE_CREDENTIAL_SET_INVALID");
}

/** Read-only preflight. Success is not systemd, credential-isolation or drain acceptance. */
export async function checkWriterProfile({
  platform = process.platform,
  effectiveUid = process.geteuid?.(),
  io = { lstat, readFile, readdir },
  lookupUser = async (name) => {
    const passwd = await readFile("/etc/passwd", "utf8");
    const row = passwd.split("\n").find((line) => line.startsWith(`${name}:`));
    if (!row) return null;
    const fields = row.split(":");
    return { uid: Number(fields[2]), gid: Number(fields[3]) };
  }
} = {}) {
  assertCondition(platform === "linux" && effectiveUid === 0, "WRITER_PROFILE_REQUIRES_LINUX_ROOT");
  const identity = await lookupUser("otid-writer");
  assertCondition(identity && identity.uid > 0 && identity.gid > 0, "WRITER_PROFILE_IDENTITY_INVALID");

  for (const directoryPath of [UNIT_DIRECTORY, RELEASE_ROOT, CREDENTIAL_ROOT, REQUEST_ROOT, CONTROLLER_ROOT]) {
    const state = await checkRootChain(directoryPath, "directory", io, "WRITER_PROFILE_DIRECTORY_UNSAFE");
    if (directoryPath === CREDENTIAL_ROOT || directoryPath === REQUEST_ROOT) {
      assertCondition((state.mode & 0o077) === 0, "WRITER_PROFILE_PRIVATE_DIRECTORY_UNSAFE");
    }
  }
  for (const path of [LAUNCHER, START_CHECK, WEB_SERVER]) {
    const state = await checkRootChain(path, "file", io, "WRITER_PROFILE_RELEASE_UNSAFE");
    assertCondition(state.nlink === 1, "WRITER_PROFILE_RELEASE_UNSAFE");
  }

  const installed = (await io.readdir(UNIT_DIRECTORY)).filter((name) => name.startsWith("otid-")).sort();
  assertCondition(JSON.stringify(installed) === JSON.stringify(Object.keys(WRITER_PROFILE_UNITS).sort()), "WRITER_PROFILE_UNIT_ALLOWLIST_INVALID");
  for (const [name, expected] of Object.entries(WRITER_PROFILE_UNITS)) await checkUnit(name, expected, io);

  const credentialFiles = [...new Set(Object.values(WRITER_PROFILE_UNITS).flatMap(({ credentials }) => Object.values(credentials)))];
  for (const path of credentialFiles) await checkPrivateFile(path, io, "WRITER_PROFILE_CREDENTIAL_UNSAFE");

  try {
    const marker = await io.lstat(MARKER);
    safeRootObject(marker, "file", "WRITER_PROFILE_MARKER_UNSAFE");
    assertCondition((marker.mode & 0o777) === 0o600 && marker.nlink === 1 && marker.size === 0,
      "WRITER_PROFILE_MARKER_UNSAFE");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { profile: PROFILE, status: "PREPARED_PREFLIGHT_ONLY_NOT_ACCEPTED", units: Object.keys(WRITER_PROFILE_UNITS).sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkWriterProfile().then(() => {
    process.stdout.write("WRITER_PROFILE_PREFLIGHT_PASSED_ONLY; NOT_ACCEPTED\n");
  }).catch(() => {
    process.stderr.write("WRITER_PROFILE_PREFLIGHT_FAILED; NOT_ACCEPTED\n");
    process.exitCode = 1;
  });
}
