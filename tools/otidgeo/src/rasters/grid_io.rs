//! Binary grid I/O (`mark.bin`, `vatten.bin`, `punkter.bin`, `vegetationsklasser.png`),
//! allocation-free Sub-filtered (Filter Type 1) RGBA PNG writer, and compact DXF R12 writer.

use crate::bench_io::read_rgba_png;
use crate::rasters::geom::{mask_rings, nest_polygons, simplify, write_water_geojson};
use crate::types::WorldTransform;
use rayon::prelude::*;
use std::fs::File;
use std::io::{BufWriter, Read, Write};
use std::path::Path;

pub const POINT_BANDS: usize = 8;
const WATER_GROUND_BIT: u8 = 1;
const WATER_WATER_BIT: u8 = 2;

/// Matches JavaScript `Math.round(x)` (half toward +infinity).
#[inline]
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// 40-byte little-endian header shared by `mark*.bin`, `vatten*.bin`, and `punkter*.bin`.
#[derive(Clone, Copy, Debug)]
pub struct BinHeader {
    pub min_x: f64,
    pub min_y: f64,
    pub cell: f64,
    pub width: usize,
    pub height: usize,
}

fn parse_header(buf: &[u8], label: &str) -> Result<BinHeader, String> {
    if buf.len() < 40 {
        return Err(format!("{label} is shorter than 40 bytes"));
    }
    let min_x = f64::from_le_bytes(buf[0..8].try_into().unwrap());
    let min_y = f64::from_le_bytes(buf[8..16].try_into().unwrap());
    let cell = f64::from_le_bytes(buf[16..24].try_into().unwrap());
    let width = u64::from_le_bytes(buf[24..32].try_into().unwrap()) as usize;
    let height = u64::from_le_bytes(buf[32..40].try_into().unwrap()) as usize;
    if !(cell.is_finite() && cell > 0.0) || width == 0 || height == 0 {
        return Err(format!("{label} has invalid header dimensions"));
    }
    Ok(BinHeader { min_x, min_y, cell, width, height })
}

fn read_bin_header(path: &Path, label: &str) -> Result<BinHeader, String> {
    let mut f = File::open(path).map_err(|e| format!("Failed opening {}: {e}", path.display()))?;
    let mut buf = [0u8; 40];
    f.read_exact(&mut buf).map_err(|e| format!("Failed reading header of {}: {e}", path.display()))?;
    parse_header(&buf, label)
}

fn union_headers(headers: &[BinHeader], label: &str) -> Result<BinHeader, String> {
    let first = *headers.first().ok_or_else(|| format!("No {label} files provided"))?;
    let mut min_x = first.min_x;
    let mut min_y = first.min_y;
    let mut max_x = first.min_x + first.width as f64 * first.cell;
    let mut max_y = first.min_y + first.height as f64 * first.cell;
    for h in &headers[1..] {
        if (h.cell - first.cell).abs() > 1e-9 {
            return Err(format!("{label} tiles have mismatched cell size"));
        }
        min_x = min_x.min(h.min_x);
        min_y = min_y.min(h.min_y);
        max_x = max_x.max(h.min_x + h.width as f64 * h.cell);
        max_y = max_y.max(h.min_y + h.height as f64 * h.cell);
    }
    let width = js_round((max_x - min_x) / first.cell) as usize;
    let height = js_round((max_y - min_y) / first.cell) as usize;
    if width == 0 || height == 0 {
        return Err(format!("{label} union grid is empty"));
    }
    Ok(BinHeader { min_x, min_y, cell: first.cell, width, height })
}

/// Column-major 1 m ground elevation grid (`index = x * height + y`, `y` increasing north).
/// `min_x`, `min_y` denote the SW corner of cell `(0, 0)` (exact `lasclip` / `geo-cliffs.ts` convention).
#[derive(Clone, Debug)]
pub struct GroundGrid {
    pub min_x: f64,
    pub min_y: f64,
    pub cell: f64,
    pub width: usize,
    pub height: usize,
    pub z: Vec<f32>,
}

