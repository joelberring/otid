//! Ägaren 2026-11-10 (PLAN.md, grundkartan G1): laserrutorna klipps till kartans område innan Karttapullautin körs, så att
//! körningen går fortare och resultatet inte täcker hela rutorna (2,5 × 2,5 km).
//!
//! `lasclip <in.laz> <ut.las|ut.laz> <minx> <miny> <maxx> <maxy> [<vatten.bin> [<mark.bin> [<punkter.bin>]]]`
//!
//! Punkterna inom rutan (filens egna koordinater, t.ex. SWEREF 99 TM) skrivs till utfilen med samma punktformat (okomprimerad
//! `.las` när utfilen inte slutar på `.laz`). Antalet behållna punkter skrivs på en rad. Hamnar ingen punkt i rutan skrivs
//! ingen fil.
//!
//! Med `<vatten.bin>` skrivs också ett raster över rutans faktiska punktutbredning i 2 m-celler (rutnätsjusterat till
//! `<minx>/<miny>` + 2 m): Karttapullautin gör höjdmodell av både mark- och vattenpunkter och säger inte var vattnet är, så
//! sjön blev «blöt mark» och «öppen mark». Filen har samma huvud som Karttapullautins höjdraster (minx, miny, cell som f64;
//! bredd, höjd som u64; allt little endian) och sedan en byte per cell i ordningen x * höjd + y: bit 0 = markpunkt (klass 2)
//! i cellen, bit 1 = vattenpunkt (klass 9).
//!
//! Med `<mark.bin>` skrivs markens höjd i 1 m-celler (grövre för mycket stora områden; medel av markpunkterna i cellen, NaN
//! där det inte finns någon), beskuret till rutans faktiska punktutbredning på det globala rutnätet.
//!
//! Med `<punkter.bin>` skrivs punkternas statistik i 2 m-celler (se `point_stats`), läst ur den redan klippta utfilen.
use las::{Bounds, Builder, PointDataBuilder, Reader, Writer};
use std::io::Write;
use std::path::Path;
use std::process::ExitCode;

const CHUNK: u64 = 1_000_000;
const CELL: f64 = 2.0;
const GROUND: u8 = 2;
const WATER: u8 = 9;

#[derive(Clone, Copy, Debug)]
struct GridSpec {
    min_x: f64,
    min_y: f64,
    cell: f64,
    width: usize,
    height: usize,
}

impl GridSpec {
    fn col(&self, x: f64) -> usize {
        (((x - self.min_x) / self.cell) as usize).min(self.width - 1)
    }

    fn row(&self, y: f64) -> usize {
        (((y - self.min_y) / self.cell) as usize).min(self.height - 1)
    }

    /// Uppskattar ett delområde ur LAS-huvudets gränser så att en 2,5 × 2,5 km-ruta inte allokerar hela 45 km²-matrisen.
    fn window_for(&self, bounds: Bounds, max_x: f64, max_y: f64) -> (usize, usize, usize, usize) {
        let populated = bounds.min.x.is_finite()
            && bounds.max.x.is_finite()
            && bounds.min.y.is_finite()
            && bounds.max.y.is_finite()
            && bounds.min.x <= bounds.max.x
            && bounds.min.y <= bounds.max.y
            && (bounds.min.x != 0.0 || bounds.max.x != 0.0 || bounds.min.y != 0.0 || bounds.max.y != 0.0);
        if !populated {
            return (0, 0, self.width, self.height);
        }
        let x0 = bounds.min.x.max(self.min_x);
        let x1 = bounds.max.x.min(max_x);
        let y0 = bounds.min.y.max(self.min_y);
        let y1 = bounds.max.y.min(max_y);
        if x0 > x1 || y0 > y1 {
            return (0, 0, 0, 0);
        }
        let c0 = self.col(x0);
        let c1 = self.col(x1);
        let r0 = self.row(y0);
        let r1 = self.row(y1);
        (c0, r0, c1 - c0 + 1, r1 - r0 + 1)
    }
}

/// Enkel 2D-buffert för ett delområde `(c0..c0+w, r0..r0+h)` som växer till hela globala rutnätet om LAS-huvudet ljög.
struct SubGrid<T: Clone> {
    c0: usize,
    r0: usize,
    w: usize,
    h: usize,
    fill: T,
    data: Vec<T>,
}

