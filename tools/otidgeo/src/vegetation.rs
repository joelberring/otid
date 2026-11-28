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
/// Bit 7 of the blue channel in `vegetationsklasser.png` marks tall closed-canopy timber
/// (`vegh >= 16 m && ground_share <= 0.26`) for drained spruce-plantation suppression in `moisture.rs`.
/// Leaves `R` (class + undergrowth), `G` (`160`), and `A` (`0 | 200 | 255`) 100% unchanged.
pub const TALL_DENSE_CANOPY_BIT: u8 = 0x80;

/// Classified 2 m vegetation & undergrowth rasters plus hectare summary.
pub struct VegResult {
    pub width: usize,
    pub height: usize,
    pub world: WorldTransform,
    /// Land-cover partition (`LAB_NONE..=LAB_GREEN_410`).
    pub land: Vec<u8>,
    /// Undergrowth overlay (`0 = none`, `1 = 407`, `2 = 409`).
    pub undergrowth: Vec<u8>,
    /// 1 where 5x5 local canopy is tall closed-canopy timber (`vegh >= 16 m && ground_share <= 0.26`).
    pub tall_dense: Vec<u8>,
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

/// Chamfer distance (3 orthogonal, 4 diagonal, in 1/3-cell units) to the nearest `target[i] != 0` cell.
fn chamfer_dist(target: &[u8], w: usize, h: usize) -> Vec<u16> {
    const FAR: u16 = u16::MAX / 2;
    let n = w * h;
    let mut out = vec![FAR; n];
    for i in 0..n {
        if target[i] != 0 {
            out[i] = 0;
        }
    }
    for r in 0..h {
        let base = r * w;
        for c in 0..w {
            let i = base + c;
            let mut best = out[i];
            if best == 0 {
                continue;
            }
            if c > 0 {
                best = best.min(out[i - 1].saturating_add(3));
            }
            if r > 0 {
                best = best.min(out[i - w].saturating_add(3));
                if c > 0 {
                    best = best.min(out[i - w - 1].saturating_add(4));
                }
                if c + 1 < w {
                    best = best.min(out[i - w + 1].saturating_add(4));
                }
            }
            out[i] = best.min(FAR);
        }
    }
    for r in (0..h).rev() {
        let base = r * w;
        for c in (0..w).rev() {
            let i = base + c;
            let mut best = out[i];
            if best == 0 {
                continue;
            }
            if c + 1 < w {
                best = best.min(out[i + 1].saturating_add(3));
            }
            if r + 1 < h {
                best = best.min(out[i + w].saturating_add(3));
                if c + 1 < w {
                    best = best.min(out[i + w + 1].saturating_add(4));
                }
                if c > 0 {
                    best = best.min(out[i + w - 1].saturating_add(4));
                }
            }
            out[i] = best.min(FAR);
        }
    }
    out
}

/// Cells removed by a morphological disk opening of `radius_cells` across all labels simultaneously.
fn thin_cells(labels: &[u8], inside: &[u16], w: usize, h: usize, radius_cells: f32) -> Vec<u8> {
    let limit = (radius_cells * 3.0).round().max(1.0) as u16;
    let n = w * h;
    let mut core = vec![0u8; n];
    for i in 0..n {
        if labels[i] != LAB_NONE && inside[i].saturating_add(3) > limit {
            core[i] = 1;
        }
    }
    let back = chamfer_dist(&core, w, h);
    let mut out = vec![0u8; n];
    for i in 0..n {
        if labels[i] != LAB_NONE && back[i] > limit {
            out[i] = 1;
        }
    }
    out
}

/// Maximum and minimum non-zero label within `(2 * radius + 1)` square around each cell (O(W*H) separable).
fn label_range(labels: &[u8], w: usize, h: usize, radius: usize) -> (Vec<u8>, Vec<u8>) {
    let n = w * h;
    let pass_rows = |src: &[u8], want_high: bool| -> Vec<u8> {
        let mut out = vec![0u8; n];
        let mut counts = [0i32; 8];
        for r in 0..h {
            counts.fill(0);
            let base = r * w;
            let init_end = radius.min(w.saturating_sub(1));
            for c in 0..=init_end {
                counts[src[base + c] as usize] += 1;
            }
            for c in 0..w {
                let mut val = 0u8;
                if want_high {
                    for v in (1..=7).rev() {
                        if counts[v] > 0 {
                            val = v as u8;
                            break;
                        }
                    }
                } else {
                    for v in 1..=7 {
                        if counts[v] > 0 {
                            val = v as u8;
                            break;
                        }
                    }
                }
                out[base + c] = val;
                if c + radius + 1 < w {
                    counts[src[base + c + radius + 1] as usize] += 1;
                }
                if c >= radius {
                    counts[src[base + c - radius] as usize] -= 1;
                }
            }
        }
        out
    };
    let pass_cols = |src: &[u8], want_high: bool| -> Vec<u8> {
        let mut out = vec![0u8; n];
        let mut counts = [0i32; 8];
        for c in 0..w {
            counts.fill(0);
            let init_end = radius.min(h.saturating_sub(1));
            for r in 0..=init_end {
                counts[src[r * w + c] as usize] += 1;
            }
            for r in 0..h {
                let mut val = 0u8;
                if want_high {
                    for v in (1..=7).rev() {
                        if counts[v] > 0 {
                            val = v as u8;
                            break;
                        }
                    }
                } else {
                    for v in 1..=7 {
                        if counts[v] > 0 {
                            val = v as u8;
                            break;
                        }
                    }
                }
                out[r * w + c] = val;
                if r + radius + 1 < h {
                    counts[src[(r + radius + 1) * w + c] as usize] += 1;
                }
                if r >= radius {
                    counts[src[(r - radius) * w + c] as usize] -= 1;
                }
            }
        }
        out
    };
    let high = pass_cols(&pass_rows(labels, true), true);
    let low = pass_cols(&pass_rows(labels, false), false);
    (high, low)
}

/// Reassigns `candidate` cells to the nearest non-candidate neighbor of a different label via BFS.
fn reassign_candidates(labels: &[u8], candidate: &[u8], w: usize, h: usize) -> Vec<u8> {
    let n = labels.len();
    let mut out = labels.to_vec();
    let mut owner = vec![0u8; n];
    let mut queue = Vec::<usize>::new();
    let cand_indices: Vec<usize> = (0..n).filter(|&i| candidate[i] != 0).collect();

    for lab in [LAB_OPEN, LAB_SEMI, LAB_FOREST, LAB_GREEN_406, LAB_GREEN_408, LAB_GREEN_410] {
        queue.clear();
        let mut any = false;
        for &i in &cand_indices {
            if labels[i] != lab {
                continue;
            }
            any = true;
            let r = i / w;
            let c = i - r * w;
            let mut counts = [0u8; 8];
            let mut best = 0u8;
            let mut best_cnt = 0u8;
            let nbrs = [
                (c > 0).then(|| i - 1),
                (c + 1 < w).then(|| i + 1),
                (r > 0).then(|| i - w),
                (r + 1 < h).then(|| i + w),
            ];
            for nb in nbrs.into_iter().flatten() {
                let nl = labels[nb];
                if candidate[nb] == 0 && nl != LAB_NONE && nl != lab {
                    counts[nl as usize] += 1;
                    let cnt = counts[nl as usize];
                    if cnt > best_cnt || (cnt == best_cnt && lab != LAB_GREEN_406 && nl > best) {
                        best_cnt = cnt;
                        best = nl;
                    }
                }
            }
            if best != 0 {
                owner[i] = best;
                queue.push(i);
            }
        }
        if !any {
            continue;
        }
        let mut head = 0usize;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            out[i] = owner[i];
            let r = i / w;
            let c = i - r * w;
            let nbrs = [
                (c > 0).then(|| i - 1),
                (c + 1 < w).then(|| i + 1),
                (r > 0).then(|| i - w),
                (r + 1 < h).then(|| i + w),
            ];
            for nb in nbrs.into_iter().flatten() {
                if candidate[nb] != 0 && labels[nb] == lab && owner[nb] == 0 {
                    owner[nb] = owner[i];
                    queue.push(nb);
                }
            }
        }
        for &i in &queue {
            owner[i] = 0;
        }
    }
    out
}

