import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";
import { checkWriterProfile, MARKER } from "./check-writer-profile.mjs";

const unitNames = ["otid-db-migrate.service", "otid-speaker-revoke.service", "otid-web.service"];
const file = (overrides = {}) => ({ uid: 0, mode: 0o100400, nlink: 1, size: 8,
  isFile: () => true, isDirectory: () => false, ...overrides });
const directory = (overrides = {}) => ({ uid: 0, mode: 0o40700, nlink: 2, size: 0,
  isFile: () => false, isDirectory: () => true, ...overrides });

const units = {
  "otid-web.service": `[Service]\nUser=otid-writer\nGroup=otid-writer\nEnvironment=OTID_WRITER_STOP_PROFILE=systemd-v1\nEnvironment=OTID_WRITER_STOP_FILE=/var/lib/o-tid/controller/closed\nLoadCredential=database-url:/etc/o-tid/writer-credentials/database-url\nLoadCredential=map-store-access-key:/etc/o-tid/writer-credentials/map-store-access-key\nLoadCredential=map-store-secret-key:/etc/o-tid/writer-credentials/map-store-secret-key\nLoadCredential=route-store-access-key:/etc/o-tid/writer-credentials/route-store-access-key\nLoadCredential=route-store-secret-key:/etc/o-tid/writer-credentials/route-store-secret-key\nLoadCredential=eventor-master-key-id:/etc/o-tid/writer-credentials/eventor-master-key-id\nLoadCredential=eventor-master-key-base64:/etc/o-tid/writer-credentials/eventor-master-key-base64\nLoadCredential=package-signing-private-key-pem:/etc/o-tid/writer-credentials/package-signing-private-key-pem\nExecStart=/bin/sh /opt/o-tid/ops/systemd/writer-start.sh /usr/bin/node /opt/o-tid/apps/web/.next/standalone/apps/web/server.js\n`,
  "otid-db-migrate.service": `[Service]\nUser=otid-writer\nGroup=otid-writer\nEnvironment=OTID_WRITER_STOP_PROFILE=systemd-v1\nEnvironment=OTID_WRITER_STOP_FILE=/var/lib/o-tid/controller/closed\nLoadCredential=database-url:/etc/o-tid/writer-credentials/database-url\nExecStart=/bin/sh /opt/o-tid/ops/systemd/writer-start.sh /usr/bin/pnpm --filter @o-tid/database migrate\n`,
  "otid-speaker-revoke.service": `[Service]\nUser=otid-writer\nGroup=otid-writer\nEnvironment=OTID_WRITER_STOP_PROFILE=systemd-v1\nEnvironment=OTID_WRITER_STOP_FILE=/var/lib/o-tid/controller/closed\nLoadCredential=database-url:/etc/o-tid/writer-credentials/database-url\nLoadCredential=speaker-revoke-request:/etc/o-tid/cli-requests/speaker-revoke.json\nExecStart=/bin/sh /opt/o-tid/ops/systemd/writer-start.sh /usr/bin/pnpm --silent speaker:access:revoke:systemd\n`
};

const installedFiles = unitNames.map((name) => `/etc/systemd/system/${name}`);
const templateFiles = unitNames.map((name) => `/opt/o-tid/ops/systemd/${name}.example`);
const credentialFiles = [...new Set(Object.values(units).flatMap((text) =>
  [...text.matchAll(/^LoadCredential=[^:]+:(.+)$/gmu)].map((match) => match[1])))];
const knownFiles = new Set([...installedFiles, ...templateFiles,
  "/opt/o-tid/ops/systemd/writer-start.sh", "/opt/o-tid/ops/systemd/check-writer-start.mjs",
  "/opt/o-tid/apps/web/.next/standalone/apps/web/server.js", ...credentialFiles]);
const knownDirectories = new Set(["/"]);
for (const path of [...knownFiles, MARKER]) {
  for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) knownDirectories.add(parent);
}

