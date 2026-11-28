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

/// Separable continuous-sigma 1D Gaussian blur (accurate for small sprint sigmas like 0.45 as well as 1.4+).
fn gaussian_blur(src: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    if sigma <= 0.25 || w < 2 || h < 2 {
        return src.to_vec();
    }
    let radius = (sigma * 2.5).ceil().max(1.0) as usize;
    let inv_2s2 = 1.0 / (2.0 * sigma * sigma);
    let mut kernel = Vec::with_capacity(2 * radius + 1);
    let mut ksum = 0.0f32;
    for k in -(radius as isize)..=(radius as isize) {
        let wt = (-(k * k) as f32 * inv_2s2).exp();
        kernel.push(wt);
        ksum += wt;
    }
    for wt in &mut kernel {
        *wt /= ksum;
    }

    let mut tmp = vec![0.0f32; w * h];
    for r in 0..h {
        let base = r * w;
        for c in 0..w {
            let mut acc = 0.0f32;
            for (ki, &kw) in kernel.iter().enumerate() {
                let sc = (c as isize + ki as isize - radius as isize).clamp(0, w as isize - 1) as usize;
                acc += src[base + sc] * kw;
            }
            tmp[base + c] = acc;
        }
    }

    let mut out = vec![0.0f32; w * h];
    for r in 0..h {
        let dst = r * w;
        for (ki, &kw) in kernel.iter().enumerate() {
            let sr = (r as isize + ki as isize - radius as isize).clamp(0, h as isize - 1) as usize;
            let src_row = &tmp[sr * w..(sr + 1) * w];
            for c in 0..w {
                out[dst + c] += src_row[c] * kw;
            }
        }
    }
    out
}

