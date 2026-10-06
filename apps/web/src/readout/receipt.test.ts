import { describe, expect, it, vi } from "vitest";
import { readoutPackageSchema, type ReadoutPackage, type SportidentReadoutPayload } from "@o-tid/contracts";
import { evaluateLocally } from "./evaluate";
import { buildReceipt, qrPath, receiptLink } from "./receipt";
import { DEFAULT_RECEIPT_SETTINGS, loadReceiptSettings, receiptPageCss, saveReceiptSettings } from "./receipt-settings";
import { ids, TEST_CARD, testPackage } from "./test-support";

/** PLAN.md steg 21: kvittot byggs av det lokala beskedet och paketet, utan nät. */
const ORIGIN = "https://o-tid.example";
const PUBLIC_RESULT = "20000000-0000-4000-8000-000000000001";
const PRINTED = new Date("2026-10-01T16:45:00.000Z");
const at = (minutes: number, seconds = 0) => new Date(Date.UTC(2026, 9, 1, 16, minutes, seconds)).toISOString();

function payload(punches: [number, number, number?][], finish: number | undefined, cardNumber = String(TEST_CARD)): SportidentReadoutPayload {
  return { cardNumber, cardType: "SI10", startPunchedAt: at(0), ...(finish !== undefined ? { finishPunchedAt: at(finish) } : {}),
    punches: punches.map(([code, minutes, seconds]) => ({ code, punchedAt: at(minutes, seconds) })), untimedPunchCodes: [],
    frames: ["02ef8300"], simulated: true };
}

function withLinks(pkg: ReadoutPackage, published = true): ReadoutPackage {
  return readoutPackageSchema.parse({ ...pkg, publicLinks: { shortCode: "k7m2xq", published,
    participants: [{ entryId: ids.entry, publicResultId: PUBLIC_RESULT }] } });
}

function clubPackage(): ReadoutPackage {
  const pkg = testPackage();
  return withLinks({ ...pkg, raceSnapshot: { ...pkg.raceSnapshot,
    entries: pkg.raceSnapshot.entries.map((entry) => ({ ...entry, organisationName: "OK Test" })) } });
}

function receiptFor(pkg: ReadoutPackage, readout: SportidentReadoutPayload) {
  return buildReceipt({ verdict: evaluateLocally(readout, pkg), cardNumber: readout.cardNumber, pkg, origin: ORIGIN, printedAt: PRINTED });
}

