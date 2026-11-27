//! Clean-room physical vegetation & undergrowth classification engine.
//!
//! Uses O(1) 2D integral tables for 5x5 (10 m) and 11x11 (22 m) spatial means,
//! physically controllable thresholds, built-in steep-slope (`> 35 deg`) and
//! water barriers, nested soft-majority smoothing, connected-component island
//! filtering (`< min_veg_area_m2`), and writes O-Tid-compatible
//! `vegetationsklasser.png` + `.pgw`.

use crate::bench_io::write_rgba_png;
use crate::types::{EngineConfig, VegFeatures, WorldTransform};
use std::path::Path;

/// Internal land-cover partition labels (nested order for generalization).
pub const LAB_NONE: u8 = 0;
pub const LAB_OPEN: u8 = 1;
pub const LAB_SEMI: u8 = 2;
pub const LAB_FOREST: u8 = 3;
pub const LAB_GREEN_406: u8 = 4;
pub const LAB_GREEN_408: u8 = 5;
pub const LAB_GREEN_410: u8 = 6;

/// O-Tid `vegetationsklasser.png` alpha convention for semi-open land (402/404).
pub const SEMI_ALPHA: u8 = 200;

/// Classified 2 m vegetation & undergrowth rasters plus hectare summary.
pub struct VegResult {
    pub width: usize,
    pub height: usize,
    pub world: WorldTransform,
    /// Land-cover partition (`LAB_NONE..=LAB_GREEN_410`).
    pub land: Vec<u8>,
    /// Undergrowth overlay (`0 = none`, `1 = 407`, `2 = 409`).
    pub undergrowth: Vec<u8>,
    pub ha_white: f64,
    pub ha_open: f64,
    pub ha_semi: f64,
    pub ha_green406: f64,
    pub ha_green408: f64,
    pub ha_green410: f64,
    pub ha_und407: f64,
    pub ha_und409: f64,
}

/// Mask-aware 2D integral image (`f64` sum) supporting O(1) box queries.
struct Integral2D {
    w: usize,
    h: usize,
    stride: usize,
    sum: Vec<f64>,
}

impl Integral2D {
    fn from_masked(values: &[f32], mask: &[u8], w: usize, h: usize) -> Self {
        let stride = w + 1;
        let mut sum = vec![0.0f64; (h + 1) * stride];
        for r in 0..h {
            let mut row_acc = 0.0f64;
            let src = r * w;
            let dst = (r + 1) * stride;
            let prev = r * stride;
            for c in 0..w {
                if mask[src + c] != 0 {
                    let v = values[src + c];
                    if v.is_finite() {
                        row_acc += f64::from(v);
                    }
                }
                sum[dst + c + 1] = sum[prev + c + 1] + row_acc;
            }
        }
        Self { w, h, stride, sum }
    }

    fn from_binary(bits: &[u8], w: usize, h: usize) -> Self {
        let stride = w + 1;
        let mut sum = vec![0.0f64; (h + 1) * stride];
        for r in 0..h {
            let mut row_acc = 0.0f64;
            let src = r * w;
            let dst = (r + 1) * stride;
            let prev = r * stride;
            for c in 0..w {
                row_acc += f64::from(bits[src + c] != 0);
                sum[dst + c + 1] = sum[prev + c + 1] + row_acc;
            }
        }
        Self { w, h, stride, sum }
    }

    #[inline]
    fn box_sum(&self, c: usize, r: usize, radius: usize) -> f64 {
        let c0 = c.saturating_sub(radius);
        let c1 = (c + radius + 1).min(self.w);
        let r0 = r.saturating_sub(radius);
        let r1 = (r + radius + 1).min(self.h);
        let row0 = r0 * self.stride;
        let row1 = r1 * self.stride;
        self.sum[row1 + c1] - self.sum[row0 + c1] - self.sum[row1 + c0] + self.sum[row0 + c0]
    }
}

