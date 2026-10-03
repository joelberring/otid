import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  checkWriterProfile,
  UNIT_DIRECTORY,
  WRITER_PROFILE_UNITS
} from "./check-writer-profile.mjs";

const execFile = promisify(execFileCallback);
const SYSTEMCTL = "/usr/bin/systemctl";
const SYSTEMD_MINIMUM_VERSION = 247;
const COMMAND_TIMEOUT_MS = 10_000;
const PROPERTY_NAMES = [
  "Names", "LoadState", "FragmentPath", "SourcePath", "DropInPaths", "NeedDaemonReload",
  "Transient", "User", "Group", "ExecStart", "Environment", "LoadCredential", "ActiveState",
  "SubState", "MainPID", "ControlGroup", "UnitFileState"
];

function assertCondition(value, code) {
  if (!value) throw new Error(code);
}

function parseProperties(text) {
  const result = new Map();
  assertCondition(typeof text === "string" && !text.includes("\0"), "LOADED_WRITER_PROFILE_OUTPUT_INVALID");
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    assertCondition(separator > 0, "LOADED_WRITER_PROFILE_OUTPUT_INVALID");
    const key = line.slice(0, separator);
    assertCondition(PROPERTY_NAMES.includes(key) && !result.has(key), "LOADED_WRITER_PROFILE_OUTPUT_INVALID");
    result.set(key, line.slice(separator + 1));
  }
  assertCondition(PROPERTY_NAMES.every((name) => result.has(name)), "LOADED_WRITER_PROFILE_OUTPUT_INVALID");
  return result;
}