/// Nested soft-majority filter over the vegetation partition.
/// Uses `sigma` for calm open/semi/406 boundaries and tighter `dense_sigma` for compact 408/410 thickets.
fn soft_majority(labels: &[u8], w: usize, h: usize, sigma: f32, dense_sigma: f32) -> Vec<u8> {
    if sigma <= 0.25 {
        return labels.to_vec();
    }
    let n = labels.len();
    let known: Vec<f32> = labels.iter().map(|&v| if v != LAB_NONE { 1.0 } else { 0.0 }).collect();
    let weight = gaussian_blur(&known, w, h, sigma);
    let d_sig = dense_sigma.clamp(0.0, sigma);
    let d_weight = if (d_sig - sigma).abs() < 1e-3 {
        None
    } else {
        Some(gaussian_blur(&known, w, h, d_sig))
    };

    let blur_pred = |pred: fn(u8) -> bool, sig: f32, wt_slice: &[f32]| -> Vec<f32> {
        let mask: Vec<f32> = labels.iter().map(|&v| if pred(v) { 1.0 } else { 0.0 }).collect();
        let blurred = gaussian_blur(&mask, w, h, sig);
        blurred
            .into_iter()
            .zip(wt_slice.iter())
            .map(|(v, &wt)| v / (wt + 1e-6))
            .collect()
    };

    let g406 = blur_pred(|v| v >= LAB_GREEN_406, sigma, &weight);
    let d_wt = d_weight.as_deref().unwrap_or(&weight);
    let g408 = blur_pred(|v| v >= LAB_GREEN_408, d_sig, d_wt);
    let g410 = blur_pred(|v| v >= LAB_GREEN_410, d_sig, d_wt);
    let open = blur_pred(|v| v == LAB_OPEN, sigma, &weight);
    let semi = blur_pred(|v| v == LAB_SEMI, sigma, &weight);

    let mut out = vec![LAB_NONE; n];
    for i in 0..n {
        if labels[i] == LAB_NONE {
            continue;
        }
        let mut lab = if g406[i] > 0.5 {
            if g410[i] > 0.44 {
                LAB_GREEN_410
            } else if g408[i] > 0.46 {
                LAB_GREEN_408
            } else {
                LAB_GREEN_406
            }
        } else if g410[i] > 0.46 {
            LAB_GREEN_410
        } else if g408[i] > 0.50 {
            LAB_GREEN_408
        } else {
            LAB_FOREST
        };
        let o = open[i];
        let s = semi[i];
        if s > 0.5 && s > g406[i] && lab < LAB_GREEN_408 {
            lab = LAB_SEMI;
        }
        if o > 0.5 && o > g406[i] && lab < LAB_GREEN_408 {
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
            // Use slightly smaller thresholds for dense 408/410 pockets so compact thickets survive.
            let thresh = match lab {
                LAB_GREEN_410 => (min_cells / 2).max(4),
                LAB_GREEN_408 => ((min_cells * 2) / 3).max(5),
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
        let b1 = gaussian_blur(&m1, w, h, sigma);
        let b2 = gaussian_blur(&m2, w, h, sigma);

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
        .map(|i| {
            u8::from(
                active[i] != 0
                    && feat.vegh[i] < open_h
                    && feat.high_share[i] < 0.08
                    && feat.mid_share[i] < 0.08,
            )
        })
        .collect();
    let tree_cell_bits: Vec<u8> = (0..n)
        .map(|i| u8::from(active[i] != 0 && feat.vegh[i] > 3.0))
        .collect();
    // Woody (non-open) cells: used so adjacent open lawns/meadows never dilute forest/park-edge thickets in 5x5/11x11 means.
    let woody_bits: Vec<u8> = (0..n)
        .map(|i| u8::from(active[i] != 0 && open_cell_bits[i] == 0))
        .collect();
    let it_open_cell = Integral2D::from_binary(&open_cell_bits, w, h);
    let it_tree_cell = Integral2D::from_binary(&tree_cell_bits, w, h);
    let it_wcnt = Integral2D::from_binary(&woody_bits, w, h);
    let it_wgnd = Integral2D::from_masked(&feat.ground_share, &woody_bits, w, h);
    let it_wmid = Integral2D::from_masked(&feat.mid_share, &woody_bits, w, h);
    let it_whigh = Integral2D::from_masked(&feat.high_share, &woody_bits, w, h);

    let mut raw_land = vec![LAB_NONE; n];
    let mut raw_und = vec![0u8; n];

    let sprint = config.interval <= 3.0 || config.scale <= 5_000;
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
            let c3 = it_cnt.box_sum(c, r, 1).max(1.0);
            let c5 = it_cnt.box_sum(c, r, 2).max(1.0);
            let c7 = it_cnt.box_sum(c, r, 3).max(1.0);
            let c9 = it_cnt.box_sum(c, r, 4).max(1.0);
            let c11 = it_cnt.box_sum(c, r, 5).max(1.0);

            let vegh_m3 = it_vegh.box_sum(c, r, 1) / c3;
            let gnd_m3 = it_gnd.box_sum(c, r, 1) / c3;
            let low_m3 = it_low.box_sum(c, r, 1) / c3;
            let mid_m3 = it_mid.box_sum(c, r, 1) / c3;
            let high_m3 = it_high.box_sum(c, r, 1) / c3;

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

            // Detect compact dense low shrubs/bushes (0.8-2.0 m, low ground share, strong low+mid returns)
            // so park/edge thickets and sprint hedges classify as green instead of yellow open land.
            let bush_sig = mid_m3 + (if sprint { 0.35 } else { 0.45 }) * low_m3;
            let is_low_bush = !is_steep
                && vegh_m3 >= if sprint { 0.8 } else { 1.0 }
                && gnd_m3 < 0.65
                && bush_sig >= if sprint { 0.085 } else { 0.14 };

            // 1. Open (401/403) and Semi-open (402/404) classification.
            let local_open = !is_low_bush
                && f64::from(feat.vegh[i]) < config.open_max_height_m
                && f64::from(feat.high_share[i]) < 0.07
                && gnd_m5 >= open_gnd_min;
            let patch_open = !is_low_bush
                && open_frac7 >= 0.52
                && vegh_m5 < config.open_max_height_m * 1.45
                && high_m5 < 0.12
                && gnd_m5 >= open_gnd_min;
            let is_open = local_open || patch_open;

            let is_semi = !is_low_bush
                && ((open_frac9 >= 0.46
                    && tree_frac9 >= 0.22
                    && tree_frac9 <= 0.56
                    && gnd_m5 >= open_gnd_min - 0.06
                    && mid_m5 < 0.085)
                    || (is_open && tree_frac9 >= 0.30 && high_m5 >= 0.07));

            if is_semi {
                raw_land[i] = LAB_SEMI;
            } else if is_open {
                raw_land[i] = LAB_OPEN;
            } else if !is_steep && (if sprint { vegh_m3 >= 0.8 } else { vegh_m5 >= 1.8 || is_low_bush }) {
                if sprint {
                    // Sprint (1:4000): compact 3x3/5x5 shrub + light canopy closure so narrow hedges/thickets
                    // survive without over-greening tall open park trees or grassy/fern patches.
                    let shrub = 0.60 * mid_m3
                        + 0.40 * mid_m5
                        + 0.35 * (0.60 * low_m3 + 0.40 * low_m5);
                    let g_mix = (0.55 * gnd_m3 + 0.45 * gnd_m5).clamp(0.06, 1.0);
                    let lai_excess = (-g_mix.ln() - 0.74).max(0.0) * 0.22;
                    let high_excess = (0.55 * high_m3 + 0.45 * high_m5 - 0.42).max(0.0);
                    let canopy_closure = 0.55 * lai_excess + 0.45 * high_excess;
                    let score = (shrub + (c_wt * 0.25) * canopy_closure) * g_scale;
                    let mid_frac = mid_m3 / (mid_m3 + high_m3 + 0.05);
                    let score_408 = score + 1.8 * mid_m3 * (mid_frac - 0.16).max(0.0) * g_scale;

                    raw_land[i] = if score_408 >= g_hi * 0.72 {
                        LAB_GREEN_410
                    } else if score_408 >= g_med * 0.68 {
                        LAB_GREEN_408
                    } else if score >= g_lo * 0.78 {
                        LAB_GREEN_406
                    } else {
                        LAB_FOREST
                    };
                } else {
                    // Forest (1:10k-1:15k): keep continuous pine/spruce forest unmasked & calm, and only
                    // de-dilute woody cells next to genuine open meadows/lawns (open_frac11 > 0.18).
                    let open_frac11 = it_open_cell.box_sum(c, r, 5) / c11;
                    let wc5 = it_wcnt.box_sum(c, r, 2);
                    let wc11 = it_wcnt.box_sum(c, r, 5);
                    let edge_w = ((open_frac11 - 0.18) / 0.25).clamp(0.0, 1.0)
                        * (wc5 / 6.0).clamp(0.0, 1.0);
                    let blend_edge = |all_v: f64, w_sum: f64, wc: f64| -> f64 {
                        if edge_w > 0.0 && wc >= 1.0 {
                            let wv = w_sum / wc;
                            all_v + edge_w * (wv - all_v)
                        } else {
                            all_v
                        }
                    };
                    let em5 = blend_edge(mid_m5, it_wmid.box_sum(c, r, 2), wc5);
                    let em11 = blend_edge(mid_m11, it_wmid.box_sum(c, r, 5), wc11);
                    let eg5 = blend_edge(gnd_m5, it_wgnd.box_sum(c, r, 2), wc5);
                    let eg11 = blend_edge(gnd_m11, it_wgnd.box_sum(c, r, 5), wc11);
                    let eh5 = blend_edge(high_m5, it_whigh.box_sum(c, r, 2), wc5);
                    let eh11 = blend_edge(high_m11, it_whigh.box_sum(c, r, 5), wc11);

                    let shrub_calm = 0.65 * em5 + 0.35 * em11;
                    let g_mix = (0.60 * eg5 + 0.40 * eg11).clamp(0.06, 1.0);
                    let lai_excess = (-g_mix.ln() - 0.74).max(0.0) * 0.22;
                    let high_excess = (0.60 * eh5 + 0.40 * eh11 - 0.42).max(0.0);
                    let canopy_calm = 0.55 * lai_excess + 0.45 * high_excess;
                    // Gate tall-canopy contribution by real 0.3-3 m understory presence so mature
                    // clear-trunk white spruce/pine stands stay white (405) without suppressing 406 young forest.
                    let understory_gate = ((em5 + 0.35 * low_m5 - 0.015) / 0.055).clamp(0.55, 1.0);
                    let base_score = (shrub_calm + c_wt * understory_gate * canopy_calm) * g_scale;

                    // Eye-level foliage ratio mid/(mid+high) separates dense 408/410 thickets (even leaf-off
                    // deciduous shrubs) from tall clear-trunk 405/406 spruce/oak stands without over-greening white forest.
                    let mid_frac = em5 / (em5 + eh5 + 0.05);
                    let mid_frac3 = mid_m3 / (mid_m3 + high_m3 + 0.05);
                    let thicket_boost = if mid_frac.max(mid_frac3) >= 0.25 {
                        0.25 * low_m5 + 0.35 * (mid_m3 - em5).max(0.0) + 0.15 * mid_m3
                    } else {
                        0.0
                    };
                    let score_408 = base_score
                        + (1.8 * em5 * (mid_frac - 0.16).max(0.0) + thicket_boost) * g_scale;

                    raw_land[i] = if score_408 >= g_hi {
                        LAB_GREEN_410
                    } else if score_408 >= g_med {
                        LAB_GREEN_408
                    } else if base_score >= g_lo || (is_low_bush && mid_m3 >= g_lo) {
                        LAB_GREEN_406
                    } else {
                        LAB_FOREST
                    };
                }
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

    // Spatial generalization: scale-aware soft-majority (tighter for dense 408/410 & sprint) + island filter.
    let cell_area = feat.world.cell * feat.world.cell;
    let eff_min_area_m2 = if sprint && config.min_veg_area_m2 >= 250.0 {
        50.0
    } else {
        config.min_veg_area_m2
    };
    let min_cells = (eff_min_area_m2 / cell_area).round().max(2.0) as usize;
    let raw_sigma = (config.veg_smooth as f32).clamp(0.0, 3.0);
    let veg_sigma = if raw_sigma <= 0.25 {
        0.0
    } else if sprint {
        (raw_sigma * 0.45).clamp(0.35, 0.70)
    } else {
        (raw_sigma * 1.34).clamp(0.45, 3.0)
    };
    let dense_sigma = if veg_sigma <= 0.25 {
        0.0
    } else if sprint {
        veg_sigma
    } else {
        (raw_sigma * 1.08).clamp(0.40, 2.2)
    };
    let smoothed = soft_majority(&raw_land, w, h, veg_sigma, dense_sigma);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_features(w: usize, h: usize) -> VegFeatures {
        let n = w * h;
        VegFeatures {
            width: w,
            height: h,
            world: WorldTransform { cell: 2.0, x0: 1001.0, y0: 2000.0 + (h as f64) * 2.0 - 1.0 },
            valid: vec![1; n],
            water: vec![0; n],
            vegh: vec![12.0; n],
            ground_share: vec![0.48; n],
            low_share: vec![0.0; n],
            mid_share: vec![0.01; n],
            high_share: vec![0.45; n],
            return_ratio: vec![0.52; n],
            npts: vec![12.0; n],
            ground_intensity: vec![4000.0; n],
            spread: vec![0.04; n],
            slope_deg: vec![4.0; n],
        }
    }

    #[test]
    fn forest_preserves_compact_410_thicket_in_open_park_and_keeps_mature_forest_white() {
        let (w, h) = (50, 50);
        let mut feat = blank_features(w, h);
        // Left half: open park meadow. Right half: mature white forest.
        for r in 0..h {
            for c in 0..25 {
                let i = r * w + c;
                feat.vegh[i] = 0.1;
                feat.ground_share[i] = 0.95;
                feat.mid_share[i] = 0.0;
                feat.high_share[i] = 0.0;
            }
        }
        // Compact 14x14 m (7x7 cells) dense thicket (vegh=4.5m, mid=0.24, gnd=0.38) right inside open park!
        for r in 18..25 {
            for c in 9..16 {
                let i = r * w + c;
                feat.vegh[i] = 4.5;
                feat.ground_share[i] = 0.38;
                feat.low_share[i] = 0.06;
                feat.mid_share[i] = 0.24;
                feat.high_share[i] = 0.25;
            }
        }
        let cfg = EngineConfig::defaults_for_interval(5.0);
        let res = classify_vegetation(&feat, &cfg);
        assert!(
            res.land[21 * w + 12] >= LAB_GREEN_408,
            "Compact dense park thicket must survive as 408/410, got {}",
            res.land[21 * w + 12]
        );
        assert_eq!(res.land[25 * w + 40], LAB_FOREST, "Mature open-understory forest must stay white");
        assert_eq!(res.land[5 * w + 5], LAB_OPEN, "Open meadow must stay open");
    }

    #[test]
    fn sprint_detects_compact_low_dense_shrub_as_green_not_open() {
        let (w, h) = (40, 40);
        let mut feat = blank_features(w, h);
        // Open lawn background.
        for i in 0..(w * h) {
            feat.vegh[i] = 0.1;
            feat.ground_share[i] = 0.96;
            feat.mid_share[i] = 0.0;
            feat.low_share[i] = 0.0;
            feat.high_share[i] = 0.0;
        }
        // Small 10x10 m (5x5 cells = 100 m²) dense low bush/hedge (vegh=1.3m, gnd=0.45, mid=0.14, low=0.12).
        for r in 15..20 {
            for c in 15..20 {
                let i = r * w + c;
                feat.vegh[i] = 1.3;
                feat.ground_share[i] = 0.45;
                feat.low_share[i] = 0.12;
                feat.mid_share[i] = 0.14;
                feat.high_share[i] = 0.02;
            }
        }
        let cfg = EngineConfig::defaults_for_interval(2.5);
        let res = classify_vegetation(&feat, &cfg);
        assert!(
            res.land[17 * w + 17] >= LAB_GREEN_406,
            "Sprint low dense bush (100 m²) must classify as green, got {}",
            res.land[17 * w + 17]
        );
        assert_eq!(res.land[5 * w + 5], LAB_OPEN, "Surrounding sprint lawn must stay open");
    }

    #[test]
    fn mature_dense_canopy_over_empty_understory_stays_white_and_leaf_off_thicket_hits_408() {
        let (w, h) = (50, 50);
        let mut feat = blank_features(w, h);
        // Whole forest: tall mature spruce canopy (gnd=0.14, high=0.83) over empty understory (mid=0.02, low=0.01).
        for i in 0..(w * h) {
            feat.vegh[i] = 18.0;
            feat.ground_share[i] = 0.14;
            feat.low_share[i] = 0.01;
            feat.mid_share[i] = 0.02;
            feat.high_share[i] = 0.83;
        }
        // Compact 20x20 m (10x10 cells = 400 m², above min_veg_area_m2 = 300 m²) leaf-off deciduous thicket
        // (vegh=3.5m, gnd=0.44, low=0.12, mid=0.12, high=0.18).
        for r in 20..30 {
            for c in 20..30 {
                let i = r * w + c;
                feat.vegh[i] = 3.5;
                feat.ground_share[i] = 0.44;
                feat.low_share[i] = 0.12;
                feat.mid_share[i] = 0.12;
                feat.high_share[i] = 0.18;
            }
        }
        let cfg = EngineConfig::defaults_for_interval(5.0);
        let res = classify_vegetation(&feat, &cfg);
        assert_eq!(
            res.land[5 * w + 5],
            LAB_FOREST,
            "Tall mature dense spruce canopy over empty understory must stay white (405), got {}",
            res.land[5 * w + 5]
        );
        assert!(
            res.land[25 * w + 25] >= LAB_GREEN_408,
            "Leaf-off deciduous thicket with strong low+mid ratio must reach 408/410, got {}",
            res.land[25 * w + 25]
        );

        // Sprint: grassy/fern understory patch under sparse park trees must stay white (not 406),
        // while compact eye-level park hedge reaches 408/410.
        let mut sfeat = blank_features(40, 40);
        for i in 0..(40 * 40) {
            sfeat.vegh[i] = 8.0;
            sfeat.ground_share[i] = 0.50;
            sfeat.low_share[i] = 0.08;
            sfeat.mid_share[i] = 0.025;
            sfeat.high_share[i] = 0.35;
        }
        for r in 16..22 {
            for c in 16..22 {
                let i = r * 40 + c;
                sfeat.vegh[i] = 2.6;
                sfeat.ground_share[i] = 0.42;
                sfeat.low_share[i] = 0.08;
                sfeat.mid_share[i] = 0.10;
                sfeat.high_share[i] = 0.09;
            }
        }
        let scfg = EngineConfig::defaults_for_interval(2.5);
        let sres = classify_vegetation(&sfeat, &scfg);
        assert_eq!(
            sres.land[5 * 40 + 5],
            LAB_FOREST,
            "Sprint grassy/fern patch under sparse park trees must stay white, got {}",
            sres.land[5 * 40 + 5]
        );
        assert!(
            sres.land[19 * 40 + 19] >= LAB_GREEN_408,
            "Sprint compact park hedge must classify as 408/410, got {}",
            sres.land[19 * 40 + 19]
        );
    }
}
