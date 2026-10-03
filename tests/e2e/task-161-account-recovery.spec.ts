import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { createDatabase } from "@o-tid/database";
import { issueAccountPasswordRecovery, provisionUserAccount } from "@o-tid/application";

const sourceUrl = process.env.TEST_DATABASE_URL;
const targetUrl = process.env.OTID_TASK161_E2E_TARGET_URL;
if (!sourceUrl || !targetUrl) throw new Error("TASK161-testdatabas saknas");
const targetName = new URL(targetUrl).pathname.slice(1);
if (!/^otid_task161_e2e_[a-f0-9]{32}$/.test(targetName)) throw new Error("Ogiltig måldatabas");
const admin = createDatabase(sourceUrl);
const { db, pool } = createDatabase(targetUrl);
let created = false;

test.beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${targetName}"`);
  created = true;
  const root = resolve();
  await promisify(execFile)(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"),
    join(root, "packages/database/src/migrate.ts")], {
    cwd: root, env: { ...process.env, DATABASE_URL: targetUrl }
  });
});

test.afterAll(async () => {
  await pool.end();
  try {
    if (created) {
      let dropped = false;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const sessions = await admin.pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1", [targetName]);
        if (Number(sessions.rows[0]?.count) === 0) {
          await admin.pool.query(`DROP DATABASE "${targetName}"`);
          dropped = true;
          break;
        }
        await delay(100);
      }
      if (!dropped) throw new Error("Testdatabasen har aktiva anslutningar och bevaras för manuell granskning");
    }
  } finally { await admin.pool.end(); }
});

test("TASK161 återställer befintligt konto och kräver vanlig inloggning på 390px", async ({ page }) => {
  const loginName = `recovery.${randomUUID().slice(0, 8)}`;
  const account = await provisionUserAccount(db, { loginName, displayName: "Syntetiskt recoverykonto" });
  const code = randomBytes(32);
  const now = new Date();
  const issued = await issueAccountPasswordRecovery(db, {
    formatVersion: 1,
    requestId: randomUUID(),
    accountId: account.accountId,
    loginName,
    operatorLabel: "TASK161 syntetisk operatör",
    reason: "Syntetiskt browserprov",
    codeHash: createHash("sha256").update(code).digest("hex"),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  }, now);
  expect(issued.status).toBe("issued");
  if (issued.status !== "issued") throw new Error("Syntetisk recoverykod kunde inte utfärdas");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/recover");
  await expect(page.getByRole("heading", { name: "Återställ lösenord", exact: true })).toBeVisible();
  await page.getByLabel("Användarnamn", { exact: true }).fill(loginName);
  await page.getByLabel("Engångskod", { exact: true }).fill(code.toString("base64url"));
  await page.getByRole("button", { name: "Skapa nytt lösenord", exact: true }).click();
  const password = await page.getByLabel("Ditt nya lösenord", { exact: true }).textContent();
  expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole("button", { name: "Återställ lösenord", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate((secrets) => [localStorage, sessionStorage].some((storage) => {
    for (let index = 0; index < storage.length; index += 1) {
      const value = storage.getItem(storage.key(index) ?? "") ?? "";
      if (secrets.some((secret) => value.includes(secret))) return true;
    }
    return false;
  }), [code.toString("base64url"), password!])).toBe(false);

  await page.getByRole("checkbox", { name: "Jag har sparat eller kopierat lösenordet och kan komma åt det efter återställningen." }).check();
  const [recoveryResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/account/recovery") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Återställ lösenord", exact: true }).click()
  ]);
  expect(recoveryResponse.status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Lösenordet är återställt", exact: true })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);

  await page.getByRole("link", { name: "Logga in som arrangör", exact: true }).click();
  await page.getByLabel("Inloggningsnamn", { exact: true }).fill(loginName);
  await page.getByLabel("Lösenord", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByText("Dina tävlingar", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
