import { createHash, randomBytes, randomUUID } from "node:crypto";
import { accountPasswordRecoveryCodeSchema, accountPasswordRecoveryIssueInputSchema,
  accountPasswordRecoveryRevokeInputSchema } from "../packages/contracts/src/account-password-recovery.ts";
import { createDatabase } from "../packages/database/src/index.ts";
import { accountPasswordRecoveryStatus, issueAccountPasswordRecovery,
  revokeAccountPasswordRecovery } from "../packages/application/src/account-password-recovery.ts";
import { readPrivateInput, reserveOrganizerPrivateOutput } from "./organizer-account.ts";

type Action = "issue" | "retry" | "status" | "revoke";
type Command = { action: Action; confirmation: string; outputPath?: string };
let failureStage = "arguments";

function command(args: readonly string[]): Command {
  const [action, ...flags] = args;
  if (action !== "issue" && action !== "retry" && action !== "status" && action !== "revoke") throw new Error();
  const values = new Map<string, string>();
  if (flags.length % 2 !== 0) throw new Error();
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index], value = flags[index + 1];
    if (!key || !value || !["--confirm", "--private-output"].includes(key) || values.has(key)) throw new Error();
    values.set(key, value);
  }
  if (values.size !== (action === "issue" ? 2 : 1) || !values.get("--confirm") ||
    (action === "issue") !== values.has("--private-output")) throw new Error();
  const outputPath = values.get("--private-output");
  return outputPath
    ? { action, confirmation: values.get("--confirm")!, outputPath }
    : { action, confirmation: values.get("--confirm")! };
}

function target(connectionString: string | undefined, testUrl: string | undefined,
  nodeEnv: string | undefined, confirmation: string): string {
  if (!connectionString) throw new Error();
  if (nodeEnv === "production" && confirmation === "production-account-password-recovery") return connectionString;
  if ((nodeEnv === "test" || nodeEnv === "development") && connectionString === testUrl &&
    confirmation === "synthetic-test-database") {
    try {
      const url = new URL(connectionString);
      if ((url.protocol === "postgres:" || url.protocol === "postgresql:") &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        /^\/(?:otid_task161_|otid_test_)[a-z0-9][a-z0-9_-]*$/.test(url.pathname)) return connectionString;
    } catch { /* rejected below */ }
  }
  throw new Error();
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function issueIntent(input: Record<string, unknown>, now: Date) {
  failureStage = "intent-shape";
  if (!exactKeys(input, ["accountId", "loginName", "operatorLabel", "reason"]) ||
    typeof input.accountId !== "string" || typeof input.loginName !== "string" ||
    typeof input.operatorLabel !== "string" || typeof input.reason !== "string") throw new Error();
  const code = randomBytes(32).toString("base64url");
  const manifest = {
    formatVersion: 1 as const, requestId: randomUUID(), accountId: input.accountId,
    loginName: input.loginName.trim().toLowerCase(), operatorLabel: input.operatorLabel.trim(),
    reason: input.reason.trim(), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), code
  };
  failureStage = "intent-schema";
  if (!accountPasswordRecoveryCodeSchema.safeParse(code).success ||
    !accountPasswordRecoveryIssueInputSchema.safeParse({
      formatVersion: manifest.formatVersion, requestId: manifest.requestId,
      accountId: manifest.accountId, loginName: manifest.loginName,
      operatorLabel: manifest.operatorLabel, reason: manifest.reason,
      expiresAt: manifest.expiresAt,
      codeHash: createHash("sha256").update(Buffer.from(code, "base64url")).digest("hex")
    }).success) throw new Error();
  return manifest;
}

function requestFromManifest(input: Record<string, unknown>) {
  if (!exactKeys(input, ["formatVersion", "requestId", "accountId", "loginName", "operatorLabel", "reason", "expiresAt", "code"]) ||
    !accountPasswordRecoveryCodeSchema.safeParse(input.code).success) throw new Error();
  const code = input.code as string;
  if (Buffer.from(code, "base64url").toString("base64url") !== code) throw new Error();
  return accountPasswordRecoveryIssueInputSchema.parse({
    formatVersion: input.formatVersion, requestId: input.requestId, accountId: input.accountId,
    loginName: input.loginName, operatorLabel: input.operatorLabel, reason: input.reason,
    expiresAt: input.expiresAt,
    codeHash: createHash("sha256").update(Buffer.from(code, "base64url")).digest("hex")
  });
}

async function main(): Promise<void> {
  const selected = command(process.argv.slice(2));
  failureStage = "target";
  const connectionString = target(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL,
    process.env.NODE_ENV, selected.confirmation);
  failureStage = "input";
  if (process.stdin.isTTY) throw new Error();
  const input = await readPrivateInput(process.stdin);
  let manifest: Record<string, unknown> | undefined;
  if (selected.action === "issue") {
    failureStage = "intent";
    manifest = issueIntent(input, new Date());
    failureStage = "private-file";
    const output = await reserveOrganizerPrivateOutput(selected.outputPath!);
    try { await output.write(manifest); }
    finally { await output.close(); }
  } else if (selected.action === "retry") manifest = input;

  failureStage = "intent-validation";
  const issueRequest = manifest ? requestFromManifest(manifest) : undefined;
  const statusId = selected.action === "status"
    ? (exactKeys(input, ["recoveryId"]) && typeof input.recoveryId === "string" ? input.recoveryId : (() => { throw new Error(); })())
    : undefined;
  const revokeRequest = selected.action === "revoke" ? accountPasswordRecoveryRevokeInputSchema.parse(input) : undefined;

  failureStage = "database";
  const { db, pool } = createDatabase(connectionString);
  try {
    if (manifest) {
      const result = await issueAccountPasswordRecovery(db, issueRequest);
      if (result.status !== "issued") throw new Error();
      process.stdout.write(`${JSON.stringify({ status: "issued", ...result.response })}\n`);
    } else if (selected.action === "status") {
      const result = await accountPasswordRecoveryStatus(db, statusId!);
      if (result.status !== "ok") throw new Error();
      process.stdout.write(`${JSON.stringify(result.response)}\n`);
    } else {
      const result = await revokeAccountPasswordRecovery(db, revokeRequest);
      if (result.status !== "revoked") throw new Error();
      process.stdout.write(`${JSON.stringify(result.response)}\n`);
    }
  } finally { await pool.end(); }
}

main().catch(() => {
  process.stderr.write(`Kontoåterställning kunde inte behandlas (${failureStage}). Kontrollera privat stdin, explicit vald databas och privat utfil. Bevara återförsöksfilen vid osäkert utfall.\n`);
  process.exitCode = 1;
});
