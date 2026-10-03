import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { dirname } from "node:path";
import test from "node:test";
import { CONFIRMATION, installWriterProfile, MARKER, UNIT_DIRECTORY } from "./install-writer-profile.mjs";

const units = ["otid-db-migrate.service", "otid-speaker-revoke.service", "otid-web.service"];
const privateInputs = [
  "database-url", "eventor-master-key-base64", "eventor-master-key-id", "map-store-access-key",
  "map-store-secret-key", "package-signing-private-key-pem", "route-store-access-key",
  "route-store-secret-key"
].map((name) => `/etc/o-tid/writer-credentials/${name}`)
  .concat("/etc/o-tid/cli-requests/speaker-revoke.json");
const templates = Object.fromEntries(units.map((name) =>
  [`/opt/o-tid/ops/systemd/${name}.example`, Buffer.from(`[Unit]\nDescription=${name}\n`)]));
const releaseStartFiles = [
  "/opt/o-tid/ops/systemd/writer-start.sh",
  "/opt/o-tid/ops/systemd/check-writer-start.mjs",
  "/opt/o-tid/apps/web/.next/standalone/apps/web/server.js"
];
const config = [
  "OTID_MAP_STORE_ID=10000000-0000-4000-8000-000000000001",
  "OTID_MAP_STORE_ENDPOINT=https://objects.example",
  "OTID_MAP_STORE_BUCKET=otid-maps",
  "OTID_MAP_STORE_REGION=eu-north-1",
  "OTID_MAP_STORE_MODE=production",
  "OTID_ROUTE_STORE_ID=10000000-0000-4000-8000-000000000002",
  "OTID_ROUTE_STORE_ENDPOINT=https://objects.example",
  "OTID_ROUTE_STORE_BUCKET=otid-routes",
  "OTID_ROUTE_STORE_REGION=eu-north-1",
  "OTID_ROUTE_STORE_MODE=production",
  "O_TID_PUBLIC_ORIGIN=https://otid.example"
].join("\n") + "\n";

function file(ino, overrides = {}) {
  return { uid: 0, mode: 0o100400, nlink: 1, size: 8, dev: 1, ino,
    isFile: () => true, isDirectory: () => false, ...overrides };
}
function directory(ino, overrides = {}) {
  return { uid: 0, mode: 0o40755, nlink: 2, size: 0, dev: 1, ino,
    isFile: () => false, isDirectory: () => true, ...overrides };
}

function fixture({ installed = [], changed, failLinkAt, removeMarkerAtLink } = {}) {
  let ino = 10;
  let links = 0;
  const states = new Map([["/", directory(1)]]);
  const contents = new Map(Object.entries(templates));
  for (const path of releaseStartFiles) contents.set(path, Buffer.from("start\n"));
  contents.set("/etc/o-tid/writer-config", Buffer.from(config));
  for (const path of [...Object.keys(templates), ...releaseStartFiles,
    ...privateInputs, "/etc/o-tid/writer-config", MARKER]) {
    for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) {
      if (!states.has(parent)) states.set(parent, directory(ino++));
    }
  }
  states.set("/etc/systemd", directory(ino++));
  states.set(UNIT_DIRECTORY, directory(ino++));
  for (const path of Object.keys(templates)) states.set(path, file(ino++));
  for (const path of releaseStartFiles) states.set(path, file(ino++));
  states.get("/etc/o-tid/writer-credentials").mode = 0o40700;
  states.get("/etc/o-tid/cli-requests").mode = 0o40700;
  for (const path of privateInputs) states.set(path, file(ino++, { mode: 0o100400, size: 12 }));
  states.set("/etc/o-tid/writer-config", file(ino++, { mode: 0o100644, size: config.length }));
  states.set(MARKER, file(ino++, { mode: 0o100600, size: 0 }));
  for (const name of installed) {
    const destination = `${UNIT_DIRECTORY}/${name}`;
    const bytes = changed === name ? Buffer.from("changed\n") : templates[`/opt/o-tid/ops/systemd/${name}.example`];
    states.set(destination, file(ino++, { mode: 0o100644, size: bytes.length }));
    contents.set(destination, bytes);
  }
  const reads = [];
  const io = {
    lstat: async (path) => {
      if (!states.has(path)) { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
      return states.get(path);
    },
    readFile: async (path, encoding) => {
      reads.push(path);
      const value = contents.get(path);
      if (value === undefined) throw new Error(`unexpected read ${path}`);
      return encoding ? value.toString(encoding) : Buffer.from(value);
    },
    readdir: async (path) => [...states.keys()].filter((entry) => dirname(entry) === path).map((entry) => entry.split("/").at(-1)),
    open: async (path, flags, mode) => {
      if (path === UNIT_DIRECTORY) return { stat: async () => states.get(path), sync: async () => {}, close: async () => {} };
      if (states.has(path)) { const error = new Error("exists"); error.code = "EEXIST"; throw error; }
      const state = file(ino++, { mode: 0o100000 | mode, size: 0 });
      states.set(path, state); contents.set(path, Buffer.alloc(0));
      return {
        writeFile: async (bytes) => { const value = Buffer.from(bytes); contents.set(path, value); state.size = value.length; },
        chmod: async (newMode) => { state.mode = 0o100000 | newMode; }, sync: async () => {}, close: async () => {}
      };
    },
    link: async (source, destination) => {
      links += 1;
      if (links === removeMarkerAtLink) states.delete(MARKER);
      if (links === failLinkAt) throw new Error("synthetic link failure");
      if (states.has(destination)) { const error = new Error("exists"); error.code = "EEXIST"; throw error; }
      const state = states.get(source); state.nlink += 1; states.set(destination, state); contents.set(destination, contents.get(source));
    },
    unlink: async (path) => { const state = states.get(path); state.nlink -= 1; states.delete(path); contents.delete(path); }
  };
  return { io, reads, states, contents };
}