impl GroundGrid {
    #[inline]
    pub fn world_file(&self) -> String {
        world_file_corner(self.min_x, self.min_y, self.cell, self.height)
    }

    #[inline]
    pub fn cell_center(&self, x: usize, y: usize) -> [f64; 2] {
        [self.min_x + (x as f64 + 0.5) * self.cell, self.min_y + (y as f64 + 0.5) * self.cell]
    }

    #[inline]
    pub fn height_at(&self, x: f64, y: f64) -> f64 {
        let col = ((x - self.min_x) / self.cell).floor() as isize;
        let row = ((y - self.min_y) / self.cell).floor() as isize;
        if col < 0 || row < 0 || (col as usize) >= self.width || (row as usize) >= self.height {
            f64::NAN
        } else {
            f64::from(self.z[col as usize * self.height + row as usize])
        }
    }

    /// Evaluates a predicate at the center of every cell (matches `geo-steps.ts` `maskOf`).
    pub fn mask_of<F: Fn(f64, f64) -> bool + Sync>(&self, pred: F) -> Vec<u8> {
        let h = self.height;
        let mut mask = vec![0u8; self.width * h];
        mask.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
            let wx = self.min_x + (x as f64 + 0.5) * self.cell;
            for (y, dst) in col.iter_mut().enumerate() {
                if pred(wx, self.min_y + (y as f64 + 0.5) * self.cell) {
                    *dst = 1;
                }
            }
        });
        mask
    }

    #[inline]
    pub fn lookup_mask(&self, mask: &[u8], x: f64, y: f64) -> bool {
        let col = ((x - self.min_x) / self.cell).floor() as isize;
        let row = ((y - self.min_y) / self.cell).floor() as isize;
        col >= 0
            && row >= 0
            && (col as usize) < self.width
            && (row as usize) < self.height
            && mask[col as usize * self.height + row as usize] == 1
    }
}

/// World file where `(min_x, min_y)` is the SW corner of cell `(0, 0)`.
pub fn world_file_corner(min_x: f64, min_y: f64, cell: f64, height: usize) -> String {
    format!("{cell}\n0\n0\n{}\n{}\n{}\n", -cell, min_x + cell * 0.5, min_y + (height as f64 - 0.5) * cell)
}

/// World file where `(min_x_center, min_y_center)` is the center of cell `(0, 0)`.
pub fn world_file_center(min_x_center: f64, min_y_center: f64, cell: f64, height: usize) -> String {
    format!("{cell}\n0\n0\n{}\n{min_x_center}\n{}\n", -cell, min_y_center + cell * (height as f64 - 1.0))
}