/// Fast 3-pass separable box blur approximating a Gaussian with standard deviation `sigma`.
fn box_gaussian_blur(src: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    if sigma <= 0.35 || w < 2 || h < 2 {
        return src.to_vec();
    }
    let radius = (((4.0 * sigma * sigma + 1.0).sqrt() - 1.0) * 0.5).round().max(1.0) as usize;
    let inv = 1.0 / (2 * radius + 1) as f32;
    let mut a = src.to_vec();
    let mut b = vec![0.0f32; w * h];
    let mut col_sums = vec![0.0f32; w];

    for _ in 0..3 {
        // Horizontal pass.
        for r in 0..h {
            let base = r * w;
            let mut sum = 0.0f32;
            for k in -(radius as isize)..=(radius as isize) {
                sum += a[base + k.clamp(0, w as isize - 1) as usize];
            }
            for c in 0..w {
                b[base + c] = sum * inv;
                let add = (c + radius + 1).min(w - 1);
                let drop = c.saturating_sub(radius);
                sum += a[base + add] - a[base + drop];
            }
        }
        // Vertical pass (row-sequential memory access).
        col_sums.fill(0.0);
        for k in -(radius as isize)..=(radius as isize) {
            let sr = k.clamp(0, h as isize - 1) as usize;
            let base = sr * w;
            for c in 0..w {
                col_sums[c] += b[base + c];
            }
        }
        for r in 0..h {
            let dst = r * w;
            let add_row = (r + radius + 1).min(h - 1) * w;
            let drop_row = r.saturating_sub(radius) * w;
            for c in 0..w {
                let s = col_sums[c];
                a[dst + c] = s * inv;
                col_sums[c] = s + b[add_row + c] - b[drop_row + c];
            }
        }
    }
    a
}

/// Nested soft-majority filter over the vegetation partition (preserves crisp, non-overlapping levels).
fn soft_majority(labels: &[u8], w: usize, h: usize, sigma: f32) -> Vec<u8> {
    if sigma <= 0.25 {
        return labels.to_vec();
    }
    let n = labels.len();
    let known: Vec<f32> = labels.iter().map(|&v| if v != LAB_NONE { 1.0 } else { 0.0 }).collect();
    let weight = box_gaussian_blur(&known, w, h, sigma);

    let blur_pred = |pred: fn(u8) -> bool| -> Vec<f32> {
        let mask: Vec<f32> = labels.iter().map(|&v| if pred(v) { 1.0 } else { 0.0 }).collect();
        let blurred = box_gaussian_blur(&mask, w, h, sigma);
        blurred
            .into_iter()
            .zip(weight.iter())
            .map(|(v, &wt)| v / (wt + 1e-6))
            .collect()
    };

    let g406 = blur_pred(|v| v >= LAB_GREEN_406);
    let g408 = blur_pred(|v| v >= LAB_GREEN_408);
    let g410 = blur_pred(|v| v >= LAB_GREEN_410);
    let open = blur_pred(|v| v == LAB_OPEN);
    let semi = blur_pred(|v| v == LAB_SEMI);

    let mut out = vec![LAB_NONE; n];
    for i in 0..n {
        if labels[i] == LAB_NONE {
            continue;
        }
        let mut lab = if g406[i] > 0.5 {
            if g410[i] > 0.5 {
                LAB_GREEN_410
            } else if g408[i] > 0.5 {
                LAB_GREEN_408
            } else {
                LAB_GREEN_406
            }
        } else {
            LAB_FOREST
        };
        let o = open[i];
        let s = semi[i];
        if s > 0.5 && s > g406[i] {
            lab = LAB_SEMI;
        }
        if o > 0.5 && o > g406[i] {
            lab = LAB_OPEN;
        }
        if lab == LAB_FOREST && o + s > 0.5 {
            lab = if o >= s { LAB_OPEN } else { LAB_SEMI };
        }
        out[i] = lab;
    }
    out
}

/// Removes connected islands smaller than `min_cells` by reassigning them to their dominant neighbor label.
fn remove_small_islands(labels: &[u8], w: usize, h: usize, min_cells: usize) -> Vec<u8> {
    if min_cells <= 1 {
        return labels.to_vec();
    }
    let mut cur = labels.to_vec();
    let n = cur.len();
    let mut seen = vec![0u8; n];
    let mut queue = Vec::<usize>::with_capacity(min_cells * 2);

    for _round in 0..2 {
        seen.fill(0);
        let mut changed = false;
        let snapshot = cur.clone();
        for start in 0..n {
            let lab = snapshot[start];
            if lab == LAB_NONE || seen[start] != 0 {
                continue;
            }
            seen[start] = 1;
            queue.clear();
            queue.push(start);
            let mut head = 0;
            let mut border_votes = [0u32; 8];
            while head < queue.len() {
                let i = queue[head];
                head += 1;
                let r = i / w;
                let c = i - r * w;
                let nbrs = [
                    (c > 0).then(|| i - 1),
                    (c + 1 < w).then(|| i + 1),
                    (r > 0).then(|| i - w),
                    (r + 1 < h).then(|| i + w),
                ];
                for nb in nbrs.into_iter().flatten() {
                    let nl = snapshot[nb];
                    if nl == lab {
                        if seen[nb] == 0 {
                            seen[nb] = 1;
                            queue.push(nb);
                        }
                    } else if nl != LAB_NONE {
                        border_votes[nl as usize] += 1;
                    }
                }
            }
            // Use slightly smaller threshold for dense 408/410 pockets so sharp thickets survive.
            let thresh = match lab {
                LAB_GREEN_410 => (min_cells / 2).max(6),
                LAB_GREEN_408 => (min_cells * 2 / 3).max(8),
                LAB_FOREST => min_cells,
                _ => min_cells,
            };
            if queue.len() < thresh {
                let mut best_lab = 0u8;
                let mut best_cnt = 0u32;
                for (l, &cnt) in border_votes.iter().enumerate().skip(1) {
                    if cnt > best_cnt {
                        best_cnt = cnt;
                        best_lab = l as u8;
                    }
                }
                if best_lab != 0 {
                    changed = true;
                    for &i in &queue {
                        cur[i] = best_lab;
                    }
                }
            }
        }
        if !changed {
            break;
        }
    }
    cur
}

