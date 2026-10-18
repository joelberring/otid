import { expect, test } from "@playwright/test";
import { addCourseAndClass, addEntry, createRace, openStep, registerAccount, unique } from "./helpers";

test("repro: karta och rutter", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const owner = await registerAccount(browser, `karta.${suffix}@exempel.se`, "Ka Karta");
  const raceId = await createRace(owner, `Karta ${suffix}`);
  await addCourseAndClass(owner, "Lång", "H21", "31 32 33");
  await addEntry(owner, { className: "H21", givenName: "Anna", familyName: "Berg", club: "OK Test", card: "8100001" });
  const responses: string[] = [];
  owner.on("response", (response) => { if (response.url().includes("/administrator/map")) responses.push(`${response.status()} ${response.url()}`); });
  owner.on("console", (message) => { if (message.type() === "error") responses.push(`console: ${message.text()}`); });
  await openStep(owner, "Resultat");
  await owner.waitForTimeout(20_000);
  const section = owner.getByRole("region", { name: "Karta och vägval" });
  const text = await section.innerText();
  console.log("RESPONSES", responses);
  console.log("SECTION", text.slice(0, 400));
  await owner.reload();
  await openStep(owner, "Resultat");
  await owner.waitForTimeout(8_000);
  console.log("RESPONSES2", responses);
  console.log("SECTION2", (await owner.getByRole("region", { name: "Karta och vägval" }).innerText()).slice(0, 400));
  expect(raceId).toBeTruthy();
});
