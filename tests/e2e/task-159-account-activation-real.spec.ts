import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { createDatabase } from "@o-tid/database";
import { issueAccountInvitation } from "@o-tid/application";

const sourceUrl = process.env.TEST_DATABASE_URL;
const targetUrl = process.env.OTID_TASK159_E2E_TARGET_URL;
if (!sourceUrl || !targetUrl) throw new Error("TASK159-testdatabas saknas");
const targetName = new URL(targetUrl).pathname.slice(1);
if (!/^otid_task159_e2e_[a-f0-9]{32}$/.test(targetName)) throw new Error("Ogiltig måldatabas");
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
      for (let attempt = 0; attempt < 150; attempt++) {
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

test("TASK159 syntetisk inbjudan → mobilaktivering → vanlig inloggning", async ({ page }) => {
  const loginName = `browser.${randomUUID().slice(0, 8)}`;
  const codeBytes = randomBytes(32);
  const code = codeBytes.toString("base64url");
  const now = new Date();
  const issued = await issueAccountInvitation(db, {
    formatVersion: 1, requestId: randomUUID(), loginName, displayName: "Syntetisk deltagare",
    operatorLabel: "Browserprov", codeHash: createHash("sha256").update(codeBytes).digest("hex"),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  }, now);
  expect(issued.status).toBe("issued");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/activate");
  await page.getByLabel("Användarnamn").fill(loginName);
  await page.getByLabel("Engångskod").fill(code);
  await page.getByRole("button", { name: "Skapa mitt lösenord" }).click();
  const password = await page.getByLabel("Ditt nya lösenord").textContent();
  expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole("button", { name: "Aktivera konto" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Jag har sparat eller kopierat lösenordet/ }).check();
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith("/api/account/activation") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Aktivera konto" }).click()
  ]);
  expect(response.status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Kontot är aktiverat" })).toBeVisible();
  await page.getByRole("link", { name: "Logga in som arrangör" }).click();
  await page.getByLabel("Inloggningsnamn", { exact: true }).fill(loginName);
  await page.getByLabel("Lösenord", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page.getByText("Dina tävlingar", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
