//! Ägaren 2026-11-10 (PLAN.md, grundkartan G1): laserrutorna klipps till kartans område innan Karttapullautin körs, så att
//! körningen går fortare och resultatet inte täcker hela rutorna (2,5 × 2,5 km).
//!
//! `lasclip <in.laz> <ut.laz> <minx> <miny> <maxx> <maxy> [<vatten.bin>]`
//!
//! Punkterna inom rutan (filens egna koordinater, t.ex. SWEREF 99 TM) skrivs till utfilen med samma punktformat. Antalet
//! behållna punkter skrivs på en rad. Hamnar ingen punkt i rutan skrivs ingen fil.
//!
//! Med `<vatten.bin>` skrivs också ett raster över rutan i 2 m-celler: Karttapullautin gör höjdmodell av både mark- och
//! vattenpunkter och säger inte var vattnet är, så sjön blev «blöt mark» och «öppen mark». Filen har samma huvud som
//! Karttapullautins höjdraster (minx, miny, cell som f64; bredd, höjd som u64; allt little endian) och sedan en byte per
//! cell i ordningen x * höjd + y: bit 0 = markpunkt (klass 2) i cellen, bit 1 = vattenpunkt (klass 9).
//!
//! Med ett nionde argument, `<punkter.bin>`, skrivs punkternas statistik i 2 m-celler (se `point_stats`).
//!
//! Med ännu ett argument, `<mark.bin>`, skrivs markens höjd i 1 m-celler (grövre för mycket stora områden; medel av markpunkterna i cellen, NaN där det
//! inte finns någon), med samma huvud och sedan en f32 per cell: geo-arbetaren mäter branternas fallhöjd i den
//! (Kungshatt-kedjan mätte i Lantmäteriets markhöjdmodell 1 m, som görs ur samma laserdata).
use las::{Builder, PointDataBuilder, Reader, Writer};
use std::io::Write;
use std::process::ExitCode;

const CHUNK: u64 = 1_000_000;
const CELL: f64 = 2.0;
const GROUND: u8 = 2;
const WATER: u8 = 9;

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
    let header = Builder::from(reader.header().clone()).into_header()?;
    let mut data = PointDataBuilder::new().for_header(reader.header()).build();
    let mut writer: Option<Writer<_>> = None;
    let mut kept = 0u64;
    let (width, height) = (((max_x - min_x) / CELL).ceil() as usize, ((max_y - min_y) / CELL).ceil() as usize);
    let mut cells = vec![0u8; if args.len() >= 7 { width * height } else { 0 }];
    // Markrastrets cell är 1 m, eller grövre (2, 4 … m) för mycket stora områden, så att minnet räcker.
    let mut dem_cell = 1.0f64;
    while ((max_x - min_x) / dem_cell).ceil() * ((max_y - min_y) / dem_cell).ceil() > 36_000_000.0 {
        dem_cell *= 2.0;
    }
    let (dem_width, dem_height) = (((max_x - min_x) / dem_cell).ceil() as usize, ((max_y - min_y) / dem_cell).ceil() as usize);
    let dem_cells = if args.len() >= 8 { dem_width * dem_height } else { 0 };
    let (mut dem_sum, mut dem_count) = (vec![0f64; dem_cells], vec![0u32; dem_cells]);
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
            if !cells.is_empty() {
                let class = u8::from(point.classification);
                let bit = if class == GROUND { 1 } else if class == WATER { 2 } else { 0 };
                if bit != 0 {
                    let column = (((point.x - min_x) / CELL) as usize).min(width - 1);
                    let row = (((point.y - min_y) / CELL) as usize).min(height - 1);
                    cells[column * height + row] |= bit;
                }
            }
            if dem_cells > 0 && u8::from(point.classification) == GROUND {
                let column = (((point.x - min_x) / dem_cell) as usize).min(dem_width - 1);
                let row = (((point.y - min_y) / dem_cell) as usize).min(dem_height - 1);
                dem_sum[column * dem_height + row] += point.z;
                dem_count[column * dem_height + row] += 1;
            }
            writer.as_mut().expect("skrivaren finns").write_point(point)?;
            kept += 1;
        }
    }
    if let Some(mut writer) = writer {
        writer.close()?;
        if !cells.is_empty() {
            let mut file = std::io::BufWriter::new(std::fs::File::create(&args[6])?);
            for value in [min_x, min_y, CELL] {
                file.write_all(&value.to_le_bytes())?;
            }
            for value in [width as u64, height as u64] {
                file.write_all(&value.to_le_bytes())?;
            }
            file.write_all(&cells)?;
            file.flush()?;
        }
        if dem_cells > 0 && args.len() == 9 {
            point_stats(&args[0], &args[8], (min_x, min_y, max_x, max_y), dem_cell, dem_width, dem_height, &dem_sum, &dem_count)?;
        }
        if dem_cells > 0 {
            let mut file = std::io::BufWriter::new(std::fs::File::create(&args[7])?);
            for value in [min_x, min_y, dem_cell] {
                file.write_all(&value.to_le_bytes())?;
            }
            for value in [dem_width as u64, dem_height as u64] {
                file.write_all(&value.to_le_bytes())?;
            }
            for (sum, count) in dem_sum.iter().zip(dem_count.iter()) {
                let z = if *count == 0 { f32::NAN } else { (*sum / f64::from(*count)) as f32 };
                file.write_all(&z.to_le_bytes())?;
            }
            file.flush()?;
        }
    }
    Ok(kept)
}

