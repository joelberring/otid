import { createDatabase } from "../packages/database/src/index.ts";
import { issueCheckinRecoveryGrant, revokeCheckinRecoveryGrant } from "../packages/application/src/checkin-recovery-grants.ts";
import { parseCheckinRecoveryCliArguments, readCheckinRecoveryManifestInput } from "../packages/application/src/checkin-recovery-cli-input.ts";

async function main(): Promise<void> {
  const args = parseCheckinRecoveryCliArguments(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_REQUIRED");
  // An issuance result contains a bearer secret. Require intentional private redirection.
  if (args.command === "issue" && (process.stdin.isTTY || process.stdout.isTTY)) throw new Error("PRIVATE_REDIRECTION_REQUIRED");
  const manifest = args.command === "issue" ? await readCheckinRecoveryManifestInput(process.stdin) : undefined;
  const { db, pool } = createDatabase(connectionString);
  try {
    const result = args.command === "issue"
      ? await issueCheckinRecoveryGrant(db, { manifest, operatorLabel: args.operatorLabel, reason: args.reason, expiresAt: args.expiresAt })
      : await revokeCheckinRecoveryGrant(db, { grantId: args.grantId, operatorLabel: args.operatorLabel, reason: args.reason });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write("Återhämtningsbeslutet kunde inte genomföras. Kontrollera argument, privat stdin/utdata, databas och ursprungsbehörighet. Inga felvärden skrivs ut.\n");
  process.exitCode = 1;
});
