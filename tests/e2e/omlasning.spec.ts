import { expect, test, type Page } from "@playwright/test";
import { decodeCard, normalizeCard, wallClockToUtc } from "../../packages/sportident/src";
import { NATT_KM_CODES, nattKmBlockFrame, nattKmBlocks, nattKmDetection } from "../../packages/sportident/test/fixtures/siac-natt-km";
import { addCourseAndClass, addEntry, createRace, daysFromToday, openStep, registerAccount, sendReadout, TIME_ZONE, unique,
  warmRoute } from "./helpers";

/**
 * PLAN.md steg 36: läs om avläsningar från rådata. Som på natt-KM 2026-10-20 sparade avläsningen fel stämplingar (brickans
 * inställningar) men riktiga råramar. Deltagarkortet erbjuder "Läs om"; omläsningen ger kvällens 14 stämplingar och
 * godkänd 53:23, och Avläsning → Läs om avläsningar från rådata hittar sedan inget mer.
 */
const CARD = 8_001_234;
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Senaste tisdag (brickans veckodag) 19:45 svensk tid som redan varit; tävlingen hålls den dagen. */
function lastTuesdayEvening(): { date: string; readAt: Date } {
  for (let days = 0; days <= 7; days += 1) {
    const date = daysFromToday(-days);
    const [year, month, day] = date.split("-").map(Number);
    const readAt = wallClockToUtc(year!, month!, day!, 19 * 3600 + 45 * 60, TIME_ZONE);
    if (new Date(`${date}T12:00:00Z`).getUTCDay() === 2 && readAt.getTime() < Date.now()) return { date, readAt };
  }
  throw new Error("Ingen tisdag");
}

async function openCard(owner: Page, name: string, status: string) {
  const card = owner.getByRole("region", { name: "Deltagarkort" });
  await expect(async () => {
    await owner.getByRole("row", { name: new RegExp(name) }).getByRole("cell").nth(1).click();
    await expect(card.getByRole("heading", { name })).toBeVisible({ timeout: 2_000 });
    await expect(card.getByRole("region", { name: "Resultat", exact: true })).toContainText(status, { timeout: 4_000 });
  }).toPass({ timeout: 45_000 });
  return card;
}

test("läs om en felaktig avläsning från rådata i deltagarkortet och under Avläsning", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = unique();
  const { date, readAt } = lastTuesdayEvening();
  const owner = await registerAccount(browser, `steg36.${suffix}@exempel.se`, "Kim Klubb");
  const raceId = await createRace(owner, `Natt-KM ${suffix}`, date, "Tävling");
  await addCourseAndClass(owner, "Natt", "H21", NATT_KM_CODES.join(" "));
  await addEntry(owner, { className: "H21", givenName: "Ada", familyName: "Natt", club: "OK Test", card: String(CARD) });

  // Den gamla avläsningen: block 0–4 som om de vore 0, 4, 5, 6, 7. Råramarna är riktiga.
  const blocks = nattKmBlocks(CARD);
  const image = new Uint8Array(5 * 128);
  [0, 1, 2, 3, 4].forEach((number, index) => image.set(blocks[number]!, index * 128));
  const wrong = normalizeCard(decodeCard("SIAC", image), { reference: readAt, timeZone: TIME_ZONE });
  await sendReadout(owner, raceId, { cardNumber: String(CARD), cardType: "SIAC", startPunchedAt: wrong.startPunchedAt!,
    finishPunchedAt: wrong.finishPunchedAt!, checkPunchedAt: wrong.checkPunchedAt!,
    punches: wrong.punches.filter((punch) => punch.code > 0).map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })),
    frames: [nattKmDetection(CARD), ...[0, 1, 2, 3, 4].map((number) => nattKmBlockFrame(number, CARD))].map(toHex),
    stationReceivedAt: readAt.toISOString() });

  await warmRoute(owner, `/api/admin/races/${raceId}/administrator/readout-reread/preview`, "POST");
  await owner.reload();
  await openStep(owner, "Anmälda");
  const card = await openCard(owner, "Ada Natt", "Felstämplad");
  const row = card.getByTestId("participant-reread");
  await expect(row).toContainText("Avläsningen kan läsas om från rådata");
  await row.getByRole("button", { name: "Läs om" }).click();
  const review = row.getByRole("alert", { name: "Läs om avläsningen" });
  await expect(review).toContainText(`Bricka ${CARD} · Ada Natt (H21):`);
  await expect(review).toContainText("→ 14 stämplingar, Godkänd 53:23");
  await expect(review).toContainText("Inget är sparat än.");
  await review.getByRole("button", { name: "Spara och räkna om" }).click();
  await expect(row.getByRole("status")).toHaveText("Sparat. 1 avläsning lästes om och räknades om.");
  const result = card.getByRole("region", { name: "Resultat", exact: true });
  await expect(result).toContainText("Godkänd");
  await expect(result).toContainText("53:23");
  await expect(card.getByRole("region", { name: "Historik" })).toContainText("Omläst från rådata: Godkänd");
  await expect(card.getByText("Avläsningen kan läsas om från rådata")).toHaveCount(0);

  // Hela tävlingen: inget mer att läsa om.
  await openStep(owner, "Avläsning");
  const panel = owner.getByRole("region", { name: "Läs om avläsningar från rådata" });
  await panel.getByRole("button", { name: "Visa vad som händer" }).click();
  const all = panel.getByRole("alert", { name: "Läs om avläsningar från rådata" });
  await expect(all).toContainText("1 avläsning lästes om.");
  await expect(all).toContainText("Ingen avläsning blir annorlunda.");
  await all.getByRole("button", { name: "Avbryt" }).click();
});