function parseWords(text) {
  assertCondition(!/["'\\]/u.test(text), "LOADED_WRITER_PROFILE_OUTPUT_INVALID");
  return text === "" ? [] : text.split(/\s+/u);
}

function parseExecStart(text) {
  const match = /^\{ path=([^ ;{}]+) ; argv\[\]=([^{}]+?) ; ignore_errors=no ;[^{}]*\}$/u.exec(text);
  assertCondition(match, "LOADED_WRITER_PROFILE_EXEC_INVALID");
  const argv = parseWords(match[2]);
  assertCondition(argv[0] === match[1], "LOADED_WRITER_PROFILE_EXEC_INVALID");
  return argv.join(" ");
}

function parseInventory(text) {
  assertCondition(typeof text === "string" && !text.includes("\0"), "LOADED_WRITER_PROFILE_INVENTORY_INVALID");
  const names = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    assertCondition(line === line.trim() && !/["'\\]/u.test(line), "LOADED_WRITER_PROFILE_INVENTORY_INVALID");
    const columns = line.split(/\s+/u);
    assertCondition(columns.length >= 2 && /^otid-[A-Za-z0-9@_.-]+\.service$/u.test(columns[0]),
      "LOADED_WRITER_PROFILE_INVENTORY_INVALID");
    names.push(columns[0]);
  }
  assertCondition(new Set(names).size === names.length, "LOADED_WRITER_PROFILE_INVENTORY_INVALID");
  return [...new Set(names)].sort();
}

function parseEnvironment(text) {
  const entries = parseWords(text);
  const keys = entries.map((entry) => {
    const separator = entry.indexOf("=");
    assertCondition(separator > 0, "LOADED_WRITER_PROFILE_OUTPUT_INVALID");
    return entry.slice(0, separator);
  });
  assertCondition(new Set(keys).size === keys.length, "LOADED_WRITER_PROFILE_MARKER_INVALID");
  return new Map(entries.map((entry) => {
    const separator = entry.indexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
}

async function readCommand(runCommand, args) {
  let result;
  try {
    result = await runCommand(SYSTEMCTL, args);
  } catch {
    throw new Error("LOADED_WRITER_PROFILE_SYSTEMCTL_FAILED");
  }
  assertCondition(result && typeof result.stdout === "string" && result.stderr === "",
    "LOADED_WRITER_PROFILE_SYSTEMCTL_FAILED");
  return result.stdout;
}

async function defaultRunCommand(file, args) {
  return execFile(file, args, {
    encoding: "utf8",
    env: {
      LC_ALL: "C",
      PATH: "/usr/bin:/bin",
      SYSTEMD_COLORS: "0",
      SYSTEMD_URLIFY: "0"
    },
    maxBuffer: 1024 * 1024,
    timeout: COMMAND_TIMEOUT_MS
  });
}

function exactSet(actual, expected, code) {
  assertCondition(actual.length === new Set(actual).size &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), code);
}

/** Read-only manager preflight. Success is not activation, isolation, drain or stop acceptance. */
export async function checkLoadedWriterProfile({
  platform = process.platform,
  effectiveUid = process.geteuid?.(),
  diskPreflight = checkWriterProfile,
  runCommand = defaultRunCommand
} = {}) {
  assertCondition(platform === "linux" && effectiveUid === 0,
    "LOADED_WRITER_PROFILE_REQUIRES_LINUX_ROOT");
  await diskPreflight();

  const versionOutput = await readCommand(runCommand, ["show", "--property=Version", "--value"]);
  const versionMatch = /^(\d+)(?:[.~+-][^\n]*)?\n?$/u.exec(versionOutput);
  assertCondition(versionMatch && Number(versionMatch[1]) >= SYSTEMD_MINIMUM_VERSION,
    "LOADED_WRITER_PROFILE_SYSTEMD_UNSUPPORTED");

  const expectedNames = Object.keys(WRITER_PROFILE_UNITS).sort();
  const unitFiles = parseInventory(await readCommand(runCommand,
    ["list-unit-files", "--all", "--plain", "--no-legend", "--no-pager", "otid-*"]));
  const loadedUnits = parseInventory(await readCommand(runCommand,
    ["list-units", "--all", "--plain", "--no-legend", "--no-pager", "otid-*"]));
  exactSet(unitFiles, expectedNames, "LOADED_WRITER_PROFILE_UNIT_INVENTORY_INVALID");
  exactSet(loadedUnits, expectedNames, "LOADED_WRITER_PROFILE_UNIT_INVENTORY_INVALID");

  const states = [];
  for (const name of expectedNames) {
    const expected = WRITER_PROFILE_UNITS[name];
    const output = await readCommand(runCommand, [
      "show", "--all", "--no-pager", `--property=${PROPERTY_NAMES.join(",")}`, name
    ]);
    const properties = parseProperties(output);
    exactSet(parseWords(properties.get("Names")), [name], "LOADED_WRITER_PROFILE_ALIAS_INVALID");
    assertCondition(properties.get("LoadState") === "loaded" &&
      properties.get("FragmentPath") === `${UNIT_DIRECTORY}/${name}` &&
      properties.get("SourcePath") === "" && properties.get("DropInPaths") === "" &&
      properties.get("NeedDaemonReload") === "no" && properties.get("Transient") === "no",
    "LOADED_WRITER_PROFILE_PROVENANCE_INVALID");
    assertCondition(properties.get("User") === "otid-writer" && properties.get("Group") === "otid-writer",
      "LOADED_WRITER_PROFILE_IDENTITY_INVALID");
    assertCondition(parseExecStart(properties.get("ExecStart")) === expected.command,
      "LOADED_WRITER_PROFILE_EXEC_INVALID");
    const environment = parseEnvironment(properties.get("Environment"));
    assertCondition(environment.get("OTID_WRITER_STOP_PROFILE") === "systemd-v1" &&
      environment.get("OTID_WRITER_STOP_FILE") === "/var/lib/o-tid/controller/closed",
    "LOADED_WRITER_PROFILE_MARKER_INVALID");
    exactSet(parseWords(properties.get("LoadCredential")),
      Object.entries(expected.credentials).map(([credential, path]) => `${credential}:${path}`),
      "LOADED_WRITER_PROFILE_CREDENTIAL_SET_INVALID");
    assertCondition(/^[0-9]+$/u.test(properties.get("MainPID")), "LOADED_WRITER_PROFILE_STATE_INVALID");
    states.push({
      name,
      activeState: properties.get("ActiveState"),
      subState: properties.get("SubState"),
      mainPid: Number(properties.get("MainPID")),
      controlGroup: properties.get("ControlGroup"),
      unitFileState: properties.get("UnitFileState")
    });
  }

  await diskPreflight();
  return {
    profile: "systemd-v1",
    status: "LOADED_PROFILE_MATCHES_DISK_ONLY_NOT_ACCEPTED",
    units: states
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkLoadedWriterProfile().then(() => {
    process.stdout.write("LOADED_WRITER_PROFILE_PREFLIGHT_PASSED_ONLY; NOT_ACCEPTED\n");
  }).catch(() => {
    process.stderr.write("LOADED_WRITER_PROFILE_PREFLIGHT_FAILED; NOT_ACCEPTED\n");
    process.exitCode = 1;
  });
}
