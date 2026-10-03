import { createDatabase } from "../packages/database/src/index.ts";
import { createEventorRaceImportGrant, revokeEventorRaceImportGrant } from "../packages/application/src/eventor-import.ts";

function invalid(): never { throw new Error("INVALID_ARGUMENTS"); }

function valuesFor(command: "issue" | "revoke", args: string[]): Map<string, string> {
  const allowed = command === "issue"
    ? ["--eventor-import-request-id", "--owner-credential-id", "--recipient-credential-id", "--label", "--operator-label"]
    : ["--grant-id", "--owner-credential-id", "--operator-label", "--reason"];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key || !allowed.includes(key) || values.has(key) || !value || value.startsWith("--")) invalid();
    values.set(key, value);
  }
  if (allowed.some((key) => !values.get(key))) invalid();
  return values;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "issue" && command !== "revoke") invalid();
  if (!process.env.DATABASE_URL) invalid();
  const values = valuesFor(command, args);
  const { db, pool } = createDatabase(process.env.DATABASE_URL);
  try {
    const result = command === "issue"
      ? await createEventorRaceImportGrant(db, {
        eventorImportRequestId: values.get("--eventor-import-request-id")!,
        ownerCredentialId: values.get("--owner-credential-id")!,
        recipientCredentialId: values.get("--recipient-credential-id")!,
        label: values.get("--label")!, operatorLabel: values.get("--operator-label")!
      })
      : await revokeEventorRaceImportGrant(db, {
        grantId: values.get("--grant-id")!, ownerCredentialId: values.get("--owner-credential-id")!,
        operatorLabel: values.get("--operator-label")!, reason: values.get("--reason")!
      });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  // This trusted server CLI never receives or prints an Eventor API key.
  process.stderr.write("Testeventorimportens grant kunde inte ändras. Kontrollera argument och servermiljö.\n");
  process.exitCode = 1;
});
