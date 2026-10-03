import { fileURLToPath } from "node:url";
import { createDatabase } from "../packages/database/src/index.ts";
import { DemoInstallationSchema, createDemoSummary } from "../packages/contracts/src/demo-installation.ts";
import { validateDemoTarget } from "../packages/application/src/demo-target-policy.ts";
import { parseDemoCliArguments } from "../packages/application/src/demo-cli-input.ts";
import { reserveDemoPrivateOutput } from "../packages/application/src/demo-private-output.ts";
import { provisionSyntheticDemo } from "../packages/application/src/provision-synthetic-demo.ts";

async function main() {
  const args = parseDemoCliArguments(process.argv.slice(2));
  const input = { databaseUrl: process.env.DATABASE_URL ?? "", environment: process.env.NODE_ENV, confirmation: args.confirmation };
  const target = validateDemoTarget(input);
  const output = await reserveDemoPrivateOutput(args.outputPath, fileURLToPath(new URL("../", import.meta.url)));
  try {
    const { db, pool } = createDatabase(target.connectionString);
    try {
      const summary = await provisionSyntheticDemo(db, input, async value => {
        await output.write(DemoInstallationSchema.parse(value));
      });
      process.stdout.write(`${JSON.stringify(createDemoSummary(summary))}\n`);
    } finally { await pool.end(); }
  } finally { await output.close(); }
}
main().catch(() => {
  process.stderr.write("Demoprovisioneringen kunde inte bekräftas. Kontrollera argument, privat output och isolerad databas innan nytt försök. Befintlig output behålls; inga felvärden skrivs ut.\n");
  process.exitCode = 1;
});
