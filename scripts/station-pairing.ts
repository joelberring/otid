import { createDatabase } from "../packages/database/src/index.ts";
import {
  issueStationPairingGrant,
  revokeStationPairingGrant
} from "../packages/application/src/index.ts";

function usage(): never {
  throw new Error([
    "Användning:",
    "  station:pairing:issue --race-id <uuid> --expires-at <ISO> --credential-expires-at <ISO>",
    "  station:pairing:revoke --grant-id <uuid>"
  ].join("\n"));
}

function argument(name: string, args: string[]): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) usage();
  return value;
}

function dateArgument(name: string, args: string[]): Date {
  const value = new Date(argument(name, args));
  if (!Number.isFinite(value.getTime())) throw new Error(`${name} måste vara en giltig ISO-tidpunkt`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...rawArgs] = process.argv.slice(2).filter((value) => value !== "--");
  if (!command || command === "--help" || command === "-h") usage();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL måste anges");
  const { db, pool } = createDatabase(connectionString);
  try {
    if (command === "issue") {
      const result = await issueStationPairingGrant(db, {
        raceId: argument("--race-id", rawArgs),
        scope: "READOUT",
        expiresAt: dateArgument("--expires-at", rawArgs),
        credentialExpiresAt: dateArgument("--credential-expires-at", rawArgs)
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (command === "revoke") {
      const result = await revokeStationPairingGrant(db, {
        grantId: argument("--grant-id", rawArgs)
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
  process.stderr.write(`${error instanceof Error ? error.message : "Parningskommandot misslyckades"}\n`);
  process.exitCode = 1;
});
