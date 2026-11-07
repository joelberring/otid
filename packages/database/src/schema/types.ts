import { customType } from "drizzle-orm/pg-core";

/** Binära filer (kartbild, GPX, PDF, bilder) lagras i PostgreSQL; node-postgres ger och tar emot Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
