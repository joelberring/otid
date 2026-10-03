import { createDatabase } from "../packages/database/src/index.ts";
import { createEventorConnection, revokeEventorConnection } from "../packages/application/src/eventor-import.ts";
import { eventorMasterKeyFromEnvironment, readEventorApiKeyInput } from "../packages/application/src/eventor-configuration.ts";

function argumentsFor(command: string | undefined, args: string[]): Record<string, string> {
  const allowed = command === "create" ? ["--owner-credential-id", "--label", "--operator-label", "--profile"]
    : command === "revoke" ? ["--connection-id", "--operator-label"] : [];
  const result: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !allowed.includes(key) || !value || value.startsWith("--") || Object.hasOwn(result, key)) throw new Error("INVALID_ARGUMENTS");
    result[key] = value;
  }
  if (allowed.length === 0 || allowed.some((key) => !result[key])) throw new Error("INVALID_ARGUMENTS");
  return result;
}

async function main() {
  const [command, ...args] = process.argv.slice(2).filter((value) => value !== "--");
  const fields = argumentsFor(command, args);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_REQUIRED");
  const { db, pool } = createDatabase(process.env.DATABASE_URL);
  let masterKey: Uint8Array | undefined;
  try {
    if (command === "create") {
      const profile = fields["--profile"];
      if (profile !== "testeventor-se" && profile !== "production-se") throw new Error("INVALID_ARGUMENTS");
      if (process.stdin.isTTY) throw new Error("KEY_REQUIRES_PRIVATE_STDIN");
      const configuration = eventorMasterKeyFromEnvironment(process.env);
      masterKey = configuration.masterKey;
      const apiKey = await readEventorApiKeyInput(process.stdin);
      const result = await createEventorConnection(db, {
        ownerCredentialId: fields["--owner-credential-id"]!, label: fields["--label"]!,
        operatorLabel: fields["--operator-label"]!, environment: profile,
        keyId: configuration.keyId, masterKey, apiKey,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      const result = await revokeEventorConnection(db, {
        connectionId: fields["--connection-id"]!, operatorLabel: fields["--operator-label"]!,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } finally {
    masterKey?.fill(0);
    await pool.end();
  }
}

main().catch(() => {
  // Never print DB/fetch/config errors: they may contain credentials or SQL values.
  process.stderr.write("Eventoranslutningen kunde inte ändras. Kontrollera argument, privat stdin, serverkonfiguration och ägarcredential.\n");
  process.exitCode = 1;
});
