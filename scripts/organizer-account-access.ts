import { createDatabase } from "../packages/database/src/index.ts";
import { provisionUserAccount, rotateUserAccountPassword } from "../packages/application/src/user-account.ts";
import {
  parseOrganizerAccountArguments,
  readPrivateInput,
  reserveOrganizerPrivateOutput,
  validateOrganizerAccountTarget
} from "./organizer-account.ts";

async function main(): Promise<void> {
  const command = parseOrganizerAccountArguments(process.argv.slice(2));
  const connectionString = validateOrganizerAccountTarget({
    command,
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    testDatabaseUrl: process.env.TEST_DATABASE_URL
  });
  if (process.stdin.isTTY) throw new Error("ORGANIZER_INTERACTIVE_IO_REFUSED");
  const input = await readPrivateInput(process.stdin);
  const output = await reserveOrganizerPrivateOutput(command.outputPath);
  try {
    const { db, pool } = createDatabase(connectionString);
    try {
      if (command.command === "provision") {
        if (Object.keys(input).sort().join(",") !== "displayName,loginName"
          || typeof input.loginName !== "string" || typeof input.displayName !== "string") {
          throw new Error("ORGANIZER_INPUT_INVALID");
        }
        const result = await provisionUserAccount(db, { loginName: input.loginName, displayName: input.displayName });
        await output.write({ accountId: result.accountId, loginName: result.loginName, password: result.initialPassword });
        process.stdout.write(`${JSON.stringify({ accountId: result.accountId, loginName: result.loginName, status: "provisioned" })}\n`);
      } else {
        if (Object.keys(input).sort().join(",") !== "accountId" || typeof input.accountId !== "string") {
          throw new Error("ORGANIZER_INPUT_INVALID");
        }
        const result = await rotateUserAccountPassword(db, input.accountId);
        await output.write({ accountId: result.accountId, password: result.password, version: result.version });
        process.stdout.write(`${JSON.stringify({ accountId: result.accountId, version: result.version, status: "rotated" })}\n`);
      }
    } finally { await pool.end(); }
  } finally { await output.close(); }
}

main().catch(() => {
  process.stderr.write("Arrangörskontot kunde inte provisioneras eller roteras. Kontrollera privat stdin, isolerad målmiljö och ny privat outputfil; lösenord skrivs aldrig till terminalen.\n");
  process.exitCode = 1;
});