/// Morphological opening (`thin_radius_cells`) + narrow intermediate `406` onion-ring halo stripping.
fn remove_thin_and_halos(
    labels: &[u8],
    w: usize,
    h: usize,
    thin_radius_cells: f32,
    halo_radius_cells: f32,
    halo_check_radius: usize,
) -> Vec<u8> {
    if w < 3 || h < 3 {
        return labels.to_vec();
    }
    let n = w * h;
    let mut edge = vec![0u8; n];
    for r in 0..h {
        let base = r * w;
        for c in 0..w {
            let i = base + c;
            let lab = labels[i];
            if lab == LAB_NONE {
                edge[i] = 1;
                continue;
            }
            if (c > 0 && labels[i - 1] != lab)
                || (c + 1 < w && labels[i + 1] != lab)
                || (r > 0 && labels[i - w] != lab)
                || (r + 1 < h && labels[i + w] != lab)
            {
                edge[i] = 1;
            }
        }
    }
    let inside = chamfer_dist(&edge, w, h);
    let thin = thin_cells(labels, &inside, w, h, thin_radius_cells);
    let band = thin_cells(labels, &inside, w, h, halo_radius_cells);
    let (high, low) = label_range(labels, w, h, halo_check_radius);

    let mut candidate = vec![0u8; n];
    for i in 0..n {
        let lab = labels[i];
        if thin[i] != 0 {
            candidate[i] = 1;
        } else if band[i] != 0
            && lab == LAB_GREEN_406
            && high[i] >= LAB_GREEN_408
            && low[i] != LAB_NONE
            && low[i] < LAB_GREEN_406
        {
            candidate[i] = 1;
        }
    }
    reassign_candidates(labels, &candidate, w, h)
}

