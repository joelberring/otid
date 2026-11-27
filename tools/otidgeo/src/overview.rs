//! Optional fast 2 m ISOM overview raster (`--overview` -> `karta.png` + `karta.pgw`).
//!
//! Renders hillshade, water, ISOM vegetation colors, undergrowth hatch,
//! anti-aliased contours (`101`, `102`), dashed formlines (`103`), and knolls (`109`).

use crate::bench_io::write_rgba_png;
use crate::dem::PreparedDem;
use crate::types::{ContourLayer, ContourLine, KnollPoint, VegFeatures};
use crate::vegetation::{
    VegResult, LAB_FOREST, LAB_GREEN_406, LAB_GREEN_408, LAB_GREEN_410, LAB_NONE, LAB_OPEN,
    LAB_SEMI,
};
use std::path::Path;

#[inline]
fn blend_px(rgba: &mut [u8], w: usize, h: usize, x: isize, y: isize, col: [u8; 3], alpha: f32) {
    if x < 0 || y < 0 || (x as usize) >= w || (y as usize) >= h || alpha <= 0.0 {
        return;
    }
    let o = (y as usize * w + x as usize) * 4;
    let a = alpha.clamp(0.0, 1.0);
    let inv = 1.0 - a;
    rgba[o] = (rgba[o] as f32 * inv + col[0] as f32 * a).round() as u8;
    rgba[o + 1] = (rgba[o + 1] as f32 * inv + col[1] as f32 * a).round() as u8;
    rgba[o + 2] = (rgba[o + 2] as f32 * inv + col[2] as f32 * a).round() as u8;
    rgba[o + 3] = 255;
}

/// Draws a crisp anti-aliased segment of given width (`radius` in pixels).
fn draw_segment(
    rgba: &mut [u8],
    w: usize,
    h: usize,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    col: [u8; 3],
    radius: f64,
    opacity: f32,
) {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len = dx.hypot(dy);
    let steps = (len * 2.0).ceil().max(1.0) as usize;
    let r_ceil = (radius + 1.0).ceil() as isize;
    for s in 0..=steps {
        let t = s as f64 / steps as f64;
        let px = x0 + dx * t;
        let py = y0 + dy * t;
        let cx = px.round() as isize;
        let cy = py.round() as isize;
        for oy in -r_ceil..=r_ceil {
            for ox in -r_ceil..=r_ceil {
                let d = ((cx + ox) as f64 - px).hypot((cy + oy) as f64 - py);
                if d < radius + 0.7 {
                    let cov = ((radius + 0.7 - d) / 1.0).clamp(0.0, 1.0) as f32;
                    blend_px(rgba, w, h, cx + ox, cy + oy, col, cov * opacity);
                }
            }
        }
    }
}

