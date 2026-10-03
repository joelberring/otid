import { createDatabase } from "../packages/database/src/index.ts";
import {
  issueStationCredential,
  revokeStationCredential,
  rotateStationCredential
} from "../packages/application/src/index.ts";

function usage(): never {
  throw new Error([
    "Användning:",
    "  station:credential:issue --device-id <uuid> --race-id <uuid> --expires-at <ISO>",
    "  station:credential:rotate --credential-id <uuid> --expires-at <ISO>",
    "  station:credential:revoke --credential-id <uuid>"
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
      const result = await issueStationCredential(db, {
        deviceId: argument("--device-id", rawArgs),
        raceId: argument("--race-id", rawArgs),
        scope: "READOUT",
        expiresAt: dateArgument("--expires-at", rawArgs)
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (command === "rotate") {
      const result = await rotateStationCredential(db, {
        credentialId: argument("--credential-id", rawArgs),
        expiresAt: dateArgument("--expires-at", rawArgs)
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (command === "revoke") {
      const result = await revokeStationCredential(db, {
        credentialId: argument("--credential-id", rawArgs)
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
  process.stderr.write(`${error instanceof Error ? error.message : "Credentialkommandot misslyckades"}\n`);
  process.exitCode = 1;
});
