import { createDatabase } from "../packages/database/src/index.ts";
import { issuePairingAdminAccessCredential, revokePairingAdminAccessCredential } from "../packages/application/src/pairing-admin.ts";

function invalid(): never { throw new Error("Ogiltigt administratörskommando"); }
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "issue" && command !== "revoke") invalid();
  const allowed = command === "issue" ? ["--race-id", "--label", "--expires-at"] : ["--credential-id", "--reason"];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !allowed.includes(key) || values.has(key) || !value || value.startsWith("--")) invalid();
    values.set(key, value);
  }
  const required = (key: string) => { const value = values.get(key); if (!value) invalid(); return value; };
  if (command === "issue" && process.stdout.isTTY) invalid();
  const intent = command === "issue" ? { command: "issue" as const, raceId: required("--race-id"),
    label: required("--label"), expiresAt: new Date(required("--expires-at")) } :
    { command: "revoke" as const, credentialId: required("--credential-id"), reason: values.get("--reason") };
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) invalid();
  const { db, pool } = createDatabase(connectionString);
  try {
    const result = intent.command === "issue" ? await issuePairingAdminAccessCredential(db, {
      raceId: intent.raceId, label: intent.label, expiresAt: intent.expiresAt, capability: "MANAGE_RACE"
    }) : await revokePairingAdminAccessCredential(db, { credentialId: intent.credentialId,
      capability: "MANAGE_RACE", ...(intent.reason ? { reason: intent.reason } : {}) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await pool.end(); }
}
main().catch(() => {
  process.stderr.write("Administratörsbehörigheten kunde inte hanteras. Kontrollera argument och servermiljö; vid osäkert utfärdande kontrollera journalen före nytt försök.\n");
  process.exitCode = 1;
});