impl<T: Clone> SubGrid<T> {
    fn new(window: (usize, usize, usize, usize), fill: T) -> Self {
        let (c0, r0, w, h) = window;
        Self { c0, r0, w, h, data: vec![fill.clone(); w * h], fill }
    }

    fn ensure_contains(&mut self, col: usize, row: usize, global_w: usize, global_h: usize) {
        if col >= self.c0 && col < self.c0 + self.w && row >= self.r0 && row < self.r0 + self.h {
            return;
        }
        let mut expanded = vec![self.fill.clone(); global_w * global_h];
        for c in 0..self.w {
            let src = c * self.h;
            let dst = (self.c0 + c) * global_h + self.r0;
            expanded[dst..dst + self.h].clone_from_slice(&self.data[src..src + self.h]);
        }
        self.c0 = 0;
        self.r0 = 0;
        self.w = global_w;
        self.h = global_h;
        self.data = expanded;
    }

    #[inline]
    fn idx(&self, col: usize, row: usize) -> usize {
        (col - self.c0) * self.h + (row - self.r0)
    }
}

#[derive(Clone, Copy)]
struct CellBox {
    c0: usize,
    c1: usize,
    r0: usize,
    r1: usize,
}

impl CellBox {
    fn include(slot: &mut Option<Self>, col: usize, row: usize) {
        match slot {
            Some(b) => {
                b.c0 = b.c0.min(col);
                b.c1 = b.c1.max(col);
                b.r0 = b.r0.min(row);
                b.r1 = b.r1.max(row);
            }
            None => *slot = Some(Self { c0: col, c1: col, r0: row, r1: row }),
        }
    }

    fn width(self) -> usize {
        self.c1 - self.c0 + 1
    }

    fn height(self) -> usize {
        self.r1 - self.r0 + 1
    }
}

fn write_grid_header<W: Write>(file: &mut W, min_x: f64, min_y: f64, cell: f64, width: usize, height: usize) -> std::io::Result<()> {
    for value in [min_x, min_y, cell] {
        file.write_all(&value.to_le_bytes())?;
    }
    for value in [width as u64, height as u64] {
        file.write_all(&value.to_le_bytes())?;
    }
    Ok(())
}

fn output_header(input_header: &las::Header, output_path: &str) -> Result<las::Header, Box<dyn std::error::Error>> {
    let mut builder = Builder::from(input_header.clone());
    let compressed = Path::new(output_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("laz"));
    builder.point_format.is_compressed = compressed;
    if !compressed {
        builder.vlrs.retain(|vlr| !(vlr.user_id.eq_ignore_ascii_case("laszip encoded") && vlr.record_id == 22204));
    }
    Ok(builder.into_header()?)
}