/// Markens höjd i punkten ur 1 m-rastret; saknas cellen prövas grannarna inom tre celler (närmast först).
fn ground_at(column: usize, row: usize, width: usize, height: usize, sum: &[f64], count: &[u32]) -> Option<f64> {
    for reach in 0..=3i64 {
        let (mut total, mut cells) = (0f64, 0u32);
        for dx in -reach..=reach {
            for dy in -reach..=reach {
                if dx.abs().max(dy.abs()) != reach {
                    continue;
                }
                let (x, y) = (column as i64 + dx, row as i64 + dy);
                if x < 0 || y < 0 || x >= width as i64 || y >= height as i64 {
                    continue;
                }
                let i = x as usize * height + y as usize;
                if count[i] > 0 {
                    total += sum[i] / f64::from(count[i]);
                    cells += 1;
                }
            }
        }
        if cells > 0 {
            return Some(total / f64::from(cells));
        }
    }
    None
}

/// Ägaren 2026-11-11 («egna beräkningar av laserdatat motsvarande Karttapullautin»): punkternas statistik i 2 m-celler, i en
/// andra genomläsning när markrastret är klart. Samma huvud som de andra rastren och sedan åtta f32 per cell (x * höjd + y):
/// högsta höjden över marken (m, NaN utan punkter), antal punkter, antal markpunkter, antal 0,3–1 m, 1–3 m och över 3 m över
/// marken, markpunkternas medelintensitet och markpunkternas spridning kring 1 m-cellens medelhöjd (m). Brus (klass 7 och 18),
/// vatten och punkter mer än 60 m över marken räknas inte.
#[allow(clippy::too_many_arguments)]
fn point_stats(input: &str, output: &str, bounds: (f64, f64, f64, f64), dem_cell: f64, dem_width: usize, dem_height: usize, dem_sum: &[f64],
    dem_count: &[u32]) -> Result<(), Box<dyn std::error::Error>> {
    let (min_x, min_y, max_x, max_y) = bounds;
    let (width, height) = (((max_x - min_x) / CELL).ceil() as usize, ((max_y - min_y) / CELL).ceil() as usize);
    let cells = width * height;
    let mut top = vec![f32::NAN; cells];
    let mut counts = vec![[0u32; 5]; cells];
    let (mut intensity, mut spread) = (vec![0f64; cells], vec![0f64; cells]);
    let mut reader = Reader::from_path(input)?;
    let mut data = PointDataBuilder::new().for_header(reader.header()).build();
    loop {
        if reader.fill_points(CHUNK, &mut data)? == 0 {
            break;
        }
        for point in data.points() {
            let point = point?;
            if point.x < min_x || point.x > max_x || point.y < min_y || point.y > max_y {
                continue;
            }
            let class = u8::from(point.classification);
            if class == 7 || class == 18 || class == WATER {
                continue;
            }
            let dem_column = (((point.x - min_x) / dem_cell) as usize).min(dem_width - 1);
            let dem_row = (((point.y - min_y) / dem_cell) as usize).min(dem_height - 1);
            let Some(ground) = ground_at(dem_column, dem_row, dem_width, dem_height, dem_sum, dem_count) else { continue };
            let above = point.z - ground;
            if above > 60.0 {
                continue;
            }
            let i = (((point.x - min_x) / CELL) as usize).min(width - 1) * height + (((point.y - min_y) / CELL) as usize).min(height - 1);
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
            if above >= 0.3 && above < 1.0 {
                counts[i][2] += 1;
            } else if above >= 1.0 && above < 3.0 {
                counts[i][3] += 1;
            } else if above >= 3.0 {
                counts[i][4] += 1;
            }
        }
    }
    let mut file = std::io::BufWriter::new(std::fs::File::create(output)?);
    for value in [min_x, min_y, CELL] {
        file.write_all(&value.to_le_bytes())?;
    }
    for value in [width as u64, height as u64] {
        file.write_all(&value.to_le_bytes())?;
    }
    for i in 0..cells {
        let ground = counts[i][1];
        let values = [top[i], counts[i][0] as f32, ground as f32, counts[i][2] as f32, counts[i][3] as f32, counts[i][4] as f32,
            if ground == 0 { f32::NAN } else { (intensity[i] / f64::from(ground)) as f32 },
            if ground == 0 { f32::NAN } else { (spread[i] / f64::from(ground)).sqrt() as f32 }];
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