/// Smooths and cleans a binary/2-level undergrowth mask (`0`, `1`, `2`).
fn clean_undergrowth(raw: &[u8], valid: &[u8], w: usize, h: usize, min_cells: usize, sigma: f32) -> Vec<u8> {
    let n = raw.len();
    let mut out = vec![0u8; n];
    if sigma <= 0.25 {
        for i in 0..n {
            if valid[i] != 0 {
                out[i] = raw[i];
            }
        }
    } else {
        let m1: Vec<f32> = raw.iter().map(|&v| if v >= 1 { 1.0 } else { 0.0 }).collect();
        let m2: Vec<f32> = raw.iter().map(|&v| if v >= 2 { 1.0 } else { 0.0 }).collect();
        let b1 = box_gaussian_blur(&m1, w, h, sigma);
        let b2 = box_gaussian_blur(&m2, w, h, sigma);

        for i in 0..n {
            if valid[i] != 0 && b1[i] > 0.45 {
                out[i] = if b2[i] > 0.45 { 2 } else { 1 };
            }
        }
    }

    // Connected-component filtering on active undergrowth pixels.
    let mut seen = vec![0u8; n];
    let mut queue = Vec::new();
    for start in 0..n {
        if out[start] == 0 || seen[start] != 0 {
            continue;
        }
        seen[start] = 1;
        queue.clear();
        queue.push(start);
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let r = i / w;
            let c = i - r * w;
            let nbrs = [
                (c > 0).then(|| i - 1),
                (c + 1 < w).then(|| i + 1),
                (r > 0).then(|| i - w),
                (r + 1 < h).then(|| i + w),
            ];
            for nb in nbrs.into_iter().flatten() {
                if out[nb] != 0 && seen[nb] == 0 {
                    seen[nb] = 1;
                    queue.push(nb);
                }
            }
        }
        if queue.len() < min_cells {
            for &i in &queue {
                out[i] = 0;
            }
        }
    }
    out
}

