import { createDatabase } from "../packages/database/src/index.ts";
import {
  issuePairingAdminAccessCredential,
  revokePairingAdminAccessCredential
} from "../packages/application/src/index.ts";

function usage(): never {
  throw new Error([
    "Användning:",
    "  pairing:admin:access:issue --race-id <uuid> --label <text> --expires-at <ISO>",
    "  pairing:admin:access:revoke --credential-id <uuid> [--reason <text>]"
  ].join("\n"));
}

function argument(name: string, args: string[], required = true): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) usage();
  return value && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2).filter((value) => value !== "--");
  if (!command || command === "--help" || command === "-h") usage();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL måste anges");
  const { db, pool } = createDatabase(connectionString);
  try {
    if (command === "issue") {
      const expiresAt = new Date(argument("--expires-at", args)!);
      if (!Number.isFinite(expiresAt.getTime())) throw new Error("--expires-at måste vara en giltig ISO-tidpunkt");
      const result = await issuePairingAdminAccessCredential(db, {
        raceId: argument("--race-id", args)!, capability: "PAIR_STATION",
        label: argument("--label", args)!, expiresAt
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (command === "revoke") {
      const reason = argument("--reason", args, false);
      const result = await revokePairingAdminAccessCredential(db, {
        credentialId: argument("--credential-id", args)!, capability: "PAIR_STATION",
        ...(reason ? { reason } : {})
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    usage();
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Admincredential-kommandot misslyckades"}\n`);
  process.exitCode = 1;
});
