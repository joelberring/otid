import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { mapPointToWgs84 } from "../../packages/map-file/src/georef";
import type { MapGeoreference } from "../../packages/map-file/src/model";
import { createRace, mapSettled, openStep, registerAccount, today, unique, warmRoute } from "./helpers";

/**
 * Banläggningens karta på en telefon (390 × 844): ett finger på tom karta flyttar kartan och två fingrar isär zoomar in,
 * med riktiga pekhändelser (CDP). Felet var att förflyttningen räknades inne i vyns uppdatering, efter att senaste
 * läget redan flyttats, så att den alltid blev noll.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));

/** Kartfilsfixturens georeferens (kartfil.omap: SWEREF 99 TM, 1:10 000, referenspunkten i kartans origo). */
const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const target = { x: 60, y: 50 };

test("kartan på telefonen: ett finger flyttar kartan, två fingrar zoomar", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `banlaggning.mobil.${suffix}@exempel.se`, "Bea Banläggare");
  const raceId = await createRace(owner, `Banläggning mobil ${suffix}`, today(), "Tävling");
  const admin = `/api/admin/races/${raceId}/administrator`;
  for (const path of ["course-setting", "map/source", "route-choice"]) await warmRoute(owner, `${admin}/${path}`);

  // Kartfilen och .ppen laddas upp vid datorn.
  await owner.goto(`/admin/${raceId}/manage`);
  await openStep(owner, "Banor");
  await owner.getByTestId("nav-course-setting").click();
  await owner.getByLabel("Kartfil (.ocd, .omap eller .xmap, högst 75 MB)").setInputFiles(fixture("maps/kartfil.omap"));
  await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
  await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
  await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
  await owner.getByRole("button", { name: "Läs in .ppen" }).click();
  await expect(owner.getByText(/Inläst: 2 banor och 9 kontroller\./)).toBeVisible();
  // Bred skärm: knappen Min position finns på kartan, sidopanelerna som vanligt.
  await expect(owner.getByRole("button", { name: "Min position" })).toBeVisible();
  await expect(owner.getByTestId("course-setting-field")).toHaveCount(0);

  // Telefonen: samma konto, smal skärm, position på (60, 50) mm med ±5 m.
  const wgs = mapPointToWgs84(georeference, target);
  const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true, geolocation: { latitude: wgs.latitude, longitude: wgs.longitude, accuracy: 5 },
    permissions: ["geolocation"] });
  const phone = await phoneContext.newPage();
  const page = await phone.goto(`/admin/${raceId}/course-setting`);
  expect(page!.headers()["permissions-policy"]).toBe("camera=(), geolocation=(self), microphone=()");
  await expect(phone.getByTestId("course-setting-field")).toBeVisible();
  const map = phone.getByTestId("course-setting-map");
  await expect(phone.getByText("Läser kartfilen …")).toHaveCount(0, { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-px-per-mm", /\d/);
  await mapSettled(map);

  const cdp = await phone.context().newCDPSession(phone);
  const box = (await map.boundingBox())!;
  const before = await map.getAttribute("data-center");
  const x0 = box.x + box.width / 2, y0 = box.y + box.height - 20;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + i * 10, y: y0 - i * 10 }] });
    await phone.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(map).not.toHaveAttribute("data-center", before!);
  expect(await phone.evaluate(() => window.scrollY)).toBe(0);
  // Två fingrar isär: zoomar in.
  const scale0 = Number(await map.getAttribute("data-px-per-mm"));
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 20, y: cy, id: 1 }, { x: cx + 20, y: cy, id: 2 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 20 - i * 8, y: cy, id: 1 }, { x: cx + 20 + i * 8, y: cy, id: 2 }] });
    await phone.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => Number(await map.getAttribute("data-px-per-mm"))).toBeGreaterThan(scale0 * 2);
});