const run = (fixtureValue, overrides = {}) => installWriterProfile({
  confirmation: CONFIRMATION, platform: "linux", effectiveUid: 0, io: fixtureValue.io,
  lookupUser: async () => ({ uid: 991, gid: 991 }), ...overrides
});

test("requires the exact confirmation, Linux root and non-root writer identity", async () => {
  await assert.rejects(installWriterProfile({ confirmation: "yes" }), /CONFIRMATION_REQUIRED/u);
  await assert.rejects(run(fixture(), { platform: "darwin" }), /REQUIRES_LINUX_ROOT/u);
  await assert.rejects(run(fixture(), { effectiveUid: 501 }), /REQUIRES_LINUX_ROOT/u);
  await assert.rejects(run(fixture(), { lookupUser: async () => ({ uid: 0, gid: 0 }) }), /IDENTITY_INVALID/u);
});

test("installs only the three fixed templates while the valid marker remains closed", async () => {
  const value = fixture();
  assert.equal((await run(value)).status, "INSTALLED_NO_ACTIVATION_ACTION");
  for (const name of units) {
    assert.deepEqual(value.contents.get(`${UNIT_DIRECTORY}/${name}`), templates[`/opt/o-tid/ops/systemd/${name}.example`]);
  }
  assert.ok(value.states.has(MARKER));
  assert.equal(value.reads.some((path) => privateInputs.includes(path)), false);
});

test("is idempotent only for a complete byte-identical installation", async () => {
  assert.equal((await run(fixture({ installed: units }))).status, "ALREADY_INSTALLED_NO_ACTIVATION_ACTION");
  await assert.rejects(run(fixture({ installed: units.slice(0, 1) })), /PARTIAL_OR_EXTRA_INSTALL/u);
  await assert.rejects(run(fixture({ installed: units, changed: units[0] })), /INSTALLED_UNIT_CHANGED/u);
  const extra = fixture({ installed: units });
  extra.states.set(`${UNIT_DIRECTORY}/otid-worker.service`, file(999));
  await assert.rejects(run(extra), /PARTIAL_OR_EXTRA_INSTALL/u);
});

test("requires closed marker and rejects unsafe private inputs or config injection", async () => {
  const open = fixture(); open.states.delete(MARKER);
  await assert.rejects(run(open), /CLOSED_MARKER_REQUIRED/u);
  const unsafe = fixture(); unsafe.states.get(privateInputs[0]).mode = 0o100440;
  await assert.rejects(run(unsafe), /PRIVATE_INPUT_UNSAFE/u);
  const exposedDirectory = fixture(); exposedDirectory.states.get("/etc/o-tid/writer-credentials").mode = 0o40750;
  await assert.rejects(run(exposedDirectory), /PRIVATE_DIRECTORY_UNSAFE/u);
  const injected = fixture(); injected.contents.set("/etc/o-tid/writer-config", Buffer.from("NODE_OPTIONS=--require=/tmp/x\n"));
  await assert.rejects(run(injected), /CONFIG_INVALID/u);
  const inline = fixture(); inline.contents.set("/etc/o-tid/writer-config", Buffer.from(config.replace(
    "OTID_MAP_STORE_ENDPOINT=https://objects.example", "OTID_MAP_STORE_ENDPOINT=https://objects.example;X=Y")));
  await assert.rejects(run(inline), /CONFIG_INVALID/u);
  const missing = fixture(); missing.contents.set("/etc/o-tid/writer-config", Buffer.from(config.replace(
    "OTID_ROUTE_STORE_MODE=production\n", "")));
  await assert.rejects(run(missing), /CONFIG_INVALID/u);
  const release = fixture(); release.states.delete(releaseStartFiles[0]);
  await assert.rejects(run(release), /RELEASE_START_UNSAFE/u);
});

test("leaves a visible partial installation after a mid-install failure", async () => {
  const value = fixture({ failLinkAt: 2 });
  await assert.rejects(run(value), /synthetic link failure/u);
  assert.ok(value.states.has(`${UNIT_DIRECTORY}/${units[0]}`));
  assert.equal(value.states.has(`${UNIT_DIRECTORY}/${units[1]}`), false);
  assert.ok(value.states.has(MARKER));
  await assert.rejects(run(value), /PARTIAL_OR_EXTRA_INSTALL/u);
});

test("rejects a stale temporary file and detects a changed marker during installation", async () => {
  const stale = fixture();
  stale.states.set(`${UNIT_DIRECTORY}/.${units[0]}.otid-installing`, file(999));
  await assert.rejects(run(stale), /PARTIAL_OR_EXTRA_INSTALL/u);
  const removed = fixture({ removeMarkerAtLink: 1 });
  await assert.rejects(run(removed), /CLOSED_MARKER_CHANGED/u);
  assert.ok(removed.states.has(`${UNIT_DIRECTORY}/${units[0]}`));
  assert.equal(removed.states.has(`${UNIT_DIRECTORY}/${units[1]}`), false);
});