/// Renders a fast 2 m ISOM overview PNG + `.pgw` (`karta.png`, `karta.pgw`).
pub fn write_overview(
    out_dir: &Path,
    dem: &PreparedDem,
    feat: &VegFeatures,
    veg: &VegResult,
    contours: &[ContourLine],
    formlines: &[ContourLine],
    knolls: &[KnollPoint],
) -> Result<(), String> {
    let (w, h) = (veg.width, veg.height);
    let world = veg.world;
    let mut rgba = vec![255u8; w * h * 4];

    // 1. Base ISOM vegetation + water + subtle NW hillshade.
    let lx = -0.6f32;
    let ly = 0.6f32;
    let lz = 0.53f32;
    for r in 0..h {
        let y = world.row_to_y(r as f64);
        for c in 0..w {
            let x = world.col_to_x(c as f64);
            let i = r * w + c;
            let base: [u8; 3] = if feat.water[i] != 0 {
                [115, 200, 245] // ISOM 301 water blue
            } else {
                match veg.land[i] {
                    LAB_NONE => [238, 238, 238],
                    LAB_OPEN => [255, 212, 92],     // ISOM 401/403 yellow
                    LAB_SEMI => [255, 232, 158],    // ISOM 402/404 light yellow
                    LAB_FOREST => [255, 255, 255],  // ISOM 405 white forest
                    LAB_GREEN_406 => [194, 238, 174], // ISOM 406 light green
                    LAB_GREEN_408 => [118, 210, 102], // ISOM 408 medium green
                    LAB_GREEN_410 => [46, 158, 56],   // ISOM 410 dark green
                    _ => [255, 255, 255],
                }
            };

            // Subtle hillshade modulation (+-10%).
            let shade = if feat.water[i] == 0 {
                if let (Some(ze), Some(zw), Some(zn), Some(zs)) = (
                    dem.sample_raw(x + 2.0, y),
                    dem.sample_raw(x - 2.0, y),
                    dem.sample_raw(x, y + 2.0),
                    dem.sample_raw(x, y - 2.0),
                ) {
                    let gx = (ze - zw) * 0.25;
                    let gy = (zn - zs) * 0.25;
                    let inv = 1.0 / (gx * gx + gy * gy + 1.0).sqrt();
                    let dot = (-gx * lx - gy * ly + lz) * inv;
                    (0.90 + 0.16 * dot).clamp(0.82, 1.06)
                } else {
                    1.0
                }
            } else {
                1.0
            };

            let o = i * 4;
            rgba[o] = (base[0] as f32 * shade).clamp(0.0, 255.0) as u8;
            rgba[o + 1] = (base[1] as f32 * shade).clamp(0.0, 255.0) as u8;
            rgba[o + 2] = (base[2] as f32 * shade).clamp(0.0, 255.0) as u8;
            rgba[o + 3] = 255;

            // Undergrowth vertical green stripes (407 / 409).
            let und = veg.undergrowth[i];
            if und > 0 && ((und == 1 && c % 3 == 0) || (und == 2 && c % 2 == 0)) {
                blend_px(&mut rgba, w, h, c as isize, r as isize, [68, 178, 68], 0.55);
            }
        }
    }

    // 2. Draw dashed formlines (ISOM 103).
    let col_form = [176, 102, 34];
    for line in formlines {
        let pts = &line.points;
        let segs = if line.closed { pts.len() } else { pts.len().saturating_sub(1) };
        let mut along = 0.0;
        for i in 0..segs {
            let a = pts[i];
            let b = pts[(i + 1) % pts.len()];
            let len = (b[0] - a[0]).hypot(b[1] - a[1]);
            // Dash pattern: 10 m on, 4 m off.
            if (along % 14.0) < 10.0 {
                let x0 = world.x_to_col_f(a[0]);
                let y0 = world.y_to_row_f(a[1]);
                let x1 = world.x_to_col_f(b[0]);
                let y1 = world.y_to_row_f(b[1]);
                draw_segment(&mut rgba, w, h, x0, y0, x1, y1, col_form, 0.35, 0.85);
            }
            along += len;
        }
    }

    // 3. Draw main contours (ISOM 101) and thicker index contours (ISOM 102).
    for line in contours {
        let is_index = matches!(line.layer, ContourLayer::ContourIndex | ContourLayer::DepressionIndex);
        let col = if is_index { [126, 56, 10] } else { [158, 78, 18] };
        let radius = if is_index { 0.85 } else { 0.42 };
        let pts = &line.points;
        let segs = if line.closed { pts.len() } else { pts.len().saturating_sub(1) };
        for i in 0..segs {
            let a = pts[i];
            let b = pts[(i + 1) % pts.len()];
            let x0 = world.x_to_col_f(a[0]);
            let y0 = world.y_to_row_f(a[1]);
            let x1 = world.x_to_col_f(b[0]);
            let y1 = world.y_to_row_f(b[1]);
            draw_segment(&mut rgba, w, h, x0, y0, x1, y1, col, radius, 0.95);
        }
    }

    // 4. Draw knoll dots (109), oriented elongated knolls (110), and pit markers (111).
    for k in knolls {
        let fx = world.x_to_col_f(k.x);
        let fy = world.y_to_row_f(k.y);
        if let Some(ang_deg) = k.angle_deg {
            let rad = ang_deg.to_radians();
            // Screen Y increases downward, world Y increases northward -> negate sin.
            let dx = rad.cos() * 1.6;
            let dy = -rad.sin() * 1.6;
            draw_segment(&mut rgba, w, h, fx - dx, fy - dy, fx + dx, fy + dy, [140, 62, 12], 0.85, 0.95);
            continue;
        }
        let cx = fx.round() as isize;
        let cy = fy.round() as isize;
        let col = if k.is_depression() { [110, 40, 120] } else { [140, 62, 12] };
        for oy in -1..=1 {
            for ox in -1..=1 {
                if ox * ox + oy * oy <= 1 {
                    blend_px(&mut rgba, w, h, cx + ox, cy + oy, col, 0.95);
                }
            }
        }
    }

    write_rgba_png(&out_dir.join("karta.png"), w, h, &rgba)?;
    std::fs::write(out_dir.join("karta.pgw"), world.to_pgw())
        .map_err(|e| format!("Failed to write karta.pgw: {e}"))
}