/// Reads and merges one or more `mark*.bin` files and runs `gap_fill_rounds` of 3x3 gap fill (`n >= 2`).
pub fn load_ground_grids(paths: &[impl AsRef<Path>], gap_fill_rounds: usize) -> Result<GroundGrid, String> {
    let headers: Vec<BinHeader> = paths
        .iter()
        .map(|p| read_bin_header(p.as_ref(), "Ground grid"))
        .collect::<Result<_, _>>()?;
    let union = union_headers(&headers, "Ground grids")?;
    let size = union.width.checked_mul(union.height).ok_or("Ground grid size overflow")?;
    if size > 60_000_000 {
        return Err("Ground grid exceeds 60M cells".into());
    }
    let mut sum = vec![0.0f64; size];
    let mut count = vec![0u16; size];

    for (path, h) in paths.iter().zip(headers.iter()) {
        let bytes = std::fs::read(path.as_ref())
            .map_err(|e| format!("Failed reading {}: {e}", path.as_ref().display()))?;
        let expected = 40 + h.width * h.height * 4;
        if bytes.len() != expected {
            return Err(format!("{} has size {}, expected {expected}", path.as_ref().display(), bytes.len()));
        }
        let dx = js_round((h.min_x - union.min_x) / union.cell) as isize;
        let dy = js_round((h.min_y - union.min_y) / union.cell) as isize;
        if (h.min_x - (union.min_x + dx as f64 * union.cell)).abs() > 1e-4 * union.cell
            || (h.min_y - (union.min_y + dy as f64 * union.cell)).abs() > 1e-4 * union.cell
        {
            return Err("Ground grids are not aligned to the same cell lattice".into());
        }
        let x0 = (-dx).max(0) as usize;
        let x1 = h.width.min((union.width as isize - dx).max(0) as usize);
        let y0 = (-dy).max(0) as usize;
        let y1 = h.height.min((union.height as isize - dy).max(0) as usize);
        let payload = &bytes[40..];
        for x in x0..x1 {
            let src_base = x * h.height;
            let dst_base = (x as isize + dx) as usize * union.height;
            for y in y0..y1 {
                let off = (src_base + y) * 4;
                let v = f32::from_le_bytes(payload[off..off + 4].try_into().unwrap());
                if v.is_finite() {
                    let dst = (dst_base as isize + dy) as usize + y;
                    sum[dst] += f64::from(v);
                    count[dst] = count[dst].saturating_add(1);
                }
            }
        }
    }

    let mut z = vec![f32::NAN; size];
    let mut has_gap = false;
    for i in 0..size {
        if count[i] > 0 {
            z[i] = (sum[i] / f64::from(count[i])) as f32;
        } else {
            has_gap = true;
        }
    }
    drop(sum);
    drop(count);

    if has_gap && gap_fill_rounds > 0 {
        let (w, h) = (union.width, union.height);
        let mut next = vec![f32::NAN; size];
        for _ in 0..gap_fill_rounds {
            let filled_any = std::sync::atomic::AtomicBool::new(false);
            next.par_chunks_mut(h).enumerate().for_each(|(x, dst_col)| {
                let mut col_filled = false;
                let x_lo = x.saturating_sub(1);
                let x_hi = (x + 1).min(w - 1);
                for y in 0..h {
                    let cur = z[x * h + y];
                    if cur.is_finite() {
                        dst_col[y] = cur;
                        continue;
                    }
                    let y_lo = y.saturating_sub(1);
                    let y_hi = (y + 1).min(h - 1);
                    let mut total = 0.0f64;
                    let mut n = 0u32;
                    for nx in x_lo..=x_hi {
                        let base = nx * h;
                        for ny in y_lo..=y_hi {
                            let val = z[base + ny];
                            if val.is_finite() {
                                total += f64::from(val);
                                n += 1;
                            }
                        }
                    }
                    if n >= 2 {
                        dst_col[y] = (total / f64::from(n)) as f32;
                        col_filled = true;
                    } else {
                        dst_col[y] = f32::NAN;
                    }
                }
                if col_filled {
                    filled_any.store(true, std::sync::atomic::Ordering::Relaxed);
                }
            });
            std::mem::swap(&mut z, &mut next);
            if !filled_any.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
        }
    }

    Ok(GroundGrid { min_x: union.min_x, min_y: union.min_y, cell: union.cell, width: union.width, height: union.height, z })
}

/// Merged water classification grid (`vatten*.bin`, 2 m cells) and computed binary water mask.
pub struct WaterData {
    pub min_x: f64,
    pub min_y: f64,
    pub cell: f64,
    pub width: usize,
    pub height: usize,
    pub mask: Vec<u8>,
    pub water_ha: f64,
    pub water_areas: usize,
}

impl WaterData {
    #[inline]
    pub fn is_water(&self, x: f64, y: f64) -> bool {
        let col = ((x - self.min_x) / self.cell).floor() as isize;
        let row = ((y - self.min_y) / self.cell).floor() as isize;
        col >= 0
            && row >= 0
            && (col as usize) < self.width
            && (row as usize) < self.height
            && self.mask[col as usize * self.height + row as usize] == 1
    }
}

