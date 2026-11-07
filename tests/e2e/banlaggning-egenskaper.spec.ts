import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { courseSettingInPhone, createRace, registerAccount, today, unique, warmCourseSetting } from "./helpers";

/**
 * ADR-0190: banans egenskaper i editorn (stigning, fast längd, poängbana med poäng, ordningen), ångra efter omladdning,
 * IOF XML (banor) och längden längs vägval. Kartfilen och .ppen-fixturen läses in; stigningen och längden sätts på Lång,
 * Lång flyttas ned och tillbaka med ångra, sidan laddas om och ångra tar bort den fasta längden. Mellan blir poängbana
 * med poäng. Överföringen till tävlingen ger stigningen, och en ändrad stigning blir en egen rad nästa gång.
 */
const fixture = (path: string) => fileURLToPath(new URL(`../../fixtures/${path}`, import.meta.url));
interface Document { courses: { id: string; name: string; order: number; kind: string; climbMeters?: number; lengthOverrideMeters?: number;
  first?: string }[]; courseControls: Record<string, { points?: number }> }

async function mapReady(page: Page) {
  await expect(page.getByTestId("course-setting-map")).toHaveAttribute("data-drawn", "true", { timeout: 60_000 });
  await expect(page.getByText("Läser kartfilen …")).toHaveCount(0);
}

async function saved(page: Page) {
  await expect(page.getByTestId("course-setting-status")).toHaveText("Sparat", { timeout: 20_000 });
}