fn run(args: &[String]) -> Result<u64, Box<dyn std::error::Error>> {
    if args.len() < 6 || args.len() > 9 {
        return Err("Användning: lasclip <in> <ut> <minx> <miny> <maxx> <maxy> [<vatten.bin> [<mark.bin> [<punkter.bin>]]]".into());
    }
    let numbers: Vec<f64> = args[2..6].iter().map(|text| text.parse::<f64>()).collect::<Result<_, _>>()?;
    let (min_x, min_y, max_x, max_y) = (numbers[0], numbers[1], numbers[2], numbers[3]);
    if !(min_x < max_x && min_y < max_y) {
        return Err("Rutan är tom: min ska vara mindre än max".into());
    }
    let mut reader = Reader::from_path(&args[0])?;
    let header = output_header(reader.header(), &args[1])?;
    let input_bounds = reader.header().bounds();
    let mut data = PointDataBuilder::new().for_header(reader.header()).build();
    let mut writer: Option<Writer<_>> = None;
    let mut kept = 0u64;

    let want_water = args.len() >= 7;
    let want_dem = args.len() >= 8;
    let want_points = args.len() == 9;

    let cell_spec = GridSpec {
        min_x,
        min_y,
        cell: CELL,
        width: ((max_x - min_x) / CELL).ceil() as usize,
        height: ((max_y - min_y) / CELL).ceil() as usize,
    };
    // Markrastrets cell är 1 m, eller grövre (2, 4 … m) för mycket stora områden, så att minnet räcker.
    let mut dem_cell = 1.0f64;
    while ((max_x - min_x) / dem_cell).ceil() * ((max_y - min_y) / dem_cell).ceil() > 36_000_000.0 {
        dem_cell *= 2.0;
    }
    let dem_spec = GridSpec {
        min_x,
        min_y,
        cell: dem_cell,
        width: ((max_x - min_x) / dem_cell).ceil() as usize,
        height: ((max_y - min_y) / dem_cell).ceil() as usize,
    };

    let mut cells = SubGrid::new(
        if want_water { cell_spec.window_for(input_bounds, max_x, max_y) } else { (0, 0, 0, 0) },
        0u8,
    );
    let dem_window = if want_dem { dem_spec.window_for(input_bounds, max_x, max_y) } else { (0, 0, 0, 0) };
    let mut dem_sum = SubGrid::new(dem_window, 0f64);
    let mut dem_count = SubGrid::new(dem_window, 0u32);
    let mut cell_box: Option<CellBox> = None;
    let mut dem_box: Option<CellBox> = None;

    loop {
        if reader.fill_points(CHUNK, &mut data)? == 0 {
            break;
        }
        for point in data.points() {
            let point = point?;
            if point.x < min_x || point.x > max_x || point.y < min_y || point.y > max_y {
                continue;
            }
            if writer.is_none() {
                writer = Some(Writer::from_path(&args[1], header.clone())?);
            }
            let class = u8::from(point.classification);
            if want_water || want_points {
                let col = cell_spec.col(point.x);
                let row = cell_spec.row(point.y);
                CellBox::include(&mut cell_box, col, row);
                if want_water {
                    let bit = if class == GROUND { 1 } else if class == WATER { 2 } else { 0 };
                    if bit != 0 {
                        cells.ensure_contains(col, row, cell_spec.width, cell_spec.height);
                        let i = cells.idx(col, row);
                        cells.data[i] |= bit;
                    }
                }
            }
            if want_dem {
                let col = dem_spec.col(point.x);
                let row = dem_spec.row(point.y);
                CellBox::include(&mut dem_box, col, row);
                if class == GROUND {
                    dem_sum.ensure_contains(col, row, dem_spec.width, dem_spec.height);
                    dem_count.ensure_contains(col, row, dem_spec.width, dem_spec.height);
                    let i = dem_sum.idx(col, row);
                    dem_sum.data[i] += point.z;
                    dem_count.data[i] += 1;
                }
            }
            writer.as_mut().expect("skrivaren finns").write_point(point)?;
            kept += 1;
        }
    }

    if let Some(mut writer) = writer {
        writer.close()?;
        if want_water {
            let cbox = cell_box.expect("kept > 0");
            let mut file = std::io::BufWriter::new(std::fs::File::create(&args[6])?);
            write_grid_header(
                &mut file,
                min_x + cbox.c0 as f64 * CELL,
                min_y + cbox.r0 as f64 * CELL,
                CELL,
                cbox.width(),
                cbox.height(),
            )?;
            for col in cbox.c0..=cbox.c1 {
                if col >= cells.c0 && col < cells.c0 + cells.w && cbox.r0 >= cells.r0 && cbox.r1 < cells.r0 + cells.h {
                    let start = cells.idx(col, cbox.r0);
                    file.write_all(&cells.data[start..start + cbox.height()])?;
                } else {
                    for row in cbox.r0..=cbox.r1 {
                        let value = if col >= cells.c0 && col < cells.c0 + cells.w && row >= cells.r0 && row < cells.r0 + cells.h {
                            cells.data[cells.idx(col, row)]
                        } else {
                            0
                        };
                        file.write_all(&[value])?;
                    }
                }
            }
            file.flush()?;
        }
        drop(cells);

        if want_dem {
            let dbox = dem_box.expect("kept > 0");
            let (dw, dh) = (dbox.width(), dbox.height());
            let mut dem_mean = vec![f32::NAN; dw * dh];
            for col in dbox.c0..=dbox.c1 {
                if col < dem_count.c0 || col >= dem_count.c0 + dem_count.w {
                    continue;
                }
                let dst_col = (col - dbox.c0) * dh;
                let r_lo = dbox.r0.max(dem_count.r0);
                let r_hi = dbox.r1.min(dem_count.r0 + dem_count.h - 1);
                for row in r_lo..=r_hi {
                    let si = dem_count.idx(col, row);
                    let count = dem_count.data[si];
                    if count > 0 {
                        dem_mean[dst_col + (row - dbox.r0)] = (dem_sum.data[si] / f64::from(count)) as f32;
                    }
                }
            }
            drop(dem_sum);
            drop(dem_count);

            {
                let mut file = std::io::BufWriter::new(std::fs::File::create(&args[7])?);
                write_grid_header(
                    &mut file,
                    min_x + dbox.c0 as f64 * dem_cell,
                    min_y + dbox.r0 as f64 * dem_cell,
                    dem_cell,
                    dw,
                    dh,
                )?;
                for z in &dem_mean {
                    file.write_all(&z.to_le_bytes())?;
                }
                file.flush()?;
            }

            if want_points {
                let filled = prefill_ground(&dem_mean, dw, dh);
                drop(dem_mean);
                let cbox = cell_box.expect("kept > 0");
                point_stats(&args[1], &args[8], cell_spec, cbox, dem_spec, dbox, &filled)?;
            }
        }
    }
    Ok(kept)
}

