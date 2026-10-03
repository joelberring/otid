import { expect, it } from "vitest";
import type { Database } from "@o-tid/database";
import { publicStartListXmlRoute } from "./public-start-list-xml-route";

it("hämtar fryst XML som cookie-fri no-store-download, och lämnar inga data vid fel", async () => {
  const db = {} as Database;
  const xml = '<?xml version="1.0" encoding="UTF-8"?><StartList/>';
  const response = await publicStartListXmlRoute(db, "race", async () => ({ status: "exported", xml, revision: 3 }));
  expect(await response.text()).toBe(xml);
  expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="startlista-3.xml"');
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toEqual([]);
  for (const [status, code] of [["not-found", 404], ["unavailable", 409]] as const) {
    const missing = await publicStartListXmlRoute(db, "race", async () => ({ status }));
    expect(missing.status).toBe(code); expect(await missing.text()).toBe("");
    expect(missing.headers.get("cache-control")).toBe("no-store");
  }
  const failed = await publicStartListXmlRoute(db, "race", async () => { throw new Error("private"); });
  expect(failed.status).toBe(503); expect(await failed.text()).toBe("");
});
