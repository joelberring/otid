import { crc32, deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Syntetiska arkiv för testerna (ADR-0194): zip-filer byggs när testet körs ur repots påhittade testkartor
 * (`fixtures/maps/*.omap`, `fixtures/course-setting/kartfil.ppen`, `fixtures/iof/course-file-kartfil.xml`). Inga riktiga
 * kartor och inga zip-filer checkas in.
 */
export interface ZipInput { readonly name: string; readonly data: Uint8Array; readonly store?: boolean }

/** En zip med UTF-8-namn; `zip64` skriver ZIP64-fälten och ZIP64-slutet (som Google Drive gör för stora arkiv). */
export function buildZip(entries: readonly ZipInput[], options: { zip64?: boolean; utf8Flag?: boolean } = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const zip64 = options.zip64 === true;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = deflateRawSync(entry.data);
    const stored = entry.store === true || deflated.byteLength >= entry.data.byteLength;
    const body = stored ? Buffer.from(entry.data) : deflated;
    const crc = crc32(entry.data) >>> 0;
    const flags = options.utf8Flag === false ? 0 : 0x0800;
    const extra = zip64 ? Buffer.alloc(4 + 24) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(entry.data.byteLength), 4); extra.writeBigUInt64LE(BigInt(body.byteLength), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(zip64 ? 45 : 20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(zip64 ? 0xffffffff : body.byteLength, 18); local.writeUInt32LE(zip64 ? 0xffffffff : entry.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26); local.writeUInt16LE(0, 28);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(zip64 ? 45 : 20, 4); header.writeUInt16LE(zip64 ? 45 : 20, 6);
    header.writeUInt16LE(flags, 8); header.writeUInt16LE(stored ? 0 : 8, 10); header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(zip64 ? 0xffffffff : body.byteLength, 20); header.writeUInt32LE(zip64 ? 0xffffffff : entry.data.byteLength, 24);
    header.writeUInt16LE(name.byteLength, 28); header.writeUInt16LE(extra.byteLength, 30);
    header.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    parts.push(local, name, body);
    central.push(header, name, extra);
    offset += 30 + name.byteLength + body.byteLength;
  }
  const directory = Buffer.concat(central);
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24); record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(directory.byteLength), 40); record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(offset + directory.byteLength), 8); locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : entries.length, 8); end.writeUInt16LE(zip64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : directory.byteLength, 12); end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...parts, directory, ...tail, end]);
}

const fixture = (path: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/${path}`, import.meta.url)));

/** Den påhittade kartan, och en "reviderad" version av den (annan anteckning, samma georeferens eller flyttad). */
export function syntheticMap(revision: 0 | 1 | 2 = 0): Buffer {
  const text = fixture("maps/kartfil.omap").toString("utf8");
  if (revision === 0) return Buffer.from(text, "utf8");
  const noted = text.replace(/<notes>[^<]*<\/notes>/, `<notes>Syntetisk testkarta, revision ${revision}.</notes>`);
  // Revision 2 har en annan referenspunkt (kartan är flyttad 100 m österut i koordinatsystemet).
  return Buffer.from(revision === 2 ? noted.replace('ref_point x="675000"', 'ref_point x="675100"') : noted, "utf8");
}

/** En .ppen (den påhittade banläggningen) som pekar på `mapPath`. */
export function syntheticPpen(mapPath: string, title = "Träning"): Buffer {
  const text = fixture("course-setting/kartfil.ppen").toString("utf8");
  const escaped = mapPath.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(text.replace(/(<map\b[^>]*>)[^<]*(<\/map>)/, `$1${escaped}$2`).replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`), "utf8");
}

export const syntheticCourseData = (): Buffer => fixture("iof/course-file-kartfil.xml");
/** En annan påhittad karta (vägvalstestets). */
export const syntheticOtherMap = (): Buffer => fixture("maps/vagval.omap");

/**
 * Två år, fyra träningar och en karta som delas: Skogen ligger i 2019-04-02 och används av 2019-06-04 (banorna utan karta i
 * mappen, en Windows-sökväg), en ny version av Skogen 2020 (samma georeferens), en CourseData med kartan i samma mapp och en
 * mapp med bara PDF och Excel (hoppas över).
 */
export function syntheticYearZips(): { name: string; data: Buffer }[] {
  const pdf = Buffer.from("%PDF-1.4\n% påhittad inbjudan\n", "utf8");
  const xlsx = Buffer.from("PK påhittad deltagarlista", "utf8");
  const zip2019 = buildZip([
    { name: "2019/04-02 Skogen [Anna]/Skogen.omap", data: syntheticMap(0) },
    { name: "2019/04-02 Skogen [Anna]/Skogen Rävorientering.ppen", data: syntheticPpen("C:\\OL\\Kartor\\Skogen.omap", "Rävorientering") },
    { name: "2019/04-02 Skogen [Anna]/Inbjudan.pdf", data: pdf },
    { name: "2019/06-04 Ängen [Per] /KepsOL Ängen - Gul.ppen", data: syntheticPpen("C:\\Users\\per\\OL\\Skogen.omap", "KepsOL") },
    { name: "2019/06-04 Ängen [Per] /Deltagare.xlsx", data: xlsx }
  ]);
  const zip2020 = buildZip([
    { name: "2020/05-21 Parken [Kim]/Parken.omap", data: syntheticOtherMap() },
    { name: "2020/05-21 Parken [Kim]/Sprintträning Parken.xml", data: syntheticCourseData() },
    { name: "2020/09-01 Skogen natt [Anna]/Skogen 2020-08-15 V2.omap", data: syntheticMap(1) },
    { name: "2020/09-01 Skogen natt [Anna]/Nattstjärna.ppen", data: syntheticPpen("D:\\Kartor\\Skogen 2020-08-15 V2.omap", "Nattstjärna") },
    { name: "2020/10-10 Klubbmöte/Protokoll.pdf", data: pdf }
  ], { zip64: true });
  return [{ name: "2019-20261102T210604Z-1-001.zip", data: zip2019 }, { name: "2020-20261102T210604Z-1-001.zip", data: zip2020 }];
}