/// Förfyller luckor i markrastret upp till tre celler bort (närmaste ringen med data först) en gång före pass 2.
fn prefill_ground(mean: &[f32], width: usize, height: usize) -> Vec<f32> {
    let mut filled = mean.to_vec();
    let (w, h) = (width as isize, height as isize);
    for col in 0..width {
        let base = col * height;
        for row in 0..height {
            let i = base + row;
            if mean[i].is_finite() {
                continue;
            }
            let (cx, cy) = (col as isize, row as isize);
            for reach in 1..=3isize {
                let (mut total, mut cells) = (0f64, 0u32);
                // Över- och underkant av Chebyshev-ringen.
                for dx in -reach..=reach {
                    let x = cx + dx;
                    if x < 0 || x >= w {
                        continue;
                    }
                    let col_base = x as usize * height;
                    for dy in [-reach, reach] {
                        let y = cy + dy;
                        if y >= 0 && y < h {
                            let v = mean[col_base + y as usize];
                            if v.is_finite() {
                                total += f64::from(v);
                                cells += 1;
                            }
                        }
                    }
                }
                // Vänster- och högerkant utan hörnen (redan räknade).
                for dx in [-reach, reach] {
                    let x = cx + dx;
                    if x < 0 || x >= w {
                        continue;
                    }
                    let col_base = x as usize * height;
                    for dy in (-reach + 1)..reach {
                        let y = cy + dy;
                        if y >= 0 && y < h {
                            let v = mean[col_base + y as usize];
                            if v.is_finite() {
                                total += f64::from(v);
                                cells += 1;
                            }
                        }
                    }
                }
                if cells > 0 {
                    filled[i] = (total / f64::from(cells)) as f32;
                    break;
                }
            }
        }
    }
    filled
}

