import { createDatabase } from "../packages/database/src/index.ts";
import { issuePairingAdminAccessCredential, revokePairingAdminAccessCredential } from "../packages/application/src/pairing-admin.ts";

function invalid(): never { throw new Error("Ogiltigt rättningskommando"); }
async function main(): Promise<void> {
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
  // An interactive terminal must not accidentally display the bearer credential.
  if (command === "issue" && process.stdout.isTTY) invalid();
  const intent = command === "issue" ? {
    command: "issue" as const, raceId: required("--race-id"), label: required("--label"),
    expiresAt: new Date(required("--expires-at"))
  } : { command: "revoke" as const, credentialId: required("--credential-id"), reason: values.get("--reason") };
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) invalid();
  const { db, pool } = createDatabase(connectionString);
  try {
    if (intent.command === "issue") {
      const result = await issuePairingAdminAccessCredential(db, { raceId: intent.raceId, label: intent.label,
        expiresAt: intent.expiresAt, capability: "CHANGE_ENTRY_IDENTITY" });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      const result = await revokePairingAdminAccessCredential(db, { credentialId: intent.credentialId,
        capability: "CHANGE_ENTRY_IDENTITY", ...(intent.reason ? { reason: intent.reason } : {}) });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } finally { await pool.end(); }
}
main().catch(() => {
  process.stderr.write("Rättningsbehörigheten kunde inte hanteras. Kontrollera argument, privat utdata och serverkonfiguration; vid okänt utfärdande kontrollera behörighetsjournalen före nytt försök.\n");
  process.exitCode = 1;
});