function fixture({ names = unitNames, marker, mutateState, mutateUnit } = {}) {
  return {
    readdir: async () => names,
    readFile: async (path) => {
      const template = path.endsWith(".example");
      const name = path.split("/").at(-1).replace(/\.example$/u, "");
      const text = units[name];
      return !template && mutateUnit ? mutateUnit(name, text) : text;
    },
    lstat: async (path) => {
      if (path === MARKER) {
        if (marker) return marker;
        const error = new Error("missing"); error.code = "ENOENT"; throw error;
      }
      if (!knownDirectories.has(path) && !knownFiles.has(path)) {
        const error = new Error("missing"); error.code = "ENOENT"; throw error;
      }
      const state = knownDirectories.has(path) ? directory() : file();
      return mutateState ? mutateState(path, state) : state;
    }
  };
}

const run = (io) => checkWriterProfile({ platform: "linux", effectiveUid: 0, io,
  lookupUser: async () => ({ uid: 991, gid: 991 }) });

test("accepts only the pinned, private, root-owned prepared profile", async () => {
  assert.deepEqual(await run(fixture()), {
    profile: "systemd-v1", status: "PREPARED_PREFLIGHT_ONLY_NOT_ACCEPTED", units: unitNames
  });
  assert.equal((await run(fixture({ marker: file({ mode: 0o100600, size: 0 }) }))).status,
    "PREPARED_PREFLIGHT_ONLY_NOT_ACCEPTED");
});

test("fails closed for non-Linux, non-root or root service identity", async () => {
  await assert.rejects(checkWriterProfile({ platform: "darwin", effectiveUid: 0 }), /REQUIRES_LINUX_ROOT/u);
  await assert.rejects(checkWriterProfile({ platform: "linux", effectiveUid: 501 }), /REQUIRES_LINUX_ROOT/u);
  await assert.rejects(checkWriterProfile({ platform: "linux", effectiveUid: 0, io: fixture(),
    lookupUser: async () => ({ uid: 0, gid: 0 }) }), /IDENTITY_INVALID/u);
});

test("rejects worker and every other extra or missing O-Tid unit", async () => {
  await assert.rejects(run(fixture({ names: [...unitNames, "otid-worker.service"] })), /UNIT_ALLOWLIST_INVALID/u);
  await assert.rejects(run(fixture({ names: [...unitNames, "otid-web.service.d"] })), /UNIT_ALLOWLIST_INVALID/u);
  await assert.rejects(run(fixture({ names: unitNames.slice(1) })), /UNIT_ALLOWLIST_INVALID/u);
});

test("rejects changed command, marker, credential source or service identity", async () => {
  for (const [prefix, replacement] of [
    ["ExecStart=", "ExecStart=/usr/bin/true"],
    ["Environment=OTID_WRITER_STOP_FILE=", "Environment=OTID_WRITER_STOP_FILE=/tmp/closed"],
    ["LoadCredential=database-url:", "LoadCredential=database-url:/tmp/database-url"],
    ["User=", "User=root"]
  ]) {
    await assert.rejects(run(fixture({ mutateUnit: (name, text) => name === "otid-web.service" ?
      text.replace(new RegExp(`^${prefix}.*$`, "mu"), replacement) : text })));
  }
  await assert.rejects(run(fixture({ mutateUnit: (name, text) => name === "otid-web.service" ?
    `${text}ExecStartPost=/usr/bin/true\n` : text })), /UNIT_DIFFERS_FROM_RELEASE/u);
});

test("rejects writable or non-root release, unit, controller and private inputs", async () => {
  for (const target of [
    "/opt/o-tid", "/opt/o-tid/apps", "/opt/o-tid/ops/systemd/writer-start.sh", "/etc/systemd/system/otid-web.service",
    "/var/lib/o-tid/controller", "/etc/o-tid/writer-credentials/database-url",
    "/etc/o-tid/cli-requests/speaker-revoke.json"
  ]) {
    await assert.rejects(run(fixture({ mutateState: (path, state) => path === target ?
      { ...state, uid: 991, mode: state.mode | 0o020 } : state })));
  }
  await assert.rejects(run(fixture({ mutateState: (path, state) =>
    path === "/etc/o-tid/writer-credentials" ? { ...state, mode: 0o40750 } : state })),
  /PRIVATE_DIRECTORY_UNSAFE/u);
  await assert.rejects(run(fixture({ marker: file({ mode: 0o100644, size: 1 }) })), /MARKER_UNSAFE/u);
});
