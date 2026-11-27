//! Elevation (`hojd.png`), NW+zenith hillshade (`skuggning.png`), and local relief (`relief.png`)
//! Sub-filtered RGBA8 PNG + `.pgw` writers matching `scripts/geo-cliffs.ts` and `scripts/geo-ditches.ts`.

use crate::rasters::grid_io::{js_round, world_file_corner, write_sub_png, GroundGrid};
use std::path::Path;

pub const DEFAULT_MAX_SIDE: usize = 6000;

/// Writes `hojd.png` + `hojd.pgw` (24-bit `cm + 10_000`, transparent where NaN, Filter Type 1 Sub).
pub fn write_height_png(out_dir: &Path, ground: &GroundGrid) -> Result<(), String> {
    let (w, h) = (ground.width, ground.height);
    write_sub_png(&out_dir.join("hojd.png"), w, h, |line, row_buf| {
        let y = h - 1 - line;
        for col in 0..w {
            let z = ground.z[col * h + y];
            let o = col * 4;
            if !z.is_finite() {
                row_buf[o..o + 4].fill(0);
                continue;
            }
            let raw = js_round(f64::from(z) * 100.0) + 10_000.0;
            let value = raw.clamp(0.0, 0x00ff_ffff as f64) as u32;
            row_buf[o] = ((value >> 16) & 0xff) as u8;
            row_buf[o + 1] = ((value >> 8) & 0xff) as u8;
            row_buf[o + 2] = (value & 0xff) as u8;
            row_buf[o + 3] = 255;
        }
    })?;
    std::fs::write(out_dir.join("hojd.pgw"), ground.world_file())
        .map_err(|e| format!("Failed writing hojd.pgw: {e}"))
}

/// Exact match to `scripts/geo-cliffs.ts` `shadeValue`.
#[inline]
pub fn shade_value(ground: &GroundGrid, step: usize, column: usize, row: usize) -> Option<u8> {
    let size = ground.cell * step as f64;
    let z = |c: isize, r: isize| -> f64 {
        let x = (c * step as isize).clamp(0, ground.width as isize - 1) as usize;
        let y = (r * step as isize).clamp(0, ground.height as isize - 1) as usize;
        f64::from(ground.z[x * ground.height + y])
    };
    let c = column as isize;
    let r = row as isize;
    let here = z(c, r);
    if !here.is_finite() {
        return None;
    }
    let val = |cc: isize, rr: isize| -> f64 {
        let v = z(cc, rr);
        if v.is_finite() { v } else { here }
    };
    let dx = (val(c + 1, r) - val(c - 1, r)) / (2.0 * size);
    let dy = (val(c, r + 1) - val(c, r - 1)) / (2.0 * size);
    let lx = -0.5f64;
    let ly = 0.5f64;
    let lz = std::f64::consts::FRAC_1_SQRT_2;
    let len = (dx * dx + dy * dy + 1.0).sqrt();
    let lit = ((-dx * lx - dy * ly + lz) / len).max(0.0);
    let gray = js_round(255.0 * (0.8 * lit / lz * (0.7 + 0.3 / len)).clamp(0.0, 1.0)) as u8;
    Some(gray)
}

/// Writes `skuggning.png` + `skuggning.pgw` (NW+zenith hillshade, downsampled to `<= max_side`).
pub fn write_hillshade_png(out_dir: &Path, ground: &GroundGrid, max_side: usize) -> Result<(), String> {
    let step = ((ground.width.max(ground.height) as f64) / max_side as f64)
        .ceil()
        .max(1.0) as usize;
    let width = ground.width / step;
    let height = ground.height / step;
    if width == 0 || height == 0 {
        return Err("Ground grid too small for hillshade".into());
    }
    let size = ground.cell * step as f64;
    write_sub_png(&out_dir.join("skuggning.png"), width, height, |line, row_buf| {
        let row = height - 1 - line;
        for col in 0..width {
            let o = col * 4;
            match shade_value(ground, step, col, row) {
                Some(shade) => {
                    row_buf[o] = shade;
                    row_buf[o + 1] = shade;
                    row_buf[o + 2] = shade;
                    row_buf[o + 3] = 255;
                }
                None => row_buf[o..o + 4].fill(0),
            }
        }
    })?;
    let world = world_file_corner(ground.min_x, ground.min_y, size, height);
    std::fs::write(out_dir.join("skuggning.pgw"), world)
        .map_err(|e| format!("Failed writing skuggning.pgw: {e}"))
}

/// Writes `relief.png` + `relief.pgw` from precomputed 4 m `local_relief` (`scripts/geo-ditches.ts` `reliefImage`).
pub fn write_relief_png(
    out_dir: &Path,
    ground: &GroundGrid,
    relief: &[f32],
    max_side: usize,
) -> Result<(), String> {
    let step = ((ground.width.max(ground.height) as f64) / max_side as f64)
        .ceil()
        .max(1.0) as usize;
    let width = ground.width / step;
    let height = ground.height / step;
    if width == 0 || height == 0 {
        return Err("Ground grid too small for relief image".into());
    }
    let size = ground.cell * step as f64;
    let gh = ground.height;
    write_sub_png(&out_dir.join("relief.png"), width, height, |line, row_buf| {
        let sy = (height - 1 - line) * step;
        for col in 0..width {
            let value = relief[col * step * gh + sy];
            let o = col * 4;
            if !value.is_finite() {
                row_buf[o..o + 4].fill(0);
            } else {
                let shade = js_round(128.0 + 127.0 * f64::from(value).clamp(-1.0, 1.0)) as u8;
                row_buf[o] = shade;
                row_buf[o + 1] = shade;
                row_buf[o + 2] = shade.saturating_add(20);
                row_buf[o + 3] = 255;
            }
        }
    })?;
    let world = world_file_corner(ground.min_x, ground.min_y, size, height);
    std::fs::write(out_dir.join("relief.pgw"), world)
        .map_err(|e| format!("Failed writing relief.pgw: {e}"))
}