fn water_components(mask: &[u8], w: usize, h: usize, mut each: impl FnMut(&[usize], bool)) {
    let mut seen = vec![0u8; mask.len()];
    let mut stack = Vec::new();
    let mut part = Vec::new();
    for start in 0..mask.len() {
        if mask[start] == 0 || seen[start] != 0 {
            continue;
        }
        part.clear();
        stack.clear();
        let mut edge = false;
        stack.push(start);
        seen[start] = 1;
        while let Some(i) = stack.pop() {
            part.push(i);
            let x = i / h;
            let y = i - x * h;
            if x == 0 || y == 0 || x + 1 == w || y + 1 == h {
                edge = true;
            }
            if x + 1 < w && mask[i + h] != 0 && seen[i + h] == 0 { seen[i + h] = 1; stack.push(i + h); }
            if x > 0 && mask[i - h] != 0 && seen[i - h] == 0 { seen[i - h] = 1; stack.push(i - h); }
            if y + 1 < h && mask[i + 1] != 0 && seen[i + 1] == 0 { seen[i + 1] = 1; stack.push(i + 1); }
            if y > 0 && mask[i - 1] != 0 && seen[i - 1] == 0 { seen[i - 1] = 1; stack.push(i - 1); }
        }
        each(&part, edge);
    }
}

/// Loads, merges (`OR`), and classifies water from `vatten*.bin` (exact `geo-water.ts` rules).
pub fn load_water_data(paths: &[impl AsRef<Path>], geojson_path: Option<&Path>) -> Result<WaterData, String> {
    let headers: Vec<BinHeader> = paths
        .iter()
        .map(|p| read_bin_header(p.as_ref(), "Water grid"))
        .collect::<Result<_, _>>()?;
    let union = union_headers(&headers, "Water grids")?;
    let (w, h) = (union.width, union.height);
    let mut cells = vec![0u8; w * h];
    for (path, hdr) in paths.iter().zip(headers.iter()) {
        let bytes = std::fs::read(path.as_ref())
            .map_err(|e| format!("Failed reading {}: {e}", path.as_ref().display()))?;
        if bytes.len() != 40 + hdr.width * hdr.height {
            return Err(format!("{} has invalid water grid size", path.as_ref().display()));
        }
        let dx = js_round((hdr.min_x - union.min_x) / union.cell) as isize;
        let dy = js_round((hdr.min_y - union.min_y) / union.cell) as isize;
        let payload = &bytes[40..];
        for x in 0..hdr.width {
            let src_col = x * hdr.height;
            let dst_col = (x as isize + dx) as usize * h;
            for y in 0..hdr.height {
                let bit = payload[src_col + y];
                if bit != 0 {
                    cells[(dst_col as isize + dy) as usize + y] |= bit;
                }
            }
        }
    }

    let area = union.cell * union.cell;
    let open = |x: isize, y: isize| -> bool {
        x < 0 || y < 0 || (x as usize) >= w || (y as usize) >= h
            || (cells[x as usize * h + y as usize] & WATER_GROUND_BIT) == 0
    };
    let mut core = vec![0u8; w * h];
    for x in 0..w {
        let xi = x as isize;
        for y in 0..h {
            let yi = y as isize;
            if open(xi, yi) && open(xi + 1, yi) && open(xi - 1, yi) && open(xi, yi + 1) && open(xi, yi - 1) {
                core[x * h + y] = 1;
            }
        }
    }
    let mut candidate = vec![0u8; w * h];
    let near = |x: isize, y: isize| -> bool {
        x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h && core[x as usize * h + y as usize] == 1
    };
    for x in 0..w {
        let xi = x as isize;
        for y in 0..h {
            let yi = y as isize;
            if open(xi, yi) && (near(xi, yi) || near(xi + 1, yi) || near(xi - 1, yi) || near(xi, yi + 1) || near(xi, yi - 1)) {
                candidate[x * h + y] = 1;
            }
        }
    }
    let mut mask = vec![0u8; w * h];
    water_components(&candidate, w, h, |part, _| {
        if (part.len() as f64) * area < 400.0 {
            return;
        }
        let water_cnt = part.iter().filter(|&&i| (cells[i] & WATER_WATER_BIT) != 0).count();
        if water_cnt < 3 || (water_cnt as f64) < (part.len() as f64) * 0.005 {
            return;
        }
        for &i in part { mask[i] = 1; }
    });
    let land: Vec<u8> = mask.iter().map(|&v| u8::from(v == 0)).collect();
    water_components(&land, w, h, |part, edge| {
        if !edge && (part.len() as f64) * area < 60.0 {
            for &i in part { mask[i] = 1; }
        }
    });

    let water_count: usize = mask.iter().map(|&v| v as usize).sum();
    let water_ha = js_round(water_count as f64 * area / 100.0) / 100.0;
    let mut water_areas = 0usize;
    if let Some(out_path) = geojson_path {
        let rings: Vec<Vec<[f64; 2]>> = mask_rings(&mask, union.min_x + union.cell * 0.5, union.min_y + union.cell * 0.5, union.cell, w, h)
            .into_iter()
            .map(|r| simplify(&r, union.cell * 0.75))
            .filter(|r| r.len() >= 4)
            .collect();
        let polygons = nest_polygons(&rings);
        water_areas = polygons.len();
        if water_areas > 0 {
            write_water_geojson(out_path, &polygons)?;
        }
    }

    Ok(WaterData { min_x: union.min_x, min_y: union.min_y, cell: union.cell, width: w, height: h, mask, water_ha, water_areas })
}