/// Ägaren 2026-11-11 («egna beräkningar av laserdatat motsvarande Karttapullautin»): punkternas statistik i 2 m-celler, i en
/// andra genomläsning ur den redan klippta filen när markrastret är klart. Samma huvud som de andra rastren (beskuret till
/// rutans faktiska punktutbredning på det globala rutnätet) och sedan åtta f32 per cell (x * höjd + y): högsta höjden över
/// marken (m, NaN utan punkter), antal punkter, antal markpunkter, antal 0,3–1 m, 1–3 m och över 3 m över marken,
/// markpunkternas medelintensitet och markpunkternas spridning kring 1 m-cellens medelhöjd (m). Brus (klass 7 och 18),
/// vatten och punkter mer än 60 m över marken räknas inte.
fn point_stats(
    clipped_input: &str,
    output: &str,
    cell_spec: GridSpec,
    cbox: CellBox,
    dem_spec: GridSpec,
    dbox: CellBox,
    filled_dem: &[f32],
) -> Result<(), Box<dyn std::error::Error>> {
    let (width, height) = (cbox.width(), cbox.height());
    let (dem_w, dem_h) = (dbox.width(), dbox.height());
    let cells = width * height;
    let mut top = vec![f32::NAN; cells];
    let mut counts = vec![[0u32; 5]; cells];
    let (mut intensity, mut spread) = (vec![0f64; cells], vec![0f64; cells]);

    let mut reader = Reader::from_path(clipped_input)?;
    let mut data = PointDataBuilder::new().for_header(reader.header()).build();
    loop {
        if reader.fill_points(CHUNK, &mut data)? == 0 {
            break;
        }
        for point in data.points() {
            let point = point?;
            let class = u8::from(point.classification);
            if class == 7 || class == 18 || class == WATER {
                continue;
            }
            let dem_col = dem_spec.col(point.x).saturating_sub(dbox.c0).min(dem_w - 1);
            let dem_row = dem_spec.row(point.y).saturating_sub(dbox.r0).min(dem_h - 1);
            let ground = filled_dem[dem_col * dem_h + dem_row];
            if !ground.is_finite() {
                continue;
            }
            let above = point.z - f64::from(ground);
            if above > 60.0 {
                continue;
            }
            let col = cell_spec.col(point.x).saturating_sub(cbox.c0).min(width - 1);
            let row = cell_spec.row(point.y).saturating_sub(cbox.r0).min(height - 1);
            let i = col * height + row;
            counts[i][0] += 1;
            if class == GROUND {
                counts[i][1] += 1;
                intensity[i] += f64::from(point.intensity);
                spread[i] += above * above;
                if top[i].is_nan() {
                    top[i] = 0.0;
                }
                continue;
            }
            if top[i].is_nan() || above as f32 > top[i] {
                top[i] = above.max(0.0) as f32;
            }
            if (0.3..1.0).contains(&above) {
                counts[i][2] += 1;
            } else if (1.0..3.0).contains(&above) {
                counts[i][3] += 1;
            } else if above >= 3.0 {
                counts[i][4] += 1;
            }
        }
    }

    let mut file = std::io::BufWriter::new(std::fs::File::create(output)?);
    write_grid_header(
        &mut file,
        cell_spec.min_x + cbox.c0 as f64 * CELL,
        cell_spec.min_y + cbox.r0 as f64 * CELL,
        CELL,
        width,
        height,
    )?;
    for i in 0..cells {
        let ground = counts[i][1];
        let values = [
            top[i],
            counts[i][0] as f32,
            ground as f32,
            counts[i][2] as f32,
            counts[i][3] as f32,
            counts[i][4] as f32,
            if ground == 0 { f32::NAN } else { (intensity[i] / f64::from(ground)) as f32 },
            if ground == 0 { f32::NAN } else { (spread[i] / f64::from(ground)).sqrt() as f32 },
        ];
        for value in values {
            file.write_all(&value.to_le_bytes())?;
        }
    }
    file.flush()?;
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(kept) => {
            println!("{kept}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("lasclip: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/laser")
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("otid-lasclip-test-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read_header(bytes: &[u8]) -> (f64, f64, f64, u64, u64) {
        let f64_at = |o: usize| f64::from_le_bytes(bytes[o..o + 8].try_into().unwrap());
        let u64_at = |o: usize| u64::from_le_bytes(bytes[o..o + 8].try_into().unwrap());
        (f64_at(0), f64_at(8), f64_at(16), u64_at(24), u64_at(32))
    }

    fn read_f32s(bytes: &[u8]) -> Vec<f32> {
        bytes[40..].chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect()
    }

    /// Referensfunktion (tidigare 49-grannars per-punkt-sökning) för paritetstest mot `prefill_ground`.
    fn reference_ground_at(col: usize, row: usize, width: usize, height: usize, mean: &[f32]) -> Option<f32> {
        for reach in 0..=3i64 {
            let (mut total, mut cells) = (0f64, 0u32);
            for dx in -reach..=reach {
                for dy in -reach..=reach {
                    if dx.abs().max(dy.abs()) != reach {
                        continue;
                    }
                    let (x, y) = (col as i64 + dx, row as i64 + dy);
                    if x < 0 || y < 0 || x >= width as i64 || y >= height as i64 {
                        continue;
                    }
                    let v = mean[x as usize * height + y as usize];
                    if v.is_finite() {
                        total += f64::from(v);
                        cells += 1;
                    }
                }
            }
            if cells > 0 {
                return Some((total / f64::from(cells)) as f32);
            }
        }
        None
    }

    #[test]
    fn prefill_ground_matches_reference_ring_search() {
        let (w, h) = (17, 13);
        let mut mean = vec![f32::NAN; w * h];
        for &(x, y, z) in &[(0, 0, 10.0), (5, 5, 20.5), (6, 5, 21.5), (12, 9, 30.0), (16, 12, 40.0)] {
            mean[x * h + y] = z;
        }
        let filled = prefill_ground(&mean, w, h);
        for x in 0..w {
            for y in 0..h {
                let got = filled[x * h + y];
                match reference_ground_at(x, y, w, h, &mean) {
                    Some(exp) => assert!((got - exp).abs() < 1e-6, "({x},{y}): got {got} != exp {exp}"),
                    None => assert!(got.is_nan(), "({x},{y}): expected NaN, got {got}"),
                }
            }
        }
    }

    #[test]
    fn clips_laz_and_las_with_identical_points_and_bins() {
        let dir = temp_dir("las-vs-laz");
        let input = fixture_dir().join("kungshatt-300m.laz");
        let laz_out = dir.join("out.laz");
        let las_out = dir.join("out.las");
        let args_for = |out: &Path, tag: &str| -> Vec<String> {
            vec![
                input.to_string_lossy().into(),
                out.to_string_lossy().into(),
                "664880".into(),
                "6576500".into(),
                "665080".into(),
                "6576700".into(),
                dir.join(format!("v-{tag}.bin")).to_string_lossy().into(),
                dir.join(format!("m-{tag}.bin")).to_string_lossy().into(),
                dir.join(format!("p-{tag}.bin")).to_string_lossy().into(),
            ]
        };
        let kept_laz = run(&args_for(&laz_out, "laz")).unwrap();
        let kept_las = run(&args_for(&las_out, "las")).unwrap();
        assert_eq!(kept_laz, kept_las);
        assert!(kept_laz > 50_000 && kept_laz < 239_966);

        // .las ska vara okomprimerad och utan laszip-VLR, med exakt samma punkter som .laz.
        let mut r_laz = Reader::from_path(&laz_out).unwrap();
        let mut r_las = Reader::from_path(&las_out).unwrap();
        assert!(r_laz.header().point_format().is_compressed);
        assert!(!r_las.header().point_format().is_compressed);
        assert!(!r_las.header().vlrs().iter().any(|v| v.user_id.eq_ignore_ascii_case("laszip encoded")));
        assert_eq!(r_laz.header().number_of_points(), kept_laz);
        assert_eq!(r_las.header().number_of_points(), kept_las);
        assert!(std::fs::metadata(&las_out).unwrap().len() > std::fs::metadata(&laz_out).unwrap().len());

        let read_sample = |reader: &mut Reader| -> Vec<(f64, f64, f64, u16, u8)> {
            let mut buf = PointDataBuilder::new().for_header(reader.header()).build();
            reader.fill_points(500, &mut buf).unwrap();
            buf.points().map(|p| { let p = p.unwrap(); (p.x, p.y, p.z, p.intensity, u8::from(p.classification)) }).collect()
        };
        let pts_laz = read_sample(&mut r_laz);
        let pts_las = read_sample(&mut r_las);
        assert_eq!(pts_laz.len(), 500);
        assert_eq!(pts_laz, pts_las);

        // Alla tre binärfiler ska vara bit-identiska mellan .laz- och .las-utfil.
        for prefix in ["v", "m", "p"] {
            let a = std::fs::read(dir.join(format!("{prefix}-laz.bin"))).unwrap();
            let b = std::fs::read(dir.join(format!("{prefix}-las.bin"))).unwrap();
            assert_eq!(a, b, "{prefix}.bin skilde sig mellan .laz och .las");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn crops_bins_to_tile_extent_aligned_to_global_grid() {
        let dir = temp_dir("crop");
        let input = fixture_dir().join("kungshatt-300m.laz");
        let out = dir.join("out.las");
        // Stor 6 × 6 km global klippruta runt 300 × 300 m-rutan: binärfilerna ska beskäras till ~300 × 300 m.
        let args: Vec<String> = vec![
            input.to_string_lossy().into(),
            out.to_string_lossy().into(),
            "662000".into(),
            "6574000".into(),
            "668000".into(),
            "6580000".into(),
            dir.join("v.bin").to_string_lossy().into(),
            dir.join("m.bin").to_string_lossy().into(),
            dir.join("p.bin").to_string_lossy().into(),
        ];
        let kept = run(&args).unwrap();
        assert_eq!(kept, 239_966);

        let v = std::fs::read(dir.join("v.bin")).unwrap();
        let (vx, vy, vc, vw, vh) = read_header(&v);
        assert_eq!((vx, vy, vc), (664_780.0, 6_576_500.0, 2.0));
        assert!((150..=151).contains(&vw) && (150..=151).contains(&vh));
        assert_eq!((vx - 662_000.0) % vc, 0.0);
        assert_eq!((vy - 6_574_000.0) % vc, 0.0);
        assert_eq!(v.len(), 40 + (vw * vh) as usize);

        let m = std::fs::read(dir.join("m.bin")).unwrap();
        let (mx, my, mc, mw, mh) = read_header(&m);
        assert_eq!((mx, my, mc), (664_780.0, 6_576_500.0, 1.0));
        assert!((300..=301).contains(&mw) && (300..=301).contains(&mh));
        assert_eq!(m.len(), 40 + (mw * mh * 4) as usize);

        let p = std::fs::read(dir.join("p.bin")).unwrap();
        let (px, py, pc, pw, ph) = read_header(&p);
        assert_eq!((px, py, pc, pw, ph), (vx, vy, vc, vw, vh));
        assert_eq!(p.len(), 40 + (pw * ph * 8 * 4) as usize);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_writing_files_when_clip_has_no_points() {
        let dir = temp_dir("empty");
        let input = fixture_dir().join("kungshatt-300m.laz");
        let out = dir.join("out.las");
        let args: Vec<String> = vec![
            input.to_string_lossy().into(),
            out.to_string_lossy().into(),
            "700000".into(),
            "6600000".into(),
            "700500".into(),
            "6600500".into(),
            dir.join("v.bin").to_string_lossy().into(),
            dir.join("m.bin").to_string_lossy().into(),
            dir.join("p.bin").to_string_lossy().into(),
        ];
        assert_eq!(run(&args).unwrap(), 0);
        assert!(!out.exists() && !dir.join("v.bin").exists() && !dir.join("m.bin").exists() && !dir.join("p.bin").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn matches_kungshatt_mark_bin_fixture_exactly() {
        let dir = temp_dir("parity");
        let input = fixture_dir().join("kungshatt-300m.laz");
        let args: Vec<String> = vec![
            input.to_string_lossy().into(),
            dir.join("out.las").to_string_lossy().into(),
            "664780".into(),
            "6576500".into(),
            "665080".into(),
            "6576800".into(),
            dir.join("v.bin").to_string_lossy().into(),
            dir.join("m.bin").to_string_lossy().into(),
            dir.join("p.bin").to_string_lossy().into(),
        ];
        run(&args).unwrap();
        let got = std::fs::read(dir.join("m.bin")).unwrap();
        // Packa upp fixtures/laser/kungshatt-300m/mark.bin.gz via gzip-kommandot (inga extra crate-beroenden i Cargo.toml).
        let ref_bytes = std::process::Command::new("gzip")
            .args(["-dc", fixture_dir().join("kungshatt-300m/mark.bin.gz").to_str().unwrap()])
            .output()
            .unwrap();
        assert!(ref_bytes.status.success());
        assert_eq!(got.len(), ref_bytes.stdout.len());
        assert_eq!(&got[..40], &ref_bytes.stdout[..40]);
        let got_z = read_f32s(&got);
        let ref_z = read_f32s(&ref_bytes.stdout);
        for (i, (&a, &b)) in got_z.iter().zip(ref_z.iter()).enumerate() {
            assert_eq!(a.is_nan(), b.is_nan(), "NaN mismatch at {i}");
            if a.is_finite() {
                assert!((a - b).abs() < 1e-6, "value mismatch at {i}: {a} vs {b}");
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
