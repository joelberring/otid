import assert from "node:assert/strict";
import test from "node:test";
import { checkLoadedWriterProfile } from "./check-loaded-writer-profile.mjs";
import { WRITER_PROFILE_UNITS } from "./check-writer-profile.mjs";

const names = Object.keys(WRITER_PROFILE_UNITS).sort();
const propertyNames = ["Names", "LoadState", "FragmentPath", "SourcePath", "DropInPaths",
  "NeedDaemonReload", "Transient", "User", "Group", "ExecStart", "Environment", "LoadCredential",
  "ActiveState", "SubState", "MainPID", "ControlGroup", "UnitFileState"];

function properties(name, overrides = {}) {
  const unit = WRITER_PROFILE_UNITS[name];
  const values = {
    Names: name,
    LoadState: "loaded",
    FragmentPath: `/etc/systemd/system/${name}`,
    SourcePath: "",
    DropInPaths: "",
    NeedDaemonReload: "no",
    Transient: "no",
    User: "otid-writer",
    Group: "otid-writer",
    ExecStart: `{ path=${unit.command.split(" ")[0]} ; argv[]=${unit.command} ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }`,
    Environment: "PATH=/usr/bin:/bin OTID_WRITER_STOP_PROFILE=systemd-v1 OTID_WRITER_STOP_FILE=/var/lib/o-tid/controller/closed",
    LoadCredential: Object.entries(unit.credentials).map(([key, path]) => `${key}:${path}`).join(" "),
    ActiveState: "inactive",
    SubState: "dead",
    MainPID: "0",
    ControlGroup: "",
    UnitFileState: name === "otid-web.service" ? "disabled" : "static",
    ...overrides
  };
  return `${propertyNames.map((key) => `${key}=${values[key]}`).join("\n")}\n`;
}

function fixture({ unitOverride, inventory = names, stderr = "" } = {}) {
  const calls = [];
  const runCommand = async (file, args) => {
    calls.push([file, args]);
    if (args[0] === "show" && args.at(-1) === "--value") return { stdout: "252\n", stderr };
    if (args[0] === "list-unit-files") {
      return { stdout: inventory.map((name) => `${name} disabled enabled`).join("\n") + "\n", stderr };
    }
    if (args[0] === "list-units") {
      return { stdout: inventory.map((name) => `${name} loaded inactive dead example`).join("\n") + "\n", stderr };
    }
    const name = args.at(-1);
    return { stdout: properties(name, unitOverride?.(name) ?? {}), stderr };
  };
  return { calls, runCommand };
}

function run(options = {}) {
  const diskCalls = [];
  const prepared = fixture(options);
  return {
    ...prepared,
    diskCalls,
    promise: checkLoadedWriterProfile({
      platform: "linux",
      effectiveUid: 0,
      diskPreflight: async () => { diskCalls.push(true); },
      runCommand: prepared.runCommand
    })
  };
}

test("accepts the exact loaded profile and brackets manager reads with disk preflight", async () => {
  const attempt = run();
  const result = await attempt.promise;
  assert.equal(result.status, "LOADED_PROFILE_MATCHES_DISK_ONLY_NOT_ACCEPTED");
  assert.deepEqual(result.units.map(({ name }) => name), names);
  assert.equal(attempt.diskCalls.length, 2);
  assert.ok(attempt.calls.every(([file]) => file === "/usr/bin/systemctl"));
  assert.deepEqual(attempt.calls.map(([, args]) => args[0]),
    ["show", "list-unit-files", "list-units", "show", "show", "show"]);
});

test("fails closed for stale, drop-in, alias and transient manager state", async () => {
  for (const change of [
    { NeedDaemonReload: "yes" },
    { DropInPaths: "/etc/systemd/system/otid-web.service.d/override.conf" },
    { Names: "otid-web.service web-alias.service" },
    { Transient: "yes" }
  ]) {
    await assert.rejects(run({ unitOverride: (name) => name === "otid-web.service" ? change : {} }).promise);
  }
});

test("rejects extra or missing O-Tid inventory", async () => {
  await assert.rejects(run({ inventory: [...names, "otid-worker.service"] }).promise,
    /UNIT_INVENTORY_INVALID/u);
  await assert.rejects(run({ inventory: [...names, "otid-worker.timer"] }).promise,
    /INVENTORY_INVALID/u);
  await assert.rejects(run({ inventory: names.slice(1) }).promise, /UNIT_INVENTORY_INVALID/u);
  await assert.rejects(run({ inventory: [...names, names[0]] }).promise, /INVENTORY_INVALID/u);
});

test("rejects changed identity, command, marker and credential source", async () => {
  const web = WRITER_PROFILE_UNITS["otid-web.service"];
  for (const change of [
    { User: "root" },
    { ExecStart: "{ path=/usr/bin/true ; argv[]=/usr/bin/true ; ignore_errors=no ; }" },
    { ExecStart: `{ path=/bin/sh ; argv[]=${web.command} ; ignore_errors=no ; } ` +
      "{ path=/usr/bin/true ; argv[]=/usr/bin/true ; ignore_errors=no ; }" },
    { Environment: "OTID_WRITER_STOP_PROFILE=systemd-v1 OTID_WRITER_STOP_FILE=/tmp/closed" },
    { Environment: "OTID_WRITER_STOP_PROFILE=systemd-v1 OTID_WRITER_STOP_FILE=/var/lib/o-tid/controller/closed " +
      "OTID_WRITER_STOP_FILE=/tmp/closed" },
    { LoadCredential: Object.entries(web.credentials).map(([key, path]) =>
      `${key}:${key === "database-url" ? "/tmp/database-url" : path}`).join(" ") }
  ]) {
    await assert.rejects(run({ unitOverride: (name) => name === "otid-web.service" ? change : {} }).promise);
  }
});

test("rejects unsupported, failed or ambiguous systemctl output without exposing it", async () => {
  await assert.rejects(checkLoadedWriterProfile({
    platform: "linux", effectiveUid: 0, diskPreflight: async () => {},
    runCommand: async () => ({ stdout: "246\n", stderr: "" })
  }), /SYSTEMD_UNSUPPORTED/u);
  await assert.rejects(run({ stderr: "warning containing private manager details" }).promise,
    (error) => error.message === "LOADED_WRITER_PROFILE_SYSTEMCTL_FAILED");
  await assert.rejects(run({ unitOverride: (name) => name === "otid-web.service" ?
    { MainPID: "unknown" } : {} }).promise, /STATE_INVALID/u);
});
