import { constants } from "node:fs";
import { link, lstat, open, readFile, readdir, unlink } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

export const CONFIRMATION = "install-closed-systemd-v1-writer-profile";
export const MARKER = "/var/lib/o-tid/controller/closed";
export const UNIT_DIRECTORY = "/etc/systemd/system";

const RELEASE_ROOT = "/opt/o-tid";
const RELEASE_START_FILES = [
  `${RELEASE_ROOT}/ops/systemd/writer-start.sh`,
  `${RELEASE_ROOT}/ops/systemd/check-writer-start.mjs`,
  `${RELEASE_ROOT}/apps/web/.next/standalone/apps/web/server.js`
];
const CONFIG = "/etc/o-tid/writer-config";
const CREDENTIAL_ROOT = "/etc/o-tid/writer-credentials";
const REQUEST_ROOT = "/etc/o-tid/cli-requests";
const UNIT_NAMES = ["otid-db-migrate.service", "otid-speaker-revoke.service", "otid-web.service"];
const CREDENTIALS = [
  `${CREDENTIAL_ROOT}/database-url`,
  `${CREDENTIAL_ROOT}/eventor-master-key-base64`,
  `${CREDENTIAL_ROOT}/eventor-master-key-id`,
  `${CREDENTIAL_ROOT}/map-store-access-key`,
  `${CREDENTIAL_ROOT}/map-store-secret-key`,
  `${CREDENTIAL_ROOT}/package-signing-private-key-pem`,
  `${CREDENTIAL_ROOT}/route-store-access-key`,
  `${CREDENTIAL_ROOT}/route-store-secret-key`,
  `${REQUEST_ROOT}/speaker-revoke.json`
];
const CONFIG_KEYS = new Set([
  "OTID_MAP_STORE_ID", "OTID_MAP_STORE_ENDPOINT", "OTID_MAP_STORE_BUCKET", "OTID_MAP_STORE_REGION",
  "OTID_MAP_STORE_MODE", "OTID_ROUTE_STORE_ID", "OTID_ROUTE_STORE_ENDPOINT", "OTID_ROUTE_STORE_BUCKET",
  "OTID_ROUTE_STORE_REGION", "OTID_ROUTE_STORE_MODE", "O_TID_PUBLIC_ORIGIN"
]);

function assertCondition(value, code) {
  if (!value) throw new Error(code);
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
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
    let state;
    try { state = await io.lstat(current); } catch { throw new Error(code); }
    safeRootObject(state, index === paths.length - 1 ? kind : "directory", code);
    finalState = state;
  }
  return finalState;
}

async function checkPrivateInput(path, io) {
  const state = await checkRootChain(path, "file", io, "WRITER_PROFILE_PRIVATE_INPUT_UNSAFE");
  assertCondition((state.mode & 0o077) === 0 && state.nlink === 1 && state.size > 0,
    "WRITER_PROFILE_PRIVATE_INPUT_UNSAFE");
}

function validateNonSecretConfig(text) {
  assertCondition(Buffer.byteLength(text, "utf8") <= 16_384 && !/[\0\r]/u.test(text),
    "WRITER_PROFILE_CONFIG_INVALID");
  const seen = new Set();
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=([A-Za-z0-9._:/-]+)$/u.exec(line);
    assertCondition(match && CONFIG_KEYS.has(match[1]) && !seen.has(match[1]),
      "WRITER_PROFILE_CONFIG_INVALID");
    const [, key, value] = match;
    if (key.endsWith("_ENDPOINT") || key === "O_TID_PUBLIC_ORIGIN") {
      let url;
      try { url = new URL(value); } catch { throw new Error("WRITER_PROFILE_CONFIG_INVALID"); }
      assertCondition(url.protocol === "https:" && value === url.origin &&
        url.username === "" && url.password === "" && url.search === "" && url.hash === "",
      "WRITER_PROFILE_CONFIG_INVALID");
    } else if (key.endsWith("_ID")) {
      assertCondition(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value),
        "WRITER_PROFILE_CONFIG_INVALID");
    } else if (key.endsWith("_BUCKET")) {
      assertCondition(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/u.test(value), "WRITER_PROFILE_CONFIG_INVALID");
    } else if (key.endsWith("_REGION")) {
      assertCondition(/^[a-z0-9-]{1,64}$/u.test(value), "WRITER_PROFILE_CONFIG_INVALID");
    } else {
      assertCondition(value === "production", "WRITER_PROFILE_CONFIG_INVALID");
    }
    seen.add(key);
  }
  assertCondition(seen.size === CONFIG_KEYS.size, "WRITER_PROFILE_CONFIG_INVALID");
}