/// Merged 2 m point statistics (`punkter*.bin`) + O(1) integral table for `ground_share_at`.
pub struct PointStats {
    pub min_x: f64,
    pub min_y: f64,
    pub cell: f64,
    pub width: usize,
    pub height: usize,
    pub values: Vec<f32>,
    all_sum: Vec<f64>,
    gnd_sum: Vec<f64>,
}

impl PointStats {
    #[inline]
    pub fn ground_share_at(&self, px: f64, py: f64) -> Option<f64> {
        let x = ((px - self.min_x) / self.cell).floor() as isize;
        let y = ((py - self.min_y) / self.cell).floor() as isize;
        if x < 0 || y < 0 || (x as usize) >= self.width || (y as usize) >= self.height {
            return None;
        }
        let (x, y) = (x as usize, y as usize);
        let (x0, x1) = (x.saturating_sub(2), (x + 3).min(self.width));
        let (y0, y1) = (y.saturating_sub(2), (y + 3).min(self.height));
        let s = self.height + 1;
        let n = self.all_sum[x1 * s + y1] - self.all_sum[x0 * s + y1] - self.all_sum[x1 * s + y0] + self.all_sum[x0 * s + y0];
        if n > 0.0 {
            let g = self.gnd_sum[x1 * s + y1] - self.gnd_sum[x0 * s + y1] - self.gnd_sum[x1 * s + y0] + self.gnd_sum[x0 * s + y0];
            Some(g / n)
        } else {
            None
        }
    }

