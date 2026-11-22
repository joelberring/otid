import { describe, expect, it } from "vitest";
import { childEnvironment } from "../../../scripts/geo-worker.ts";

describe("geo-arbetaren: miljön för program som tolkar opålitliga filer", () => {
  it("tar inte med arbetarens nyckel eller andra hemligheter men behåller resten", () => {
    const clean = childEnvironment({ PATH: "/usr/bin", HOME: "/root", OTID_GEO_WORKER_TOKEN: "hemlig".repeat(8), OTID_HETZNER_TOKEN: "x",
      OTID_ARCHIVE_SECRET_KEY: "y", OTID_GEO_ORIGIN: "https://o-tid.example", OTID_PULLAUTA: "/opt/pullauta/pullauta" });
    expect(clean).toEqual({ PATH: "/usr/bin", HOME: "/root", OTID_GEO_ORIGIN: "https://o-tid.example", OTID_PULLAUTA: "/opt/pullauta/pullauta", RUST_LOG: "warn" });
  });
});
