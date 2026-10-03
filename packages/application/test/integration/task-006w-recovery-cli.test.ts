import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { StartCheckinRecoveryTokenSchema } from "@o-tid/contracts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

function run(args: string[], stdin = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/checkin-recovery.ts", ...args], {
      cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Synthetic CLI timeout")); }, 15_000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Synthetic CLI could not start")); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(stdin);
  });
}

it("issues through private stdin, stores no bearer secret, and safely retries a CLI revocation", async () => {
  const eventId = randomUUID(), raceId = randomUUID(), actorCredentialId = randomUUID(), deviceId = randomUUID();
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.insert(schema.events).values({ id: eventId, name: "Synthetic recovery CLI", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
    await tx.insert(schema.races).values({ id: raceId, eventId, name: "Synthetic", raceDate: "2026-09-05" });
    await tx.insert(schema.pairingAdminAccessCredentials).values({ id: actorCredentialId, raceId, capability: "START_CHECKIN", label: "Synthetic",
      secretHash: "a".repeat(64), issuedAt: new Date(now - 7_200_000), expiresAt: new Date(now - 3_600_000) });
    await tx.insert(schema.startCheckinDevices).values({ id: deviceId, raceId, actorCredentialId, capability: "START_CHECKIN", label: "Synthetic", registeredAt: new Date(now - 7_000_000) });
  });
  const manifest = { formatVersion: 1, kind: "OTID_CHECKIN_RECOVERY_MANIFEST", raceId, deviceId, actorCredentialId,
    capability: "START_CHECKIN", firstSequence: 1, lastSequence: 1,
    items: [{ requestId: randomUUID(), localSequence: 1, contentHash: "b".repeat(64) }] };
  const issued = await run(["issue", "--operator-label", "Synthetic operator", "--reason", "Expired synthetic credential",
    "--expires-at", new Date(now + 1_800_000).toISOString()], JSON.stringify(manifest));
  expect(issued.code).toBe(0); expect(issued.stderr).toBe("");
  const result = JSON.parse(issued.stdout) as { grantId: string; token: string };
  expect(StartCheckinRecoveryTokenSchema.safeParse(result.token).success).toBe(true);
  const [grant] = await db.select().from(schema.checkinRecoveryGrants).where(eq(schema.checkinRecoveryGrants.id, result.grantId));
  expect(grant).toBeDefined();
  expect(JSON.stringify(grant)).not.toContain(result.token.split(".")[2]);
  const args = ["revoke", "--grant-id", result.grantId, "--operator-label", "Synthetic operator", "--reason", "Synthetic test finished"];
  expect((await run(args)).code).toBe(0);
  expect((await run(args)).code).toBe(0);
  const changed = await run([...args.slice(0, -1), "Different intent"]);
  expect(changed.code).toBe(1); expect(changed.stdout).toBe("");
  expect(changed.stderr).toContain("Återhämtningsbeslutet kunde inte genomföras");
  expect(await db.select().from(schema.checkinRecoveryGrantRevocations).where(eq(schema.checkinRecoveryGrantRevocations.grantId, result.grantId))).toHaveLength(1);
}, 30_000);