    pub fn write_point_images(&self, out_dir: &Path) -> Result<(), String> {
        let (w, h) = (self.width, self.height);
        let world = world_file_corner(self.min_x, self.min_y, self.cell, h);
        let to_byte = |v: f64| js_round(v).clamp(0.0, 255.0) as u8;

        write_sub_png(&out_dir.join("lasveg.png"), w, h, |line, row_buf| {
            let y = h - 1 - line;
            for col in 0..w {
                let o = (col * h + y) * POINT_BANDS;
                let n = f64::from(self.values[o + 1]);
                let p = col * 4;
                if n > 0.0 {
                    let top = if self.values[o].is_finite() { f64::from(self.values[o]) } else { 0.0 };
                    row_buf[p..p + 4].copy_from_slice(&[
                        to_byte(top / 0.2).min(254),
                        to_byte(255.0 * f64::from(self.values[o + 2]) / n),
                        to_byte(255.0 * f64::from(self.values[o + 4]) / n),
                        255,
                    ]);
                } else {
                    row_buf[p..p + 4].fill(0);
                }
            }
        })?;
        write_sub_png(&out_dir.join("lasmark.png"), w, h, |line, row_buf| {
            let y = h - 1 - line;
            for col in 0..w {
                let o = (col * h + y) * POINT_BANDS;
                let n = f64::from(self.values[o + 1]);
                let p = col * 4;
                if n > 0.0 {
                    row_buf[p..p + 4].copy_from_slice(&[
                        to_byte(255.0 * f64::from(self.values[o + 3]) / n),
                        if self.values[o + 6].is_finite() { to_byte(f64::from(self.values[o + 6]) / 64.0) } else { 0 },
                        if self.values[o + 7].is_finite() { to_byte(f64::from(self.values[o + 7]) * 100.0).min(254) } else { 255 },
                        255,
                    ]);
                } else {
                    row_buf[p..p + 4].fill(0);
                }
            }
        })?;
        write_sub_png(&out_dir.join("laskron.png"), w, h, |line, row_buf| {
            let y = h - 1 - line;
            for col in 0..w {
                let o = (col * h + y) * POINT_BANDS;
                let n = f64::from(self.values[o + 1]);
                let p = col * 4;
                if n > 0.0 {
                    row_buf[p..p + 4].copy_from_slice(&[
                        to_byte(255.0 * f64::from(self.values[o + 5]) / n),
                        to_byte(n),
                        0,
                        255,
                    ]);
                } else {
                    row_buf[p..p + 4].fill(0);
                }
            }
        })?;
        for name in ["lasveg.pgw", "lasmark.pgw", "laskron.pgw"] {
            std::fs::write(out_dir.join(name), &world).map_err(|e| format!("Failed writing {name}: {e}"))?;
        }
        Ok(())
    }
}

