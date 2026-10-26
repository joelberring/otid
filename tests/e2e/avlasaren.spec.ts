import { expect, test, type Page } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, registerAccount, reviewScreenshots, today, unique } from "./helpers";

/**
 * Steg 35: avläsaren kommer ihåg stationen och låter vid avläsning. Riktig USB går inte att prova här; sidan får en
 * webbläsare utan godkända stationer (tomma listor) eller helt utan Web Serial och WebUSB och ska klara båda. Ljudet
 * räknas genom att Web Audio-tonerna fångas; övningsstationen ska låta som en riktig station.
 */
const STATION_KEY = "otid.readout.station.v1";

async function openReadout(page: Page, raceId: string) {
  await page.goto(`/admin/${raceId}/readout`);
  await page.waitForURL(`**/readout/index.html#${raceId}`);
  await expect(page.getByTestId("package-status")).toContainText("v");
}

test("avläsaren ansluter själv, klarar webbläsare utan USB, låter vid avläsning och har snabb utläsning", async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `steg35a.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Avläsning ${suffix}`, today(), "Träning");
  await addCourseAndClass(owner, "Lång", "Öppen", "31 32");
  await addEntry(owner, { className: "Öppen", givenName: "Ada", familyName: "Ljud", club: "OK Test", card: "7360001" });
  await addEntry(owner, { className: "Öppen", givenName: "Bo", familyName: "Moll", club: "OK Test", card: "7360002" });
  await addEntry(owner, { className: "Öppen", givenName: "Cia", familyName: "Tyst", club: "OK Test", card: "7360003" });

  // 1. En station anslöts här förut, men webbläsaren har inga godkända enheter just nu (tomma listor).
  const context = owner.context();
  await context.addInitScript(({ key }) => {
    const tones: number[] = [];
    (window as unknown as { __tones: number[] }).__tones = tones;
    const original = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "createOscillator")!.value as
      (this: BaseAudioContext) => OscillatorNode;
    BaseAudioContext.prototype.createOscillator = function (this: BaseAudioContext) {
      const oscillator = original.call(this);
      queueMicrotask(() => tones.push(Math.round(oscillator.frequency.value)));
      return oscillator;
    };
    const events = { addEventListener() {}, removeEventListener() {} };
    if (sessionStorage.getItem("no-usb") === "1") {
      Object.defineProperty(Navigator.prototype, "serial", { get: () => undefined, configurable: true });
      Object.defineProperty(Navigator.prototype, "usb", { get: () => undefined, configurable: true });
    } else {
      Object.defineProperty(Navigator.prototype, "serial", { get: () => ({ ...events, requestPort: () => Promise.reject(new Error("avbrutet")),
        getPorts: () => Promise.resolve([]) }), configurable: true });
      Object.defineProperty(Navigator.prototype, "usb", { get: () => ({ ...events, requestDevice: () => Promise.reject(new Error("avbrutet")),
        getDevices: () => Promise.resolve([]) }), configurable: true });
    }
    if (sessionStorage.getItem("seeded") !== "1") {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem(key, JSON.stringify({ link: "serial", vendorId: 0x10c4, productId: 0x800a }));
    }
  }, { key: STATION_KEY });
  await openReadout(owner, raceId);
  const auto = owner.getByTestId("auto-connect");
  await expect(auto).toContainText("Ansluter automatiskt till stationen …");
  await expect(owner.getByTestId("station-status")).toContainText("Ej ansluten");
  await expect(owner.getByText("ha avläsningen öppen i en egen flik")).toBeVisible();
  await expect(owner.getByRole("link", { name: "Resultat" })).toHaveAttribute("target", "_blank");
  await reviewScreenshots(owner, "step35-readout-auto");
  await auto.getByRole("button", { name: "Sluta ansluta automatiskt" }).click();
  await expect(auto).toBeHidden();
  expect(await owner.evaluate((key) => localStorage.getItem(key), STATION_KEY)).toBeNull();

  // 2. Webbläsare helt utan Web Serial och WebUSB (t.ex. iPad): sidan fungerar, inget automatiskt, ett tydligt besked vid klick.
  await owner.evaluate((key) => { sessionStorage.setItem("no-usb", "1");
    localStorage.setItem(key, JSON.stringify({ link: "usb", vendorId: 0x10c4 })); }, STATION_KEY);
  await owner.reload();
  await expect(owner.getByTestId("package-status")).toContainText("v");
  await expect(owner.getByTestId("auto-connect")).toHaveCount(0);
  await owner.getByRole("button", { name: "Anslut SPORTident-station" }).click();
  await expect(owner.getByTestId("station-status")).toContainText("Den här webbläsaren kan inte ansluta USB-stationer");
  await owner.evaluate(() => sessionStorage.removeItem("no-usb"));
  await owner.reload();

  // 3. Ljud: övningsstationen låter glatt vid godkänt och moll vid fel; valet sparas.
  await expect(owner.getByTestId("package-status")).toContainText("v");
  const sound = owner.getByLabel("Ljud vid avläsning");
  await expect(sound).toBeChecked();
  await owner.getByRole("button", { name: "Starta övningsstation" }).click();
  await expect(owner.getByTestId("station-status")).toContainText("Övningsstation");
  const tones = () => owner.evaluate(() => (window as unknown as { __tones: number[] }).__tones.slice());
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("GODKÄND");
  await expect.poll(tones).toEqual([523, 659, 784]);
  const runner = owner.getByLabel("Deltagare");
  await runner.selectOption({ label: await runner.locator("option", { hasText: "Bo Moll" }).innerText() });
  await owner.getByRole("button", { name: "Läs av: missad kontroll" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("FELSTÄMPLAD");
  await expect.poll(tones).toEqual([523, 659, 784, 659, 523, 440]);
  // Steg 53: snabb utläsning av SI10/11/SIAC är på som förval och kan stängas av i felsökningsdelen; avläsningen går som förut.
  const fastRead = owner.getByLabel("Snabb utläsning av SI10/11/SIAC");
  await expect(fastRead).toBeChecked();
  await fastRead.uncheck();
  await sound.uncheck();
  await runner.selectOption({ label: await runner.locator("option", { hasText: "Cia Tyst" }).innerText() });
  await owner.getByRole("button", { name: "Läs av: rätt stämplat" }).click();
  await expect(owner.getByTestId("verdict")).toContainText("Cia Tyst");
  await expect(owner.getByTestId("recent-readouts").locator("li")).toHaveCount(3);
  expect(await tones()).toHaveLength(6);
  await reviewScreenshots(owner, "step35-readout-sound");
  await owner.reload();
  await expect(owner.getByLabel("Ljud vid avläsning")).not.toBeChecked();
  await expect(owner.getByLabel("Snabb utläsning av SI10/11/SIAC")).not.toBeChecked();
});
