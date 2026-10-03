import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

// Reviewed source inventory, not a production allowlist. No scripts/*.ts CLI
// may receive the installation writer credential until it has a private,
// fixed-command systemd start and an audited stdout/stderr destination.
const databaseScripts = [
  "account-invitation-access.ts", "account-password-recovery-access.ts",
  "checkin-recovery.ts", "class-start-draw-access.ts", "demo-provision.ts",
  "did-not-finish-access.ts", "did-not-finish-withdrawal-access.ts",
  "did-not-start-access.ts", "did-not-start-withdrawal-access.ts",
  "entry-card-access.ts", "entry-class-access.ts", "entry-identity-access.ts",
  "entry-registration-access.ts", "entry-start-time-access.ts",
  "event-creation-access.ts", "eventor-connection.ts",
  "eventor-entry-import-grant.ts", "iof-import-access.ts",
  "iof-result-list-export-access.ts", "organizer-account-access.ts",
  "out-of-competition-access.ts", "out-of-competition-withdrawal-access.ts",
  "pairing-admin-access.ts", "race-administrator-access.ts",
  "race-overview-access.ts", "readout-result-history-access.ts",
  "result-approval-access.ts", "result-approval-withdrawal-access.ts",
  "result-disqualification-access.ts", "result-disqualification-withdrawal-access.ts",
  "result-finalization-access.ts", "result-recalculation-access.ts",
  "speaker-board-access.ts", "speaker-systemd-revoke.ts", "start-list-access.ts",
  "start-list-publication-access.ts", "station-credential.ts",
  "station-pairing.ts", "without-timing-access.ts",
  "without-timing-withdrawal-access.ts"
].sort();

const repository = new URL("../../", import.meta.url);
const source = new URL("scripts/", repository);
const units = new URL("ops/systemd/", repository);
const text = (path) => readFile(new URL(path, repository), "utf8");

test("direct createDatabase CLI sources and their commands are inventoried", async () => {
  const filenames = (await readdir(source)).filter((name) => name.endsWith(".ts"));
  const discovered = (await Promise.all(filenames.map(async (name) =>
    (await readFile(new URL(name, source), "utf8")).includes("createDatabase(") ? name : null)))
    .filter(Boolean).sort();
  assert.deepEqual(discovered, databaseScripts);

  const packageJson = JSON.parse(await text("package.json"));
  const cliCommands = Object.values(packageJson.scripts).filter((command) => /^(?:tsx|node --import tsx) scripts\//.test(command));
  assert.equal(cliCommands.length, 77);
  const declared = new Set(cliCommands.flatMap((command) => {
    const match = /^(?:tsx|node --import tsx) scripts\/([a-z0-9-]+\.ts)(?:\s|$)/.exec(command);
    return match ? [match[1]] : [];
  }));
  for (const name of databaseScripts) assert.ok(declared.has(name), `${name} saknar deklarerad CLI-start`);
  assert.equal(declared.size, 41);
  assert.ok(declared.has("demo-access-copy.ts"));
  assert.equal(packageJson.scripts["speaker:access:revoke:systemd"], "node --import tsx scripts/speaker-systemd-revoke.ts");
  assert.equal(packageJson.scripts["db:seed"], "pnpm --filter @o-tid/application seed");
  assert.match(await text("packages/application/src/seed.ts"), /createDatabase\(/);
});

test("only inventoried fixed commands have example units, pinned to the same closed marker", async () => {
  const names = (await readdir(units)).filter((name) => name.endsWith(".service.example")).sort();
  assert.deepEqual(names, ["otid-db-migrate.service.example", "otid-speaker-revoke.service.example", "otid-web.service.example"]);
  for (const name of names) {
    const unit = await readFile(new URL(name, units), "utf8");
    assert.match(unit, /^Environment=OTID_WRITER_STOP_PROFILE=systemd-v1$/m);
    assert.match(unit, /^Environment=OTID_WRITER_STOP_FILE=\/var\/lib\/o-tid\/controller\/closed$/m);
    assert.match(unit, /^LoadCredential=database-url:/m);
    const command = name === "otid-web.service.example" ?
      "/usr/bin/node /opt/o-tid/apps/web/.next/standalone/apps/web/server.js" :
      name === "otid-db-migrate.service.example" ? "/usr/bin/pnpm --filter @o-tid/database migrate" :
        "/usr/bin/pnpm --silent speaker:access:revoke:systemd";
    assert.ok(unit.split("\n").includes(`ExecStart=/bin/sh /opt/o-tid/ops/systemd/writer-start.sh ${command}`));
    if (name === "otid-speaker-revoke.service.example") {
      assert.ok(unit.split("\n").includes("LoadCredential=speaker-revoke-request:/etc/o-tid/cli-requests/speaker-revoke.json"));
      assert.match(unit, /^StateDirectory=o-tid-private-cli-results$/m);
      assert.match(unit, /^StateDirectoryMode=0700$/m);
      assert.match(unit, /^StandardOutput=null$/m);
      assert.match(unit, /^StandardError=null$/m);
      assert.doesNotMatch(unit, /^Restart=/m);
      assert.doesNotMatch(unit, /^EnvironmentFile=/m);
    }
  }
});

test("disposable admission probe cannot be mistaken for an installed production writer", async () => {
  const fixture = await text("ops/systemd/fixtures/otid-admission-probe.service");
  assert.match(fixture, /^AssertPathExists=\/run\/o-tid-admission-probe\/CONFIRMED_DISPOSABLE$/m);
  assert.match(fixture, /^User=otid-writer$/m);
  assert.match(fixture, /^Environment=OTID_WRITER_STOP_PROFILE=systemd-v1$/m);
  assert.match(fixture, /^Environment=OTID_WRITER_STOP_FILE=\/var\/lib\/o-tid\/controller\/closed$/m);
  assert.match(fixture, /^LoadCredential=database-url:\/run\/o-tid-admission-probe\/database-url$/m);
  assert.match(fixture, /^ExecStart=\/bin\/sh \/opt\/o-tid\/ops\/systemd\/writer-start\.sh \/usr\/bin\/true$/m);
  assert.match(fixture, /^StandardOutput=null$/m);
  assert.match(fixture, /^StandardError=null$/m);
  assert.doesNotMatch(fixture, /^WantedBy=|^Restart=|\/etc\/o-tid\/writer-credentials\//m);
});