pub fn load_point_stats(paths: &[impl AsRef<Path>]) -> Result<PointStats, String> {
    let headers: Vec<BinHeader> = paths
        .iter()
        .map(|p| read_bin_header(p.as_ref(), "Point stats"))
        .collect::<Result<_, _>>()?;
    let union = union_headers(&headers, "Point stats")?;
    let (w, h) = (union.width, union.height);
    let size = w * h;
    let mut values = vec![0.0f32; size * POINT_BANDS];
    for c in 0..size {
        let o = c * POINT_BANDS;
        values[o] = f32::NAN;
        values[o + 6] = f32::NAN;
        values[o + 7] = f32::NAN;
    }
    let mut intensity_sum = vec![0.0f64; size];
    let mut spread_sq_sum = vec![0.0f64; size];

    for (path, hdr) in paths.iter().zip(headers.iter()) {
        let bytes = std::fs::read(path.as_ref())
            .map_err(|e| format!("Failed reading {}: {e}", path.as_ref().display()))?;
        if bytes.len() != 40 + hdr.width * hdr.height * POINT_BANDS * 4 {
            return Err(format!("{} has invalid point stats size", path.as_ref().display()));
        }
        let dx = js_round((hdr.min_x - union.min_x) / union.cell) as isize;
        let dy = js_round((hdr.min_y - union.min_y) / union.cell) as isize;
        let payload = &bytes[40..];
        let read_f = |idx: usize| f32::from_le_bytes(payload[idx * 4..idx * 4 + 4].try_into().unwrap());
        let x0 = (-dx).max(0) as usize;
        let x1 = hdr.width.min((w as isize - dx).max(0) as usize);
        let y0 = (-dy).max(0) as usize;
        let y1 = hdr.height.min((h as isize - dy).max(0) as usize);
        for x in x0..x1 {
            let src_col = x * hdr.height;
            let dst_col = (x as isize + dx) as usize * h;
            for y in y0..y1 {
                let so = (src_col + y) * POINT_BANDS;
                let (top, total) = (read_f(so), read_f(so + 1));
                if total == 0.0 && !top.is_finite() {
                    continue;
                }
                let dst_cell = (dst_col as isize + dy) as usize + y;
                let doff = dst_cell * POINT_BANDS;
                if top.is_finite() && !(values[doff] >= top) {
                    values[doff] = top;
                }
                values[doff + 1] += total;
                let n = read_f(so + 2);
                values[doff + 2] += n;
                values[doff + 3] += read_f(so + 3);
                values[doff + 4] += read_f(so + 4);
                values[doff + 5] += read_f(so + 5);
                if n > 0.0 {
                    let nf = f64::from(n);
                    intensity_sum[dst_cell] += nf * f64::from(read_f(so + 6));
                    let sp = f64::from(read_f(so + 7));
                    spread_sq_sum[dst_cell] += nf * sp * sp;
                }
            }
        }
    }
    for c in 0..size {
        let o = c * POINT_BANDS;
        let g = f64::from(values[o + 2]);
        values[o + 6] = if g > 0.0 { (intensity_sum[c] / g) as f32 } else { f32::NAN };
        values[o + 7] = if g > 0.0 { (spread_sq_sum[c] / g).sqrt() as f32 } else { f32::NAN };
    }

    let stride = h + 1;
    let mut all_sum = vec![0.0f64; (w + 1) * stride];
    let mut gnd_sum = vec![0.0f64; (w + 1) * stride];
    for x in 0..w {
        let (src_col, dst_col, left_col) = (x * h, (x + 1) * stride, x * stride);
        for y in 0..h {
            let o = (src_col + y) * POINT_BANDS;
            let i = dst_col + y + 1;
            all_sum[i] = f64::from(values[o + 1]) + all_sum[left_col + y + 1] + all_sum[dst_col + y] - all_sum[left_col + y];
            gnd_sum[i] = f64::from(values[o + 2]) + gnd_sum[left_col + y + 1] + gnd_sum[dst_col + y] - gnd_sum[left_col + y];
        }
    }

    Ok(PointStats { min_x: union.min_x, min_y: union.min_y, cell: union.cell, width: w, height: h, values, all_sum, gnd_sum })
}

/// Decodes `vegetationsklasser.png` + `.pgw` into `(open_mask, forest_mask)` aligned to `ground`.
pub fn load_veg_masks(
    png_path: &Path,
    pgw_override: Option<&Path>,
    ground: &GroundGrid,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let pgw_path = pgw_override.map_or_else(|| png_path.with_extension("pgw"), Path::to_path_buf);
    let img = read_rgba_png(png_path)?;
    let pgw_text = std::fs::read_to_string(&pgw_path)
        .map_err(|e| format!("Failed reading {}: {e}", pgw_path.display()))?;
    let world = WorldTransform::from_pgw(&pgw_text)?;
    let min_y_center = world.y0 - (img.height as f64 - 1.0) * world.cell;

    let h = ground.height;
    let mut open = vec![0u8; ground.width * h];
    let mut forest = vec![0u8; ground.width * h];
    open.par_chunks_mut(h)
        .zip(forest.par_chunks_mut(h))
        .enumerate()
        .for_each(|(x, (o_col, f_col))| {
            let wx = ground.min_x + (x as f64 + 0.5) * ground.cell;
            let col = js_round((wx - world.x0) / world.cell) as isize;
            if col < 0 || (col as usize) >= img.width {
                return;
            }
            for y in 0..h {
                let wy = ground.min_y + (y as f64 + 0.5) * ground.cell;
                let row_south = js_round((wy - min_y_center) / world.cell) as isize;
                if row_south < 0 || (row_south as usize) >= img.height {
                    continue;
                }
                let off = ((img.height - 1 - row_south as usize) * img.width + col as usize) * 4;
                let (r, a) = (img.data[off], img.data[off + 3]);
                if a > 0 && (r & 15) == 1 {
                    o_col[y] = 1;
                } else if a == 0 || ((r & 15) != 1 && (r & 15) < 4) {
                    f_col[y] = 1;
                }
            }
        });
    Ok((open, forest))
}