/// Lightweight 1-pass sprint generalization (2x2 / ~0.8-cell morphological opening + 1-cell `406` sliver
/// stripping next to `408|410`): removes 1-cell (`2 m`) spikes and crust slivers while preserving narrow
/// `>= 4 m` sprint hedges and standalone `406` patches.
fn remove_thin_and_halos_sprint(labels: &[u8], w: usize, h: usize) -> Vec<u8> {
    if w < 3 || h < 3 {
        return labels.to_vec();
    }
    let n = w * h;
    let mut in_2x2 = vec![0u8; n];
    for r in 0..(h - 1) {
        let row0 = r * w;
        let row1 = row0 + w;
        for c in 0..(w - 1) {
            let lab = labels[row0 + c];
            if lab != LAB_NONE
                && labels[row0 + c + 1] == lab
                && labels[row1 + c] == lab
                && labels[row1 + c + 1] == lab
            {
                in_2x2[row0 + c] = 1;
                in_2x2[row0 + c + 1] = 1;
                in_2x2[row1 + c] = 1;
                in_2x2[row1 + c + 1] = 1;
            }
        }
    }
    let mut candidate = vec![0u8; n];
    for r in 0..h {
        let base = r * w;
        for c in 0..w {
            let i = base + c;
            let lab = labels[i];
            if lab == LAB_NONE {
                continue;
            }
            if in_2x2[i] == 0 {
                candidate[i] = 1;
                continue;
            }
            // Strip 1-cell (`2 m`) `406` slivers directly touching BOTH non-green (`< 406`) and dense (`>= 408`).
            if lab == LAB_GREEN_406 {
                let mut touches_low = false;
                let mut touches_high = false;
                let nbrs = [
                    (c > 0).then(|| i - 1),
                    (c + 1 < w).then(|| i + 1),
                    (r > 0).then(|| i - w),
                    (r + 1 < h).then(|| i + w),
                ];
                for nb in nbrs.into_iter().flatten() {
                    let nl = labels[nb];
                    if nl != LAB_NONE && nl < LAB_GREEN_406 {
                        touches_low = true;
                    } else if nl >= LAB_GREEN_408 {
                        touches_high = true;
                    }
                }
                if touches_low && touches_high {
                    candidate[i] = 1;
                }
            }
        }
    }
    reassign_candidates(labels, &candidate, w, h)
}

