import { createRouteObjectStore } from "@o-tid/infrastructure/route-object-store";

/** Build the private GPX store from server-only environment variables. */
export function createConfiguredRouteStore() {
  const required = {
    storeId: process.env.OTID_ROUTE_STORE_ID,
    endpoint: process.env.OTID_ROUTE_STORE_ENDPOINT,
    bucket: process.env.OTID_ROUTE_STORE_BUCKET,
    region: process.env.OTID_ROUTE_STORE_REGION,
    accessKey: process.env.OTID_ROUTE_STORE_ACCESS_KEY,
    secretKey: process.env.OTID_ROUTE_STORE_SECRET_KEY,
    mode: process.env.OTID_ROUTE_STORE_MODE ?? "production"
  };
  if (Object.values(required).some(value => !value)) throw new Error("OTID_ROUTE_STORE_CONFIG_MISSING");
  return createRouteObjectStore(required);
}
