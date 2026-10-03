import { createMapObjectStore } from "@o-tid/infrastructure/map-object-store";

/** Build the private map store from server-only environment variables. */
export function createConfiguredMapStore() {
  const required = {
    storeId: process.env.OTID_MAP_STORE_ID,
    endpoint: process.env.OTID_MAP_STORE_ENDPOINT,
    bucket: process.env.OTID_MAP_STORE_BUCKET,
    region: process.env.OTID_MAP_STORE_REGION,
    accessKey: process.env.OTID_MAP_STORE_ACCESS_KEY,
    secretKey: process.env.OTID_MAP_STORE_SECRET_KEY,
    mode: process.env.OTID_MAP_STORE_MODE ?? "production",
  };
  if (Object.values(required).some((value) => !value)) throw new Error("OTID_MAP_STORE_CONFIG_MISSING");
  return createMapObjectStore(required);
}