test("banläggning-egenskaper: stigning, fast längd, poängbana, ordning, ångra efter omladdning, IOF XML och längd längs vägval",
  async ({ browser }) => {
    test.setTimeout(300_000);
    const suffix = unique();
    const owner = await registerAccount(browser, `egenskaper.${suffix}@exempel.se`, "Eva Egenskap");
    const raceId = await createRace(owner, `Egenskaper ${suffix}`, today(), "Tävling");
    const admin = `/api/admin/races/${raceId}/administrator`;
    const documentNow = async () => ((await (await owner.request.get(`${admin}/course-setting`)).json()) as { setting: { document: Document } })
      .setting.document;
    await warmCourseSetting(owner, raceId);

    await owner.goto(`/admin/${raceId}/course-setting`);
    await owner.waitForLoadState("networkidle");
    await owner.getByLabel(/^Kartfil \(/).setInputFiles(fixture("maps/kartfil.omap"));
    await owner.getByRole("button", { name: "Ladda upp kartfil (OCAD eller Mapper)" }).click();
    await expect(owner.getByRole("heading", { name: "Ingen banläggning än" })).toBeVisible({ timeout: 60_000 });
    await owner.getByLabel("Purple Pen-fil (.ppen)").setInputFiles(fixture("course-setting/kartfil.ppen"));
    await owner.getByRole("button", { name: "Läs in .ppen" }).click();
    const courseRow = (name: string) => owner.getByTestId("course-setting-course")
      .filter({ has: owner.locator("strong").getByText(name, { exact: true }) });
    await courseRow("Lång").click();

    // Stigning och fast längd: ett steg, bara det som ändrats.
    const properties = owner.getByTestId("course-setting-properties");
    await properties.getByTestId("course-setting-climb").fill("85");
    await properties.getByRole("button", { name: "Spara egenskaperna" }).click();
    await saved(owner);
    await properties.getByTestId("course-setting-length").fill("2700");
    await properties.getByRole("button", { name: "Spara egenskaperna" }).click();
    await saved(owner);
    let lang = (await documentNow()).courses.find(course => course.name === "Lång")!;
    expect(lang).toMatchObject({ climbMeters: 85, lengthOverrideMeters: 2700, order: 1 });
    await expect(courseRow("Lång")).toContainText("2700 m");

    // Ordningen: Lång ned ett steg och tillbaka med ångra.
    await owner.getByRole("button", { name: "Flytta Lång ned i listan" }).click();
    await expect(owner.getByTestId("course-setting-course").first()).toContainText("Mellan");
    await saved(owner);
    expect((await documentNow()).courses.find(course => course.name === "Lång")!.order).toBe(2);
    await owner.getByRole("button", { name: "Ångra" }).click();
    await expect(owner.getByTestId("course-setting-course").first()).toContainText("Lång");
    await saved(owner);
    expect((await documentNow()).courses.find(course => course.name === "Lång")!.order).toBe(1);

    // Längd längs vägval (vägvalens Worker räknar kartfilen).
    const routeLength = owner.getByTestId("course-setting-route-length");
    await routeLength.getByRole("button", { name: "Räkna längs vägval" }).click();
    await expect(routeLength.getByTestId("course-setting-route-length-result")).toContainText(/Längs bästa vägval \d+,\d km, fågelvägen \d+,\d km/,
      { timeout: 120_000 });
    await mapReady(owner);
    const shots = process.env.E2E_SCREENSHOT_DIR;
    await properties.scrollIntoViewIfNeeded();
    if (shots) await owner.screenshot({ path: `${shots}/banlaggning-egenskaper-1280.png` });

    // Omladdning: ångra finns kvar och tar bort den fasta längden (den senaste egna ändringen före flytten). Historiken
    // skrivs i webbläsaren strax efter ändringen: vänta tills den med flytten ångrad (ett steg framåt) ligger där.
    await saved(owner);
    await expect.poll(async () => (await courseSettingInPhone(owner, raceId)).history?.future, { timeout: 15_000 }).toBe(1);
    await owner.reload();
    await mapReady(owner);
    await expect(owner.getByRole("button", { name: "Ångra" })).toBeEnabled({ timeout: 15_000 });
    await expect(owner.getByText(/Ångra fungerar för \d+ ändring/)).toBeVisible();
    await owner.getByRole("button", { name: "Ångra" }).click();
    await saved(owner);
    lang = (await documentNow()).courses.find(course => course.name === "Lång")!;
    expect(lang.climbMeters).toBe(85);
    expect(lang.lengthOverrideMeters).toBeUndefined();

    // Mellan är gafflad och kan inte bli poängbana; en kopia av Lång blir poängbana med poäng per kontroll.
    await courseRow("Mellan").click();
    await owner.getByTestId("course-setting-properties").getByLabel("Poängbana").check();
    await owner.getByTestId("course-setting-properties").getByRole("button", { name: "Spara egenskaperna" }).click();
    await expect(owner.getByText("En poängbana kan inte ha gafflingar. Ta bort gafflingarna först.")).toBeVisible();
    await courseRow("Lång").click();
    await owner.getByRole("button", { name: "Duplicera" }).click();
    await expect(courseRow("Lång (kopia)")).toBeVisible();
    await courseRow("Lång (kopia)").click();
    const scoreProperties = owner.getByTestId("course-setting-properties");
    await scoreProperties.getByLabel("Poängbana").check();
    await scoreProperties.getByRole("button", { name: "Spara egenskaperna" }).click();
    const firstPoints = owner.getByTestId("course-setting-points").first();
    await expect(firstPoints).toBeVisible();
    // Utan satta poäng gäller kodens första siffra (som tävlingens rogaining): platshållaren visar den och summan räknar den.
    const fallback = Number(await firstPoints.getAttribute("placeholder"));
    expect(fallback).toBeGreaterThan(0);
    const before = Number(/^(\d+) poäng/.exec((await owner.getByTestId("course-setting-score-total").textContent()) ?? "")![1]);
    await firstPoints.fill("20");
    await firstPoints.press("Enter");
    await expect(owner.getByTestId("course-setting-score-total")).toContainText(`${before - fallback + 20} poäng`);
    await saved(owner);
    const document = await documentNow();
    expect(document.courses.find(course => course.name === "Lång (kopia)")!.kind).toBe("SCORE");
    expect(document.courses.find(course => course.name === "Mellan")!.kind).toBe("NORMAL");
    expect(document.courses.find(course => course.name === "Lång")!.kind).toBe("NORMAL");
    expect(Object.values(document.courseControls).some(item => item.points === 20)).toBe(true);
    await mapReady(owner);
    await owner.getByTestId("course-setting-control-list").scrollIntoViewIfNeeded();
    if (shots) await owner.screenshot({ path: `${shots}/banlaggning-egenskaper-poang-1280.png` });

    // IOF XML (banor) under Fil: Purple Pens form, stigningen och poängen.
    await owner.getByRole("button", { name: /^Fil/ }).click();
    await owner.getByRole("menuitem", { name: "Fil och versioner …" }).click();
    const downloadPromise = owner.waitForEvent("download");
    await owner.getByTestId("course-setting-iof").click();
    const download = await downloadPromise;
    const xml = await readFile(await download.path(), "utf8");
    // Huvudlösa Chromium ger en blob-nedladdning med å/ä/ö i namnet ("Kvällsträning … IOF.xml") namnet "download"; namnet prövas
    // i course-setting-iof.test.ts.
    expect(download.suggestedFilename()).toMatch(/(IOF\.xml|^download)$/);
    expect(xml).toContain('<CourseData xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"');
    expect(xml).toContain("<Climb>85</Climb>");
    expect(xml).toContain('<CourseControl type="Control" randomOrder="true">');
    expect(xml).toContain("<Score>20</Score>");
    await expect(owner.getByText(/OCAD:s banläggning kan läsa banor i IOF XML 3\.0/)).toBeVisible();
    if (shots) await owner.screenshot({ path: `${shots}/banlaggning-egenskaper-iof-1280.png` });
    await owner.keyboard.press("Escape");

    // Överföringen: Lång får stigningen; ändras den sedan blir det en egen rad (Stigning) utan nya banversioner.
    await owner.getByRole("button", { name: /^Fil/ }).click();
    await owner.getByRole("menuitem", { name: "Överför till tävlingen …" }).click();
    await owner.getByRole("dialog").getByRole("button", { name: "Överför till tävlingen" }).click();
    let review = owner.getByRole("region", { name: /Banläggningen, version \d+/ });
    await review.getByRole("button", { name: /^Godkänn \d+ ändring/ }).click();
    await expect(owner.getByText(/ändring/).first()).toBeVisible();
    await owner.keyboard.press("Escape");
    await courseRow("Lång").click();
    await owner.getByTestId("course-setting-climb").fill("120");
    await owner.getByRole("button", { name: "Spara egenskaperna" }).click();
    await saved(owner);
    await owner.getByRole("button", { name: /^Fil/ }).click();
    await owner.getByRole("menuitem", { name: "Överför till tävlingen …" }).click();
    await owner.getByRole("dialog").getByRole("button", { name: "Överför till tävlingen" }).click();
    review = owner.getByRole("region", { name: /Banläggningen, version \d+/ });
    await expect(review.getByText("Stigning")).toBeVisible();
    await expect(review.getByText(/85 m/)).toBeVisible();
    await expect(review.getByText(/120 m/)).toBeVisible();
    await owner.keyboard.press("Escape");

    // Telefonen: banans egenskaper och längden längs vägval på 390 px utan att något går utanför.
    const phoneContext = await browser.newContext({ storageState: await owner.context().storageState(), viewport: { width: 390, height: 844 },
      hasTouch: true });
    const phone = await phoneContext.newPage();
    // Fel i webbläsaren syns i testets logg (ett fel i en uträkning visar annars bara att en panel saknas).
    phone.on("console", message => { if (message.type() === "error") console.log(`[telefonen] ${message.text()}`); });
    phone.on("pageerror", error => console.log(`[telefonen] ${error.message}`));
    await phone.goto(`/admin/${raceId}/course-setting`);
    await expect(phone.getByTestId("course-setting-field-more")).toBeVisible({ timeout: 60_000 });
    await mapReady(phone);
    await phone.getByTestId("course-setting-field-more").click();
    await phone.getByRole("tab", { name: "Banor" }).click();
    await phone.getByTestId("course-setting-course").filter({ has: phone.locator("strong").getByText("Lång", { exact: true }) }).click();
    await expect(phone.getByRole("button", { name: "Flytta Lång ned i listan" })).toBeVisible();
    await expect(phone.getByTestId("course-setting-climb")).toHaveValue("120");
    expect(await phone.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mapReady(phone);
    if (shots) await phone.screenshot({ path: `${shots}/banlaggning-egenskaper-390.png` });
    await phone.getByTestId("course-setting-properties").scrollIntoViewIfNeeded();
    if (shots) await phone.screenshot({ path: `${shots}/banlaggning-egenskaper-egenskaper-390.png` });
    const phoneLength = phone.getByTestId("course-setting-route-length");
    await expect(phoneLength, `banorna: ${JSON.stringify((await documentNow()).courses.map(row => [row.name, row.kind]))}`).toBeAttached({ timeout: 60_000 });
    await phoneLength.scrollIntoViewIfNeeded();
    if (shots) await phone.screenshot({ path: `${shots}/banlaggning-egenskaper-vagval-390.png` });
    await phoneContext.close();
  });