/// Fills tiny interior non-green holes (`< max_hole_cells`) completely enclosed by green (`406`/`408`/`410`).
fn fill_small_green_holes(labels: &mut [u8], water: &[u8], w: usize, h: usize, max_hole_cells: usize) {
    if max_hole_cells <= 1 || w < 3 || h < 3 {
        return;
    }
    let n = w * h;
    let mut seen = vec![0u8; n];
    let mut queue = Vec::<usize>::with_capacity(max_hole_cells * 2);
    for start in 0..n {
        let lab = labels[start];
        if seen[start] != 0 || lab == LAB_NONE || lab >= LAB_GREEN_406 || water[start] != 0 {
            continue;
        }
        seen[start] = 1;
        queue.clear();
        queue.push(start);
        let mut head = 0usize;
        let mut touches_outside = false;
        let mut green_votes = [0u32; 8];
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let r = i / w;
            let c = i - r * w;
            if r == 0 || r + 1 == h || c == 0 || c + 1 == w {
                touches_outside = true;
            }
            let nbrs = [
                (c > 0).then(|| i - 1),
                (c + 1 < w).then(|| i + 1),
                (r > 0).then(|| i - w),
                (r + 1 < h).then(|| i + w),
            ];
            for nb in nbrs.into_iter().flatten() {
                let nl = labels[nb];
                if nl == LAB_NONE || water[nb] != 0 {
                    touches_outside = true;
                } else if nl >= LAB_GREEN_406 {
                    green_votes[nl as usize] += 1;
                } else if seen[nb] == 0 {
                    seen[nb] = 1;
                    queue.push(nb);
                }
            }
        }
        if !touches_outside && queue.len() < max_hole_cells {
            let mut best_lab = 0u8;
            let mut best_cnt = 0u32;
            for l in LAB_GREEN_406..=LAB_GREEN_410 {
                if green_votes[l as usize] > best_cnt {
                    best_cnt = green_votes[l as usize];
                    best_lab = l;
                }
            }
            if best_lab != 0 {
                for &i in &queue {
                    labels[i] = best_lab;
                }
            }
        }
    }
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
    let mut tall_dense = vec![0u8; n];

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

            // Tall closed-canopy timber (`vegh_m5 >= 16.0 m && gnd_m5 <= 0.26` over 5x5 = 10 m window):
            // suppresses drained spruce plantations (Lida E5 18.4 m / 0.20) while sparing E2 (16.6 m / 0.40) wooded bogs.
            if vegh_m5 >= 16.0 && gnd_m5 <= 0.26 {
                tall_dense[i] = 1;
            }

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
                    // Closed canopy (`eh5 >= 0.46 && eg5 <= 0.40`) occludes mid-level LiDAR returns,
                    // so skip downward understory gating and apply Beer-Lambert canopy-occlusion compensation.
                    let understory_gate = if eh5 >= 0.46 && eg5 <= 0.40 {
                        let h_occ = ((eh5 - 0.46) / 0.20).clamp(0.0, 1.0);
                        let g_occ = ((0.40 - eg5) / 0.20).clamp(0.0, 1.0);
                        1.0 + 0.48 * h_occ * g_occ
                    } else {
                        ((em5 + 0.35 * low_m5 - 0.015) / 0.055).clamp(0.90, 1.0)
                    };
                    // Mild open-floor brush penalty (`eg5 > 0.46 && eh5 < 0.36`) trims sparse heather/clear-cut
                    // slash FP without suppressing closed-canopy or young mixed green.
                    let open_floor_pen = if eg5 > 0.46 && eh5 < 0.36 {
                        let g_fac = ((eg5 - 0.46) / 0.18).clamp(0.0, 1.0);
                        let h_fac = ((0.36 - eh5) / 0.22).clamp(0.0, 1.0);
                        1.0 - 0.12 * g_fac * h_fac
                    } else {
                        1.0
                    };
                    let base_score =
                        (shrub_calm + c_wt * understory_gate * canopy_calm) * open_floor_pen * g_scale;

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
    let mut land = if veg_sigma > 0.25 {
        if sprint {
            // Sprint (2 m): single light pass (2x2 / ~0.8-cell opening + 1-cell 406 sliver strip next to 408|410)
            // so narrow sprint thickets & standalone 406 survive while 2 m spikes/slivers are cleaned.
            let opened = remove_thin_and_halos_sprint(&smoothed, w, h);
            remove_small_islands(&opened, w, h, min_cells)
        } else {
            let thin_rad = 1.5f32;
            let halo_rad = 2.4f32;
            let halo_check_rad = (8.0 / feat.world.cell).round().max(2.0) as usize;
            let opened = remove_thin_and_halos(&smoothed, w, h, thin_rad, halo_rad, halo_check_rad);
            let deislanded = remove_small_islands(&opened, w, h, min_cells);
            let cleaned = remove_thin_and_halos(&deislanded, w, h, thin_rad, halo_rad, halo_check_rad);
            remove_small_islands(&cleaned, w, h, min_cells)
        }
    } else {
        remove_small_islands(&smoothed, w, h, min_cells)
    };
    if veg_sigma > 0.25 {
        let hole_m2 = if sprint { 100.0 } else { 300.0 };
        let hole_cells = (hole_m2 / cell_area).round().max(2.0) as usize;
        fill_small_green_holes(&mut land, &feat.water, w, h, hole_cells);
    }

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
        tall_dense,
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
/// - `G = 160`, `B = R | (tall_dense ? 0x80 : 0)`, `A = 200` (`SEMI_ALPHA`) for semi-open, `A = 255` for all other land.
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
        let tall_bit = if veg.tall_dense.get(i).copied().unwrap_or(0) != 0 {
            TALL_DENSE_CANOPY_BIT
        } else {
            0
        };
        let alpha = if lab == LAB_SEMI { SEMI_ALPHA } else { 255 };
        let o = i * 4;
        rgba[o] = r_val;
        rgba[o + 1] = 160;
        rgba[o + 2] = r_val | tall_bit;
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
    fn closed_canopy_green_retained_open_floor_trimmed_and_leaf_off_thicket_hits_408() {
        let (w, h) = (50, 50);
        let mut feat = blank_features(w, h);
        // Whole forest: closed-canopy dark spruce/young forest (`eh5 >= 0.50 && eg5 <= 0.40`)
        // whose dense canopy occludes mid-level LiDAR returns (`mid = 0.04`, `gnd = 0.22`, `high = 0.65`, `vegh = 18 m`).
        // Must retain green (>= 406) AND set `tall_dense` flag (`vegh >= 16 && gnd <= 0.26`).
        for i in 0..(w * h) {
            feat.vegh[i] = 18.0;
            feat.ground_share[i] = 0.22;
            feat.low_share[i] = 0.01;
            feat.mid_share[i] = 0.04;
            feat.high_share[i] = 0.65;
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
        assert!(
            res.land[5 * w + 5] >= LAB_GREEN_406,
            "Closed-canopy forest occluding mid returns must retain green (>= 406), got {}",
            res.land[5 * w + 5]
        );
        assert_eq!(res.tall_dense[5 * w + 5], 1, "Tall dense canopy (vegh=18, gnd=0.22) must set tall_dense");
        assert_eq!(res.tall_dense[25 * w + 25], 0, "Low 3.5 m thicket must NOT set tall_dense");
        assert!(
            res.land[25 * w + 25] >= LAB_GREEN_408,
            "Leaf-off deciduous thicket with strong low+mid ratio must reach 408/410, got {}",
            res.land[25 * w + 25]
        );

        // Verify `write_vegetation_png` encodes `TALL_DENSE_CANOPY_BIT` in B while keeping R, G=160, A intact.
        let dir = std::env::temp_dir().join(format!("otidgeo-veg-tall-bit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        write_vegetation_png(&dir, &res).unwrap();
        let img = crate::bench_io::read_rgba_png(&dir.join("vegetationsklasser.png")).unwrap();
        let o_tall = (5 * w + 5) * 4;
        assert_eq!(img.data[o_tall] & 15, 4);
        assert_eq!(img.data[o_tall + 1], 160);
        assert_ne!(img.data[o_tall + 2] & TALL_DENSE_CANOPY_BIT, 0);
        assert_eq!(img.data[o_tall + 2] & 15, 4);
        assert_eq!(img.data[o_tall + 3], 255);
        let o_low = (25 * w + 25) * 4;
        assert_eq!(img.data[o_low + 1], 160);
        assert_eq!(img.data[o_low + 2] & TALL_DENSE_CANOPY_BIT, 0);
        let _ = std::fs::remove_dir_all(&dir);

        // Open-floor sparse brush (`eg5 = 0.56 > 0.42 && eh5 = 0.20 < 0.40`, borderline mid=0.095)
        // must be trimmed to white forest by the open-floor brush penalty.
        let mut brush = blank_features(40, 40);
        for i in 0..(40 * 40) {
            brush.vegh[i] = 8.0;
            brush.ground_share[i] = 0.56;
            brush.low_share[i] = 0.03;
            brush.mid_share[i] = 0.095;
            brush.high_share[i] = 0.20;
        }
        let bres = classify_vegetation(&brush, &cfg);
        assert_eq!(
            bres.land[20 * 40 + 20],
            LAB_FOREST,
            "Open-floor sparse brush (gnd=0.56, high=0.20, mid=0.095) must stay white (405), got {}",
            bres.land[20 * 40 + 20]
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

    #[test]
    fn strips_narrow_406_onion_ring_halos_and_fills_small_green_holes() {
        let (w, h) = (70, 70);
        let mut labels = vec![LAB_FOREST; w * h];
        let mut water = vec![0u8; w * h];

        // 1. Dense 408 block at r=10..30, c=10..30 wrapped in a narrow 3-cell (6 m) 406 halo (r=7..33, c=7..33).
        for r in 7..33 {
            for c in 7..33 {
                labels[r * w + c] = LAB_GREEN_406;
            }
        }
        for r in 10..30 {
            for c in 10..30 {
                labels[r * w + c] = LAB_GREEN_408;
            }
        }
        // Small interior 5x5 cell (100 m² < 300 m²) white forest hole inside the 408 block.
        for r in 17..22 {
            for c in 17..22 {
                labels[r * w + c] = LAB_FOREST;
            }
        }

        // 2. Wide genuine 16x16 cell (32x32 m) 406 stand at r=42..58, c=10..26 (must SURVIVE halo stripping!).
        for r in 42..58 {
            for c in 10..26 {
                labels[r * w + c] = LAB_GREEN_406;
            }
        }

        // 3. Large 408 block at r=40..64, c=40..64 with a small 4x4 water pond inside (must NOT be filled!).
        for r in 40..64 {
            for c in 40..64 {
                labels[r * w + c] = LAB_GREEN_408;
            }
        }
        for r in 50..54 {
            for c in 50..54 {
                labels[r * w + c] = LAB_NONE;
                water[r * w + c] = 1;
            }
        }

        let mut cleaned = remove_thin_and_halos(&labels, w, h, 1.5, 2.0, 4);
        fill_small_green_holes(&mut cleaned, &water, w, h, 75);

        // Narrow 6 m 406 onion ring around the 408 block must be completely collapsed into 405 or 408.
        let mut halo_left = 0usize;
        for r in 7..33 {
            for c in 7..33 {
                if cleaned[r * w + c] == LAB_GREEN_406 {
                    halo_left += 1;
                }
            }
        }
        assert_eq!(halo_left, 0, "Narrow 6 m 406 halo between 405 and 408 must be stripped, left {halo_left} cells");
        assert_eq!(cleaned[12 * w + 12], LAB_GREEN_408, "Dense 408 core must survive");
        assert_eq!(cleaned[19 * w + 19], LAB_GREEN_408, "Small 100 m² interior hole must be filled with 408");
        assert_eq!(cleaned[50 * w + 18], LAB_GREEN_406, "Wide 32x32 m 406 stand must survive");
        assert_eq!(cleaned[52 * w + 52], LAB_NONE, "Interior water pond must never be filled");

        // 4. Sprint 1-pass light cleaner: preserves standalone 4 m (2-cell) wide 406 patch & narrow 4 m 408 hedge,
        //    while stripping 1-cell (2 m) spikes and 1-cell 406 slivers sandwiched between 405 and 408.
        let (sw, sh) = (40, 40);
        let mut slabels = vec![LAB_FOREST; sw * sh];
        // Standalone 3x6 cell (6x12 m) 406 patch (must survive!).
        for r in 5..11 {
            for c in 5..8 {
                slabels[r * sw + c] = LAB_GREEN_406;
            }
        }
        // Narrow 2x8 cell (4x16 m) 408 hedge (must survive!).
        for r in 20..28 {
            for c in 5..7 {
                slabels[r * sw + c] = LAB_GREEN_408;
            }
        }
        // 1-cell spike jutting out of the 408 hedge (must be stripped!).
        slabels[24 * sw + 7] = LAB_GREEN_408;
        slabels[24 * sw + 8] = LAB_GREEN_408;
        // 8x8 cell 408 block wrapped in a 1-cell (2 m) 406 sliver (1-cell sliver must be stripped!).
        for r in 15..25 {
            for c in 20..30 {
                slabels[r * sw + c] = LAB_GREEN_406;
            }
        }
        for r in 16..24 {
            for c in 21..29 {
                slabels[r * sw + c] = LAB_GREEN_408;
            }
        }
        let scleaned = remove_thin_and_halos_sprint(&slabels, sw, sh);
        assert_eq!(scleaned[7 * sw + 6], LAB_GREEN_406, "Sprint standalone 406 patch must survive");
        assert_eq!(scleaned[23 * sw + 5], LAB_GREEN_408, "Sprint narrow 4 m 408 hedge must survive");
        assert_eq!(scleaned[24 * sw + 8], LAB_FOREST, "Sprint 1-cell spike must be stripped");
        assert_ne!(scleaned[15 * sw + 25], LAB_GREEN_406, "Sprint 1-cell 406 sliver next to 408 must be stripped");
    }
}
