import { createHash, randomBytes, randomUUID } from "node:crypto";
import { accountInvitationCodeSchema, accountInvitationIssueInputSchema,
  accountInvitationRevokeInputSchema } from "../packages/contracts/src/account-invitation.ts";
import { createDatabase } from "../packages/database/src/index.ts";
import { accountInvitationStatus, issueAccountInvitation,
  revokeAccountInvitation } from "../packages/application/src/account-invitation.ts";
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
  if (nodeEnv === "production" && confirmation === "production-account-invitation") return connectionString;
  if ((nodeEnv === "test" || nodeEnv === "development") && connectionString === testUrl &&
    confirmation === "synthetic-test-database") {
    const url = new URL(connectionString);
    if ((url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      /^\/(?:otid_task159_|otid_test_)[a-z0-9][a-z0-9_-]*$/.test(url.pathname)) return connectionString;
  }
  throw new Error();
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function issueIntent(input: Record<string, unknown>, now: Date) {
  failureStage = "intent-shape";
  if (!exactKeys(input, ["loginName", "displayName", "operatorLabel"]) ||
    typeof input.loginName !== "string" || typeof input.displayName !== "string" ||
    typeof input.operatorLabel !== "string") throw new Error();
  const code = randomBytes(32).toString("base64url");
  const manifest = {
    formatVersion: 1 as const, requestId: randomUUID(),
    loginName: input.loginName.trim().toLowerCase(),
    displayName: input.displayName.trim(), operatorLabel: input.operatorLabel.trim(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), code
  };
  failureStage = "intent-schema";
  if (!accountInvitationCodeSchema.safeParse(code).success ||
    !accountInvitationIssueInputSchema.safeParse({
      formatVersion: manifest.formatVersion, requestId: manifest.requestId,
      loginName: manifest.loginName, displayName: manifest.displayName,
      operatorLabel: manifest.operatorLabel, expiresAt: manifest.expiresAt,
      codeHash: createHash("sha256").update(Buffer.from(code, "base64url")).digest("hex")
    }).success) throw new Error();
  return manifest;
}

function requestFromManifest(input: Record<string, unknown>) {
  if (!exactKeys(input, ["formatVersion", "requestId", "loginName", "displayName", "operatorLabel", "expiresAt", "code"]) ||
    !accountInvitationCodeSchema.safeParse(input.code).success) throw new Error();
  const code = input.code as string;
  if (Buffer.from(code, "base64url").toString("base64url") !== code) throw new Error();
  return accountInvitationIssueInputSchema.parse({
    formatVersion: input.formatVersion, requestId: input.requestId,
    loginName: input.loginName, displayName: input.displayName,
    operatorLabel: input.operatorLabel, expiresAt: input.expiresAt,
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

  failureStage = "database";
  const { db, pool } = createDatabase(connectionString);
  try {
    if (manifest) {
      const result = await issueAccountInvitation(db, requestFromManifest(manifest));
      if (result.status !== "issued") throw new Error();
      process.stdout.write(`${JSON.stringify({ status: "issued", ...result.response })}\n`);
    } else if (selected.action === "status") {
      if (!exactKeys(input, ["invitationId"]) || typeof input.invitationId !== "string") throw new Error();
      const result = await accountInvitationStatus(db, input.invitationId);
      if (result.status !== "ok") throw new Error();
      process.stdout.write(`${JSON.stringify({ invitationId: result.response.invitationId,
        status: result.response.status, expiresAt: result.response.expiresAt })}\n`);
    } else {
      const request = accountInvitationRevokeInputSchema.parse(input);
      const result = await revokeAccountInvitation(db, request);
      if (result.status !== "revoked") throw new Error();
      process.stdout.write(`${JSON.stringify(result.response)}\n`);
    }
  } finally { await pool.end(); }
}

main().catch(() => {
  process.stderr.write(`Kontoinbjudan kunde inte behandlas (${failureStage}). Kontrollera privat stdin, explicit vald databas och privat utfil. Bevara återförsöksfilen vid osäkert utfall.\n`);
  process.exitCode = 1;
});