describe("kvitto efter avläsning", () => {
  it("godkänd: löpare, klass och klubb, tid, sträcktider med sträcka och total, mål och QR-kod till löparens resultat", () => {
    const receipt = receiptFor(clubPackage(), payload([[31, 7, 30], [32, 15], [33, 22, 30]], 30));
    expect(receipt).toMatchObject({ eventName: "Klubbträning", details: "Torsdagsträning · tors 1 okt. 2026", runner: "Anna Berg",
      team: "Lång · OK Test", card: `Bricka ${TEST_CARD}`, symbol: "✓", status: "GODKÄND", result: "30:00", notes: [], lines: [],
      columns: ["", "Kontroll", "Sträcka", "Tid"] });
    expect(receipt.rows).toEqual([
      { index: "1", code: "31", leg: "7:30", total: "7:30" },
      { index: "2", code: "32", leg: "7:30", total: "15:00" },
      { index: "3", code: "33", leg: "7:30", total: "22:30" },
      { index: "", code: "Mål", leg: "7:30", total: "30:00" }
    ]);
    expect(receipt.qr).toEqual({ url: `${ORIGIN}/results/${ids.race}/participants/${PUBLIC_RESULT}`, address: "o-tid.example/t/k7m2xq",
      published: true });
    expect(receipt.printedAt).toBe("Utskrivet 1 okt. 18:45");
  });

  it("felstämplad: orsak och saknade kontroller, sträcktider för det som stämplats och ingen tid som resultat", () => {
    const receipt = receiptFor(clubPackage(), payload([[31, 7, 30], [33, 22, 30]], 30));
    expect(receipt).toMatchObject({ symbol: "✗", status: "FELSTÄMPLAD", notes: ["Saknar kontroll", "Saknar: 32"] });
    expect(receipt.result).toBeUndefined();
    expect(receipt.rows.map((row) => [row.code, row.leg, row.total])).toEqual([["31", "7:30", "7:30"], ["33", "15:00", "22:30"],
      ["Mål", "7:30", "30:00"]]);
  });

  it("utan målstämpling: orsaken och inga sträcktider (resultatmotorn räknar dem bara mellan start och mål)", () => {
    const receipt = receiptFor(clubPackage(), payload([[31, 7], [32, 15], [33, 22]], undefined));
    expect(receipt).toMatchObject({ status: "FELSTÄMPLAD", notes: ["Ingen målstämpling"], rows: [] });
  });

  it("rogaining: summa, kontrollpoäng, straff, tid mot gränsen och de räknade kontrollerna", () => {
    const base = clubPackage();
    const pkg = readoutPackageSchema.parse({ ...base, raceSnapshot: { ...base.raceSnapshot,
      classes: base.raceSnapshot.classes.map((raceClass) => ({ ...raceClass, rogaining: { timeLimitSeconds: 20 * 60, penaltyPointsPerMinute: 2 } })) } });
    const receipt = receiptFor(pkg, payload([[33, 5], [31, 12]], 22, String(TEST_CARD)));
    // Förvalda poäng: kontrollkoden delat med tio (31 och 33 ger 3 p). Två påbörjade minuter för sent à 2 p.
    expect(receipt).toMatchObject({ status: "GODKÄND", result: "2 poäng", columns: ["", "Kontroll", "Poäng", "Tid"],
      lines: [{ label: "Kontrollpoäng", value: "6 p" }, { label: "Straff", value: "−4 p" }, { label: "Tid", value: "22:00 av 20:00" }],
      notes: ["För sen: 2 påbörjade minuter över tidsgränsen"] });
    expect(receipt.rows).toEqual([{ index: "1", code: "33", leg: "3 p", total: "5:00" }, { index: "2", code: "31", leg: "3 p", total: "12:00" }]);
  });

  it("okänd bricka och paket utan länkar: QR-koden leder till tävlingssidan eller resultatlistan", () => {
    const pkg = clubPackage();
    const unknown = receiptFor(pkg, payload([[31, 7]], 30, "7999999"));
    expect(unknown).toMatchObject({ status: "OKÄND BRICKA", card: "Bricka 7999999", rows: [] });
    expect(unknown.runner).toBeUndefined();
    expect(unknown.qr).toEqual({ url: `${ORIGIN}/t/k7m2xq`, address: "o-tid.example/t/k7m2xq", published: true });
    expect(receiptLink(testPackage(), ids.entry, `${ORIGIN}/`)).toEqual({ url: `${ORIGIN}/results/${ids.race}`, address: "o-tid.example/results",
      published: true });
    expect(receiptLink(withLinks(testPackage(), false), ids.entry, ORIGIN).published).toBe(false);
  });

  it("QR-koden skapas lokalt som en SVG-bana med tyst zon", () => {
    const { size, path } = qrPath(`${ORIGIN}/t/k7m2xq`);
    // Version 3 (29 × 29 moduler) och två modulers marginal runt om.
    expect(size).toBe(29 + 4);
    expect(path.startsWith("M2 2h1v1h-1z")).toBe(true);
    expect(qrPath(`${ORIGIN}/t/k7m2xq`).path).toBe(path);
  });

  it("inställningarna sparas per enhet och tål en spärrad lagring", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadReceiptSettings(storage)).toEqual(DEFAULT_RECEIPT_SETTINGS);
    saveReceiptSettings({ auto: true, showQr: false, paperMm: 58 }, storage);
    expect(loadReceiptSettings(storage)).toEqual({ auto: true, showQr: false, paperMm: 58 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
    expect(loadReceiptSettings(blocked)).toEqual(DEFAULT_RECEIPT_SETTINGS);
    saveReceiptSettings(DEFAULT_RECEIPT_SETTINGS, blocked);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    expect(receiptPageCss(80, 378)).toBe("@page { size: 80mm 103mm; margin: 0; }");
  });
});
