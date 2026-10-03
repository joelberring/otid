import { expect, it } from "vitest";
import { routePublicationConsentIdempotencyKeySchema, routePublicationConsentRequestSchema, routePublicationConsentStateResponseSchema } from "../src/route-upload";

const id = "10000000-0000-4000-8000-000000000001";

it("TASK116 accepts only explicit private-route consent decisions and opaque participant state", () => {
  expect(routePublicationConsentIdempotencyKeySchema.safeParse(`route-publication-consent:${id}`).success).toBe(true);
  expect(routePublicationConsentIdempotencyKeySchema.safeParse(`route-upload:${id}`).success).toBe(false);
  expect(routePublicationConsentRequestSchema.safeParse({ formatVersion: 1, decision: "GRANT" }).success).toBe(true);
  expect(routePublicationConsentRequestSchema.safeParse({ formatVersion: 1, decision: "PUBLIC" }).success).toBe(false);
  expect(routePublicationConsentStateResponseSchema.parse({ formatVersion: 1, status: "stored", consent: "PRIVATE", revision: 0, decidedAt: null })).not.toHaveProperty("manifestId");
});