/// Classifies 2 m vegetation & undergrowth from `VegFeatures` using O(1) integral tables.
pub fn classify_vegetation(feat: &VegFeatures, config: &EngineConfig) -> VegResult {
    let (w, h) = (feat.width, feat.height);
    let n = w * h;
    let active: Vec<u8> = (0..n)
        .map(|i| u8::from(feat.valid[i] != 0 && feat.water[i] == 0))
        .collect();

    // Build O(1) 2D integral tables for 5x5 (r=2), 7x7 (r=3), 9x9 (r=4), and 11x11 (r=5) windows.
    let it_cnt = Integral2D::from_binary(&active, w, h);
    let it_vegh = Integral2D::from_masked(&feat.vegh, &active, w, h);
    let it_gnd = Integral2D::from_masked(&feat.ground_share, &active, w, h);
    let it_low = Integral2D::from_masked(&feat.low_share, &active, w, h);
    let it_mid = Integral2D::from_masked(&feat.mid_share, &active, w, h);
    let it_high = Integral2D::from_masked(&feat.high_share, &active, w, h);

    let open_h = config.open_max_height_m as f32;
    let open_cell_bits: Vec<u8> = (0..n)
        .map(|i| u8::from(active[i] != 0 && feat.vegh[i] < open_h && feat.high_share[i] < 0.08))
        .collect();
    let tree_cell_bits: Vec<u8> = (0..n)
        .map(|i| u8::from(active[i] != 0 && feat.vegh[i] > 3.0))
        .collect();
    let it_open_cell = Integral2D::from_binary(&open_cell_bits, w, h);
    let it_tree_cell = Integral2D::from_binary(&tree_cell_bits, w, h);

    let mut raw_land = vec![LAB_NONE; n];
    let mut raw_und = vec![0u8; n];

    let steep_cut = config.steep_cutoff_deg as f32;
    let g_scale = config.green_scale;
    let c_wt = config.canopy_weight;
    let g_lo = config.green_low_thresh;
    let g_med = config.green_med_thresh;
    let g_hi = config.green_high_thresh;
    let u_th = config.undergrowth_thresh;
    let open_gnd_min = config.open_min_ground_share;

    for r in 0..h {
        for c in 0..w {
            let i = r * w + c;
            if active[i] == 0 {
                continue;
            }
            let c5 = it_cnt.box_sum(c, r, 2).max(1.0);
            let c7 = it_cnt.box_sum(c, r, 3).max(1.0);
            let c9 = it_cnt.box_sum(c, r, 4).max(1.0);
            let c11 = it_cnt.box_sum(c, r, 5).max(1.0);

            let vegh_m5 = it_vegh.box_sum(c, r, 2) / c5;
            let gnd_m5 = it_gnd.box_sum(c, r, 2) / c5;
            let low_m5 = it_low.box_sum(c, r, 2) / c5;
            let mid_m5 = it_mid.box_sum(c, r, 2) / c5;
            let high_m5 = it_high.box_sum(c, r, 2) / c5;

            let low_m11 = it_low.box_sum(c, r, 5) / c11;
            let mid_m11 = it_mid.box_sum(c, r, 5) / c11;
            let gnd_m11 = it_gnd.box_sum(c, r, 5) / c11;
            let high_m11 = it_high.box_sum(c, r, 5) / c11;

            let open_frac7 = it_open_cell.box_sum(c, r, 3) / c7;
            let open_frac9 = it_open_cell.box_sum(c, r, 4) / c9;
            let tree_frac9 = it_tree_cell.box_sum(c, r, 4) / c9;

            let slope = feat.slope_deg[i];
            let is_steep = slope.is_finite() && slope > steep_cut;

            // 1. Open (401/403) and Semi-open (402/404) classification.
            let local_open = f64::from(feat.vegh[i]) < config.open_max_height_m
                && f64::from(feat.high_share[i]) < 0.07
                && gnd_m5 >= open_gnd_min;
            let patch_open = open_frac7 >= 0.52
                && vegh_m5 < config.open_max_height_m * 1.45
                && high_m5 < 0.12
                && gnd_m5 >= open_gnd_min;
            let is_open = local_open || patch_open;

            let is_semi = (open_frac9 >= 0.46
                && tree_frac9 >= 0.22
                && tree_frac9 <= 0.56
                && gnd_m5 >= open_gnd_min - 0.06
                && mid_m5 < 0.085)
                || (is_open && tree_frac9 >= 0.30 && high_m5 >= 0.07);

            if is_semi {
                raw_land[i] = LAB_SEMI;
            } else if is_open {
                raw_land[i] = LAB_OPEN;
            } else if !is_steep && vegh_m5 >= 1.8 {
                // 2. Green (406/408/410): combines 1-3 m shrub density + Beer-Lambert canopy closure.
                let shrub = 0.65 * mid_m5 + 0.35 * mid_m11;
                let g_mix = (0.60 * gnd_m5 + 0.40 * gnd_m11).clamp(0.06, 1.0);
                let lai_excess = (-g_mix.ln() - 0.74).max(0.0) * 0.22;
                let high_excess = (0.60 * high_m5 + 0.40 * high_m11 - 0.42).max(0.0);
                let canopy_closure = 0.55 * lai_excess + 0.45 * high_excess;
                let green_score = (shrub + c_wt * canopy_closure) * g_scale;

                raw_land[i] = if green_score >= g_hi {
                    LAB_GREEN_410
                } else if green_score >= g_med {
                    LAB_GREEN_408
                } else if green_score >= g_lo {
                    LAB_GREEN_406
                } else {
                    LAB_FOREST
                };
            } else {
                raw_land[i] = LAB_FOREST;
            }

            // 3. Undergrowth (407/409): strictly in forest (never on open/semi yellow, water, or steep cliffs).
            if !is_steep
                && vegh_m5 >= 2.0
                && (raw_land[i] == LAB_FOREST || raw_land[i] == LAB_GREEN_406)
                && low_m5 >= 0.025
            {
                let low_mix = 0.68 * low_m5 + 0.32 * low_m11;
                let forest_shrub = 0.14 * mid_m5 * (gnd_m11 - 0.38).clamp(0.0, 0.62);
                let u_score = low_mix + forest_shrub;
                if u_score >= u_th * 1.65 {
                    raw_und[i] = 2;
                } else if u_score >= u_th {
                    raw_und[i] = 1;
                }
            }
        }
    }

    // Spatial generalization: controllable soft-majority pass + connected-component island filtering.
    let cell_area = feat.world.cell * feat.world.cell;
    let min_cells = (config.min_veg_area_m2 / cell_area).round().max(2.0) as usize;
    let veg_sigma = (config.veg_smooth as f32).clamp(0.0, 3.0);
    let smoothed = soft_majority(&raw_land, w, h, veg_sigma);
    let land = remove_small_islands(&smoothed, w, h, min_cells);

    let und_valid: Vec<u8> = (0..n)
        .map(|i| {
            u8::from(
                active[i] != 0
                    && (land[i] == LAB_FOREST || land[i] == LAB_GREEN_406)
                    && feat.vegh[i] >= 1.5,
            )
        })
        .collect();
    let und_sigma = if veg_sigma <= 0.25 { 0.0 } else { (veg_sigma * 1.15).clamp(0.5, 2.5) };
    let undergrowth = clean_undergrowth(&raw_und, &und_valid, w, h, (min_cells / 2).max(10), und_sigma);

    // Tally hectares per class.
    let mut cnt = [0u64; 7];
    let mut u407 = 0u64;
    let mut u409 = 0u64;
    for i in 0..n {
        cnt[land[i] as usize] += 1;
        if undergrowth[i] == 1 {
            u407 += 1;
        } else if undergrowth[i] == 2 {
            u409 += 1;
        }
    }
    let to_ha = |k: u64| ((k as f64 * cell_area) / 100.0).round() / 100.0;

    VegResult {
        width: w,
        height: h,
        world: feat.world,
        land,
        undergrowth,
        ha_white: to_ha(cnt[LAB_FOREST as usize]),
        ha_open: to_ha(cnt[LAB_OPEN as usize]),
        ha_semi: to_ha(cnt[LAB_SEMI as usize]),
        ha_green406: to_ha(cnt[LAB_GREEN_406 as usize]),
        ha_green408: to_ha(cnt[LAB_GREEN_408 as usize]),
        ha_green410: to_ha(cnt[LAB_GREEN_410 as usize]),
        ha_und407: to_ha(u407),
        ha_und409: to_ha(u409),
    }
}

