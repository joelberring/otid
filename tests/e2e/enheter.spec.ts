import { expect, test } from "@playwright/test";
import { Command, encodeCommand, encodeStationFrame, MASTER_DIRECT } from "../../packages/sportident/src";
import { encodeStationClock } from "../../packages/sportident/src/time";
import { addCourseAndClass, addEntry, createRace, registerAccount, reviewScreenshots, today, unique } from "./helpers";

/**
 * Ägaren 2026-11-08: läsa ut en enhet (bara läsning, provas). Riktig USB går inte att prova här; sidan får en falsk Web Serial
 * där en falsk huvudstation med en kontroll (kod 31) svarar på kommandona. Brickorna i backupminnet visas med löparna.
 */
/** Kommandot utan väckningsbyte, som nyckel. */
const command = (code: number, params: number[] = []) => hex(encodeCommand(code, params, { wakeup: false }));
const hex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
const CODE = 31;

function replies(cards: readonly number[]): Record<string, string> {
  const system = new Array<number>(0x80).fill(0);
  [system[0x00], system[0x01], system[0x02], system[0x03]] = [0x00, 0x03, 0x0f, 0x42];
  [system[0x05], system[0x06], system[0x07]] = [0x36, 0x35, 0x36];
  [system[0x0b], system[0x0c]] = [0x81, 0x98];
  system[0x0d] = 128;
  [system[0x15], system[0x16], system[0x17]] = [22, 3, 1];
  const pointer = 0x100 + cards.length * 8;
  [system[0x21], system[0x22]] = [(pointer >> 8) & 0xff, pointer & 0xff];
  system[0x71] = 0x02; system[0x72] = CODE; system[0x74] = 0x01;
  const records = cards.flatMap((card, index) => [(card >> 16) & 0xff, (card >> 8) & 0xff, card & 0xff, 0, 0, 0x10, index * 10, 0]);
  const now = new Date();
  return {
    [command(Command.SET_MASTER_SLAVE, [0x53])]: hex(encodeStationFrame(Command.SET_MASTER_SLAVE, CODE, [0x53])),
    [command(Command.GET_SYSTEM_VALUE, [0x00, 0x80])]: hex(encodeStationFrame(Command.GET_SYSTEM_VALUE, CODE, [0x00, ...system])),
    [command(Command.GET_TIME)]: hex(encodeStationFrame(Command.GET_TIME, CODE, encodeStationClock({ year: now.getFullYear(),
      month: now.getMonth() + 1, day: now.getDate(), secondsOfDay: now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds(), milliseconds: 0 }, now.getDay()))),
    [command(Command.GET_BACKUP, [0x00, 0x01, 0x00, records.length])]: hex(encodeStationFrame(Command.GET_BACKUP, CODE, [0x00, 0x01, 0x00, ...records])),
    [command(Command.SET_MASTER_SLAVE, [MASTER_DIRECT])]: hex(encodeStationFrame(Command.SET_MASTER_SLAVE, CODE, [MASTER_DIRECT]))
  };
}

test("läs ut en enhet: systemdata, klockan och brickorna i backupminnet med löparna", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await registerAccount(browser, `enheter.${unique()}@exempel.se`, "Enar Enhet");
  const raceId = await createRace(owner, `Enheter ${unique()}`, today(), "Träning");
  await addCourseAndClass(owner, "Lång", "Öppen", "31 32");
  await addEntry(owner, { className: "Öppen", givenName: "Ada", familyName: "Backup", club: "OK Test", card: "7360001" });

  await owner.context().addInitScript(({ table }) => {
    const toHex = (bytes: Uint8Array) => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const fromHex = (text: string) => Uint8Array.from(text.match(/../g)!.map(pair => parseInt(pair, 16)));
    let push: ((bytes: Uint8Array) => void) | undefined;
    const port = {
      readable: new ReadableStream<Uint8Array>({ start(controller) { push = bytes => controller.enqueue(bytes); } }),
      writable: new WritableStream<Uint8Array>({ write(chunk) {
        // Kommandot utan väckningsbyte; svaret i två delar.
        const key = toHex(chunk[0] === 0xff ? chunk.subarray(1) : chunk);
        const reply = table[key];
        if (reply) setTimeout(() => { const bytes = fromHex(reply); push?.(bytes.subarray(0, 4)); push?.(bytes.subarray(4)); }, 5);
      } }),
      open: () => Promise.resolve(), close: () => Promise.resolve(), addEventListener() {}, removeEventListener() {}
    };
    Object.defineProperty(navigator, "serial", { value: { requestPort: () => Promise.resolve(port), getPorts: () => Promise.resolve([]),
      addEventListener() {}, removeEventListener() {} } });
  }, { table: replies([7360001, 8123456]) });

  await owner.goto(`/admin/${raceId}/stations`);
  await expect(owner.getByRole("heading", { name: "Läs ut enheter" })).toBeVisible();
  await expect(owner.getByText(/^Provas:/)).toBeVisible();
  await owner.getByRole("button", { name: "Anslut huvudstation" }).first().click();
  await owner.getByTestId("station-read").click();
  const facts = owner.getByTestId("station-facts");
  await expect(facts).toContainText("200514");
  await expect(facts).toContainText("BSF8");
  await expect(facts).toContainText("Kontroll");
  await expect(facts).toContainText("2022-03-01");
  await expect(facts).toContainText("stämmer med datorn");
  await expect(owner.getByText("Kod 31 finns på tävlingens banor.")).toBeVisible();
  const punches = owner.getByTestId("station-punches");
  await expect(punches.locator("tbody tr")).toHaveCount(2);
  await expect(punches.locator("tbody tr").nth(1)).toContainText("7360001");
  await expect(punches.locator("tbody tr").nth(1)).toContainText("Ada Backup, OK Test");
  await expect(punches.locator("tbody tr").nth(0)).toContainText("Inte i tävlingen");
  await reviewScreenshots(owner, "enheter");
});
