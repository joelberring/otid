import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { crc32 } from "node:zlib";

/**
 * Ett litet Marktäcke som Lantmäteriets (G8), för testerna: en GeoPackage (tabellerna `mark` och `sankmark` med
 * `objekttyp` och geometrin som GeoPackage-WKB i SWEREF 99 TM) i en zip. Ytorna är kvadrater `[x, y, sida]` per objekttyp.
 */
export interface FakeSquare { readonly table: "mark" | "sankmark"; readonly type: string; readonly x: number; readonly y: number; readonly side: number }

/** GeoPackage-geometri: huvudet «GP» utan ruta, sedan WKB PolygonZ med stora änden först (som Lantmäteriets filer). */
function polygonBlob({ x, y, side }: FakeSquare): Buffer {
  const ring = [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]];
  const blob = Buffer.alloc(8 + 1 + 4 + 4 + 4 + ring.length * 24);
  blob.write("GP", 0, "ascii"); blob.writeUInt8(0, 2); blob.writeUInt8(0, 3); blob.writeInt32BE(3006, 4);
  let at = 8;
  blob.writeUInt8(0, at); at += 1;
  blob.writeUInt32BE(1003, at); at += 4;
  blob.writeUInt32BE(1, at); at += 4;
  blob.writeUInt32BE(ring.length, at); at += 4;
  for (const [px, py] of ring) { blob.writeDoubleBE(px!, at); blob.writeDoubleBE(py!, at + 8); blob.writeDoubleBE(0, at + 16); at += 24; }
  return blob;
}

export function fakeGpkg(squares: readonly FakeSquare[]): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "otid-gpkg-")), path = join(dir, "marktacke.gpkg");
  try {
    const db = new DatabaseSync(path);
    db.exec("create table gpkg_contents (table_name text primary key, data_type text, srs_id integer);"
      + "create table gpkg_geometry_columns (table_name text, column_name text, geometry_type_name text, srs_id integer, z integer, m integer);");
    for (const table of ["mark", "sankmark"] as const) {
      db.exec(`create table ${table} (fid integer primary key, geom blob, objekttyp text);`);
      db.prepare("insert into gpkg_contents values (?, 'features', 3006)").run(table);
      db.prepare("insert into gpkg_geometry_columns values (?, 'geom', 'POLYGON', 3006, 1, 0)").run(table);
      const insert = db.prepare(`insert into ${table} (geom, objekttyp) values (?, ?)`);
      for (const square of squares.filter(row => row.table === table)) insert.run(polygonBlob(square), square.type);
    }
    db.close();
    return readFileSync(path);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** En zip med en fil, lagrad utan packning. */
export function zipOf(name: string, data: Buffer): Buffer {
  const file = Buffer.from(name, "utf8"), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(file.length, 28); central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + file.length, 12); end.writeUInt32LE(30 + file.length + data.length, 16);
  return Buffer.concat([local, file, data, central, file, end]);
}
