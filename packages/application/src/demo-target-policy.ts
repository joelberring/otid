const CONFIRMATION = "synthetic-empty-database";
const DATABASE_NAME = /^otid_demo_[a-z0-9_]{1,48}$/;
const AUTHORITY = /^(?:localhost|127\.0\.0\.1|\[::1\]):([0-9]+)$/;

/** Generic policy failure: configuration values, including credentials, are never exposed. */
export class DemoTargetPolicyError extends Error {
  public constructor() {
    super("DEMO_TARGET_POLICY_INVALID");
    this.name = "DemoTargetPolicyError";
  }
}

export function validateDemoTarget(input: {
  databaseUrl: string;
  environment: string | undefined;
  confirmation: string;
}): { databaseName: string; connectionString: string } {
  try {
    if (!input || typeof input !== "object"
      || typeof input.databaseUrl !== "string"
      || typeof input.environment !== "string"
      || typeof input.confirmation !== "string"
      || (input.environment !== "development" && input.environment !== "test")
      || input.confirmation !== CONFIRMATION) {
      throw new DemoTargetPolicyError();
    }

    const connectionString = input.databaseUrl;
    if (!/^(?:postgres|postgresql):\/\//.test(connectionString)) throw new DemoTargetPolicyError();
    const parsed = new URL(connectionString);
    const pathStart = connectionString.indexOf("/", connectionString.indexOf("//") + 2);
    const rawPath = connectionString.slice(pathStart);
    const authority = connectionString.slice(connectionString.indexOf("//") + 2, connectionString.indexOf("/", connectionString.indexOf("//") + 2));
    const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
    const port = AUTHORITY.exec(hostAndPort)?.[1];

    if ((parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:")
      || !port || !Number.isSafeInteger(Number(port)) || Number(port) < 1 || Number(port) > 65_535
      || parsed.search || parsed.hash || rawPath !== parsed.pathname || !DATABASE_NAME.test(parsed.pathname.slice(1))) {
      throw new DemoTargetPolicyError();
    }

    return { databaseName: parsed.pathname.slice(1), connectionString };
  } catch {
    throw new DemoTargetPolicyError();
  }
}
