import { describe, expect, it } from "vitest";

import { runPortsCommand } from "../src/ports-command.js";
import type { SerialDriver } from "../src/node-serial-transport.js";

describe("runPortsCommand", () => {
  it("omits stable and physical identifiers from standard output", async () => {
    const driver: SerialDriver = {
      async list() {
        return [{
          path: "/dev/cu.private",
          manufacturer: "Example",
          vendorId: "10c4",
          productId: "ea60",
          serialNumber: "stable-secret",
          pnpId: "pnp-secret",
          locationId: "location-secret"
        }];
      },
      create() {
        throw new Error("ports must not be opened");
      }
    };

    const output = await runPortsCommand(driver);
    expect(JSON.parse(output)).toEqual({
      opened: false,
      probed: false,
      sportidentSupportClaimed: false,
      count: 1,
      ports: [{
        path: "/dev/cu.private",
        manufacturer: "Example",
        vendorId: "10c4",
        productId: "ea60"
      }]
    });
    expect(output).not.toContain("stable-secret");
    expect(output).not.toContain("pnp-secret");
    expect(output).not.toContain("location-secret");
  });
});
