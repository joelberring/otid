import { defineConfig } from "@playwright/test";
import { createPublicKey, generateKeyPairSync } from "node:crypto";

const stationPackagePrivateKeyPem = process.env.O_TID_TEST_PACKAGE_PRIVATE_KEY_PEM ??
  generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    type: "pkcs8",
    format: "pem"
  }).toString();
process.env.O_TID_TEST_PACKAGE_PRIVATE_KEY_PEM = stationPackagePrivateKeyPem;
const stationPackagePublicKeySpkiBase64 = createPublicKey(stationPackagePrivateKeyPem)
  .export({ type: "spki", format: "der" }).toString("base64");
process.env.O_TID_TEST_PACKAGE_PUBLIC_KEY_SPKI_BASE64 = stationPackagePublicKeySpkiBase64;

export default defineConfig({
  testDir: "./tests/e2e",
  // This suite needs its own explicitly selected empty demo database.
  testIgnore: ["**/task-007-demo.spec.ts"],
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: {
    command: "pnpm --filter @o-tid/web dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
      O_TID_SIMULATOR_MODE: "loopback-development",
      O_TID_PACKAGE_SIGNING_PRIVATE_KEY_PEM: stationPackagePrivateKeyPem
    }
  }
});