async function existingUnitState(io) {
  const names = (await io.readdir(UNIT_DIRECTORY)).filter((name) =>
    name.startsWith("otid-") || /^\.otid-.*\.otid-installing$/u.test(name)).sort();
  if (names.length === 0) return "empty";
  assertCondition(JSON.stringify(names) === JSON.stringify(UNIT_NAMES), "WRITER_PROFILE_PARTIAL_OR_EXTRA_INSTALL");
  for (const name of UNIT_NAMES) {
    const destination = `${UNIT_DIRECTORY}/${name}`;
    const state = await checkRootChain(destination, "file", io, "WRITER_PROFILE_INSTALLED_UNIT_UNSAFE");
    assertCondition(state.nlink === 1, "WRITER_PROFILE_INSTALLED_UNIT_UNSAFE");
    assertCondition(await io.readFile(destination, "utf8") ===
      await io.readFile(`${RELEASE_ROOT}/ops/systemd/${name}.example`, "utf8"),
    "WRITER_PROFILE_INSTALLED_UNIT_CHANGED");
  }
  return "complete";
}

async function installOne(name, bytes, io) {
  const destination = `${UNIT_DIRECTORY}/${name}`;
  const temporary = `${UNIT_DIRECTORY}/.${name}.otid-installing`;
  const before = await io.lstat(UNIT_DIRECTORY);
  const directory = await io.open(UNIT_DIRECTORY,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let temporaryFile;
  try {
    assertCondition(sameFile(before, await directory.stat()), "WRITER_PROFILE_UNIT_DIRECTORY_CHANGED");
    temporaryFile = await io.open(temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    await temporaryFile.writeFile(bytes);
    await temporaryFile.chmod(0o644);
    await temporaryFile.sync();
    await temporaryFile.close();
    temporaryFile = undefined;
    await io.link(temporary, destination);
    await io.unlink(temporary);
    const installed = await io.lstat(destination);
    safeRootObject(installed, "file", "WRITER_PROFILE_INSTALLED_UNIT_UNSAFE");
    assertCondition(installed.nlink === 1 && (installed.mode & 0o777) === 0o644,
      "WRITER_PROFILE_INSTALLED_UNIT_UNSAFE");
    await directory.sync();
    assertCondition(sameFile(before, await io.lstat(UNIT_DIRECTORY)), "WRITER_PROFILE_UNIT_DIRECTORY_CHANGED");
  } finally {
    if (temporaryFile) await temporaryFile.close();
    await directory.close();
  }
}

/** Installs fixed unit files only. It never invokes or controls systemd. */
export async function installWriterProfile({
  confirmation,
  platform = process.platform,
  effectiveUid = process.geteuid?.(),
  io = { link, lstat, open, readFile, readdir, unlink },
  lookupUser = async (name) => {
    const passwd = await readFile("/etc/passwd", "utf8");
    const row = passwd.split("\n").find((line) => line.startsWith(`${name}:`));
    if (!row) return null;
    const fields = row.split(":");
    return { uid: Number(fields[2]), gid: Number(fields[3]) };
  }
} = {}) {
  assertCondition(confirmation === CONFIRMATION, "WRITER_PROFILE_INSTALL_CONFIRMATION_REQUIRED");
  assertCondition(platform === "linux" && effectiveUid === 0, "WRITER_PROFILE_INSTALL_REQUIRES_LINUX_ROOT");
  const identity = await lookupUser("otid-writer");
  assertCondition(identity && identity.uid > 0 && identity.gid > 0, "WRITER_PROFILE_IDENTITY_INVALID");

  for (const path of [UNIT_DIRECTORY, RELEASE_ROOT, CREDENTIAL_ROOT, REQUEST_ROOT, dirname(MARKER)]) {
    const state = await checkRootChain(path, "directory", io, "WRITER_PROFILE_DIRECTORY_UNSAFE");
    if (path === CREDENTIAL_ROOT || path === REQUEST_ROOT) {
      assertCondition((state.mode & 0o077) === 0, "WRITER_PROFILE_PRIVATE_DIRECTORY_UNSAFE");
    }
  }
  let marker;
  try {
    marker = await checkRootChain(MARKER, "file", io, "WRITER_PROFILE_CLOSED_MARKER_REQUIRED");
  } catch {
    throw new Error("WRITER_PROFILE_CLOSED_MARKER_REQUIRED");
  }
  assertCondition((marker.mode & 0o777) === 0o600 && marker.nlink === 1 && marker.size === 0,
    "WRITER_PROFILE_CLOSED_MARKER_REQUIRED");
  const checkSameClosedMarker = async () => {
    const current = await checkRootChain(MARKER, "file", io, "WRITER_PROFILE_CLOSED_MARKER_CHANGED");
    assertCondition(sameFile(marker, current) && (current.mode & 0o777) === 0o600 &&
      current.nlink === 1 && current.size === 0, "WRITER_PROFILE_CLOSED_MARKER_CHANGED");
  };
  for (const path of CREDENTIALS) await checkPrivateInput(path, io);
  const configState = await checkRootChain(CONFIG, "file", io, "WRITER_PROFILE_CONFIG_UNSAFE");
  assertCondition(configState.nlink === 1 && (configState.mode & 0o022) === 0, "WRITER_PROFILE_CONFIG_UNSAFE");
  validateNonSecretConfig(await io.readFile(CONFIG, "utf8"));

  const templates = new Map();
  for (const name of UNIT_NAMES) {
    const path = `${RELEASE_ROOT}/ops/systemd/${name}.example`;
    const state = await checkRootChain(path, "file", io, "WRITER_PROFILE_TEMPLATE_UNSAFE");
    assertCondition(state.nlink === 1, "WRITER_PROFILE_TEMPLATE_UNSAFE");
    templates.set(name, await io.readFile(path));
  }
  for (const path of RELEASE_START_FILES) {
    const state = await checkRootChain(path, "file", io, "WRITER_PROFILE_RELEASE_START_UNSAFE");
    assertCondition(state.nlink === 1 && state.size > 0, "WRITER_PROFILE_RELEASE_START_UNSAFE");
  }
  await checkSameClosedMarker();
  const state = await existingUnitState(io);
  if (state === "complete") {
    await checkSameClosedMarker();
    return { status: "ALREADY_INSTALLED_NO_ACTIVATION_ACTION", units: UNIT_NAMES };
  }
  for (const name of UNIT_NAMES) {
    await checkSameClosedMarker();
    await installOne(name, templates.get(name), io);
    await checkSameClosedMarker();
  }
  assertCondition(await existingUnitState(io) === "complete", "WRITER_PROFILE_INSTALL_INCOMPLETE");
  await checkSameClosedMarker();
  return { status: "INSTALLED_NO_ACTIVATION_ACTION", units: UNIT_NAMES };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== "--confirm") {
    process.stderr.write("WRITER_PROFILE_INSTALL_FAILED; NO_ACTIVATION_ACTION\n");
    process.exitCode = 1;
  } else {
    installWriterProfile({ confirmation: process.argv[3] }).then(({ status }) => {
      process.stdout.write(`${status}; NO_DAEMON_RELOAD; NOT_ACCEPTED\n`);
    }).catch(() => {
      process.stderr.write("WRITER_PROFILE_INSTALL_FAILED; INSPECT_PARTIAL_STATE; NO_ACTIVATION_ACTION\n");
      process.exitCode = 1;
    });
  }
}