/// Writes `vegetationsklasser.png` + `.pgw` in exact O-Tid `scripts/geo-vegetation.ts` encoding:
/// - `A = 0` for water / nodata
/// - `R = low | (undergrowth << 4)` where `low`: `1 = open/semi`, `2 = white forest`,
///   `4 = green 406`, `5 = green 408`, `6 = green 410`; `undergrowth`: `1 = 407`, `2 = 409`
/// - `G = 160`, `B = R`, `A = 200` (`SEMI_ALPHA`) for semi-open, `A = 255` for all other land.
pub fn write_vegetation_png(out_dir: &Path, veg: &VegResult) -> Result<(), String> {
    let n = veg.width * veg.height;
    let mut rgba = vec![0u8; n * 4];
    for i in 0..n {
        let lab = veg.land[i];
        if lab == LAB_NONE {
            continue;
        }
        let low = match lab {
            LAB_OPEN | LAB_SEMI => 1u8,
            LAB_FOREST => 2u8,
            LAB_GREEN_406 => 4u8,
            LAB_GREEN_408 => 5u8,
            LAB_GREEN_410 => 6u8,
            _ => 0u8,
        };
        let und = veg.undergrowth[i].min(2);
        let r_val = low | (und << 4);
        let alpha = if lab == LAB_SEMI { SEMI_ALPHA } else { 255 };
        let o = i * 4;
        rgba[o] = r_val;
        rgba[o + 1] = 160;
        rgba[o + 2] = r_val;
        rgba[o + 3] = alpha;
    }
    write_rgba_png(&out_dir.join("vegetationsklasser.png"), veg.width, veg.height, &rgba)?;
    std::fs::write(out_dir.join("vegetationsklasser.pgw"), veg.world.to_pgw())
        .map_err(|e| format!("Failed to write vegetationsklasser.pgw: {e}"))
}
