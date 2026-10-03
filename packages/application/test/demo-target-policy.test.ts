import { describe, expect, it } from "vitest";
import { DemoTargetPolicyError, validateDemoTarget } from "../src/demo-target-policy";

const confirmation = "synthetic-empty-database";
const valid = "postgresql://demo:private-password@localhost:5432/otid_demo_forest_1";

describe("synthetic demo target policy", () => {
  it("returns the unmodified valid PostgreSQL connection string and database name", () => {
    expect(validateDemoTarget({ databaseUrl: valid, environment: "development", confirmation })).toEqual({
      databaseName: "otid_demo_forest_1", connectionString: valid
    });
    expect(validateDemoTarget({ databaseUrl: "postgres://127.0.0.1:1/otid_demo_a", environment: "test", confirmation }))
      .toEqual({ databaseName: "otid_demo_a", connectionString: "postgres://127.0.0.1:1/otid_demo_a" });
    expect(validateDemoTarget({ databaseUrl: "postgresql://[::1]:65535/otid_demo_a", environment: "test", confirmation }))
      .toEqual({ databaseName: "otid_demo_a", connectionString: "postgresql://[::1]:65535/otid_demo_a" });
  });

  it("rejects every unsafe target without exposing a connection value", () => {
    const invalid = [
      { databaseUrl: valid, environment: undefined, confirmation },
      { databaseUrl: valid, environment: "production", confirmation },
      { databaseUrl: valid, environment: "development", confirmation: "synthetic-empty-database " },
      { databaseUrl: "mysql://localhost:5432/otid_demo_a", environment: "test", confirmation },
      { databaseUrl: "postgresql://db.example.test:5432/otid_demo_a", environment: "test", confirmation },
      { databaseUrl: "postgresql://LOCALHOST:5432/otid_demo_a", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost/otid_demo_a", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:0/otid_demo_a", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:65536/otid_demo_a", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:not-a-port/otid_demo_a", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:5432/otid_demo_a?sslmode=require", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:5432/otid_demo_a#fragment", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:5432/otid_demo_a?", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:5432/otid_demo_a#", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:5432/other/../otid_demo_a", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:5432/otid_demo_a\n", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:5432/otid_demo_%61", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:5432/OTID_DEMO_A", environment: "test", confirmation },
      { databaseUrl: "postgresql://localhost:5432/otid_demo_", environment: "test", confirmation },
      { databaseUrl: `postgresql://localhost:5432/otid_demo_${"a".repeat(49)}`, environment: "test", confirmation }
    ];

    for (const input of invalid) {
      try {
        validateDemoTarget(input);
        expect.unreachable("unsafe target accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(DemoTargetPolicyError);
        expect(String(error)).toBe("DemoTargetPolicyError: DEMO_TARGET_POLICY_INVALID");
        expect(String(error)).not.toContain("private-password");
      }
    }
  });
});