/// Allocation-free streaming RGBA8 PNG writer using PNG Filter Type 1 (Sub).
pub fn write_sub_png<F>(path: &Path, width: usize, height: usize, mut fill_row: F) -> Result<(), String>
where
    F: FnMut(usize, &mut [u8]),
{
    let file = File::create(path).map_err(|e| format!("Failed creating {}: {e}", path.display()))?;
    let mut encoder = png::Encoder::new(BufWriter::with_capacity(64 * 1024, file), width as u32, height as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    // Important: set_compression sets a default filter, so set_filter(Sub) MUST come after.
    encoder.set_compression(png::Compression::Fast);
    encoder.set_filter(png::Filter::Sub);
    let mut writer = encoder.write_header().map_err(|e| format!("PNG header error for {}: {e}", path.display()))?;
    let mut stream = writer
        .stream_writer_with_size(64 * 1024)
        .map_err(|e| format!("PNG stream init error for {}: {e}", path.display()))?;
    let mut row_buf = vec![0u8; width * 4];
    for row in 0..height {
        fill_row(row, &mut row_buf);
        stream.write_all(&row_buf).map_err(|e| format!("PNG write error for {}: {e}", path.display()))?;
    }
    stream.finish().map_err(|e| format!("PNG finish error for {}: {e}", path.display()))
}

/// Layer payload for compact R12 ASCII DXF (`moistureDxf` format).
pub struct DxfLayer<'a> {
    pub name: &'a str,
    pub closed: bool,
    pub parts: &'a [Vec<[f64; 2]>],
    pub points: &'a [[f64; 2]],
}

/// Writes exact `scripts/geo-moisture.ts` `moistureDxf` R12 ASCII DXF.
pub fn write_moisture_dxf(path: &Path, layers: &[DxfLayer<'_>]) -> Result<(), String> {
    let file = File::create(path).map_err(|e| format!("Failed creating {}: {e}", path.display()))?;
    let mut w = BufWriter::with_capacity(256 * 1024, file);
    write!(w, "0\nSECTION\n2\nENTITIES").map_err(|e| e.to_string())?;
    for layer in layers {
        for &[x, y] in layer.points {
            write!(w, "\n0\nPOINT\n8\n{}\n10\n{x:.2}\n20\n{y:.2}", layer.name).map_err(|e| e.to_string())?;
        }
        for part in layer.parts {
            let pts = if layer.closed && part.len() > 1 && part[0] == *part.last().unwrap() {
                &part[..part.len() - 1]
            } else {
                &part[..]
            };
            if pts.len() < if layer.closed { 3 } else { 2 } {
                continue;
            }
            let flag = if layer.closed { 1 } else { 0 };
            write!(w, "\n0\nPOLYLINE\n8\n{}\n66\n1\n70\n{flag}", layer.name).map_err(|e| e.to_string())?;
            for &[x, y] in pts {
                write!(w, "\n0\nVERTEX\n8\n{}\n10\n{x:.2}\n20\n{y:.2}", layer.name).map_err(|e| e.to_string())?;
            }
            write!(w, "\n0\nSEQEND").map_err(|e| e.to_string())?;
        }
    }
    write!(w, "\n0\nENDSEC\n0\nEOF").map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}
