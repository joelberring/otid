//! Seamless whole-area DEM gap filling, Gaussian smoothing, topography-preserving
//! curvature enhancement, slope, and multi-scale topographic position (TPI).

use crate::types::{DemGrid, EngineConfig, WorldTransform};
use rayon::prelude::*;

/// Prepared terrain surfaces derived from the raw 1 m DEM.
pub struct PreparedDem {
    pub width: usize,
    pub height: usize,
    pub world: WorldTransform,
    /// Lightly smoothed (`sigma = 0.75 m`) DEM for depression checks, slope, and knolls.
    pub raw_z: Vec<f32>,
    /// Contouring DEM (Gaussian `smooth_m` + bounded topography-preserving DoG boost).
    pub contour_z: Vec<f32>,
    /// 1 where contours may be drawn (inside data domain and not open water).
    pub drawable: Vec<u8>,
    /// 1 where non-drawable cell connects to the exterior map border (true clip boundary, not interior lakes/buildings).
    pub exterior: Vec<u8>,
    /// 1 where cell is marsh / wet ground (used to raise knoll threshold against marsh noise).
    pub wet: Vec<u8>,
    /// Local slope in degrees at 1 m resolution.
    pub slope_deg: Vec<f32>,
    /// 40 m window mean slope in degrees (O(1) integral table) for flat-terrain filtering.
    pub mean_slope_40m: Vec<f32>,
    /// Height relative to 16 m local mean (`raw_z - mean_16m`), positive on small ridges/noses/spurs.
    pub convex_16m: Vec<f32>,
    /// Height relative to 60 m local mean (`raw_z - mean_60m`), positive on ridges/hills.
    pub convex_60m: Vec<f32>,
}

impl PreparedDem {
    #[inline]
    pub fn sample_raw(&self, x: f64, y: f64) -> Option<f32> {
        sample_bilinear(&self.raw_z, self.width, self.height, &self.world, x, y)
    }

    #[inline]
    pub fn sample_slope(&self, x: f64, y: f64) -> Option<f32> {
        sample_bilinear(&self.slope_deg, self.width, self.height, &self.world, x, y)
    }

    #[inline]
    pub fn sample_mean_slope(&self, x: f64, y: f64) -> Option<f32> {
        sample_bilinear(&self.mean_slope_40m, self.width, self.height, &self.world, x, y)
    }

    #[inline]
    pub fn sample_convex_16m(&self, x: f64, y: f64) -> Option<f32> {
        sample_bilinear(&self.convex_16m, self.width, self.height, &self.world, x, y)
    }

    #[inline]
    pub fn sample_convex(&self, x: f64, y: f64) -> Option<f32> {
        sample_bilinear(&self.convex_60m, self.width, self.height, &self.world, x, y)
    }

    #[inline]
    pub fn is_wet(&self, x: f64, y: f64) -> bool {
        let c = self.world.x_to_col_f(x).round() as isize;
        let r = self.world.y_to_row_f(y).round() as isize;
        if c < 0 || r < 0 || (c as usize) >= self.width || (r as usize) >= self.height {
            return false;
        }
        self.wet[r as usize * self.width + c as usize] != 0
    }

    /// True if `(x, y)` lies on or immediately adjacent to the outer clip/raster boundary
    /// (distinguishes true map edges from interior water/building holes).
    #[inline]
    pub fn touches_clip_boundary(&self, x: f64, y: f64) -> bool {
        let fc = self.world.x_to_col_f(x);
        let fr = self.world.y_to_row_f(y);
        if fc <= 2.5 || fr <= 2.5 || fc >= (self.width as f64) - 3.5 || fr >= (self.height as f64) - 3.5 {
            return true;
        }
        let c = fc.round() as isize;
        let r = fr.round() as isize;
        for dr in -2isize..=2 {
            let nr = r + dr;
            if nr < 0 || (nr as usize) >= self.height {
                return true;
            }
            let base = nr as usize * self.width;
            for dc in -2isize..=2 {
                let nc = c + dc;
                if nc < 0 || (nc as usize) >= self.width {
                    return true;
                }
                if self.exterior[base + nc as usize] != 0 {
                    return true;
                }
            }
        }
        false
    }
}

#[inline]
pub fn sample_bilinear(
    grid: &[f32],
    width: usize,
    height: usize,
    world: &WorldTransform,
    x: f64,
    y: f64,
) -> Option<f32> {
    let fc = world.x_to_col_f(x);
    let fr = world.y_to_row_f(y);
    if fc < 0.0 || fr < 0.0 {
        return None;
    }
    let c0 = fc.floor() as usize;
    let r0 = fr.floor() as usize;
    if c0 + 1 >= width || r0 + 1 >= height {
        let cn = fc.round() as isize;
        let rn = fr.round() as isize;
        if cn >= 0 && rn >= 0 && (cn as usize) < width && (rn as usize) < height {
            let v = grid[rn as usize * width + cn as usize];
            return v.is_finite().then_some(v);
        }
        return None;
    }
    let tx = (fc - c0 as f64) as f32;
    let ty = (fr - r0 as f64) as f32;
    let z00 = grid[r0 * width + c0];
    let z10 = grid[r0 * width + c0 + 1];
    let z01 = grid[(r0 + 1) * width + c0];
    let z11 = grid[(r0 + 1) * width + c0 + 1];
    if !(z00.is_finite() && z10.is_finite() && z01.is_finite() && z11.is_finite()) {
        return None;
    }
    let top = z00 + (z10 - z00) * tx;
    let bot = z01 + (z11 - z01) * tx;
    Some(top + (bot - top) * ty)
}

/// Multi-scale coarse-to-fine pyramid + harmonic (Laplace) gap filler.
///
/// Produces a C^2 smooth minimum-curvature membrane across buildings, dense canopies,
/// and water gaps without creating step artifacts or artificial contour rings.
pub fn fill_dem_gaps(dem: &DemGrid) -> Vec<f32> {
    let (w, h) = (dem.width, dem.height);
    if w == 0 || h == 0 {
        return Vec::new();
    }
    if dem.z.iter().all(|v| v.is_finite()) {
        return dem.z.clone();
    }

    // Build pyramid levels until grid is tiny or all cells are finite.
    let mut levels: Vec<(usize, usize, Vec<f32>, Vec<u8>)> = Vec::new();
    let known0: Vec<u8> = dem.z.iter().map(|v| u8::from(v.is_finite())).collect();
    levels.push((w, h, dem.z.clone(), known0));

    while let Some(&(pw, ph, _, _)) = levels.last() {
        let has_nan = levels.last().unwrap().3.iter().any(|&k| k == 0);
        if !has_nan || (pw <= 4 && ph <= 4) {
            break;
        }
        let nw = pw.div_ceil(2);
        let nh = ph.div_ceil(2);
        let prev_z = &levels.last().unwrap().2;
        let prev_k = &levels.last().unwrap().3;
        let mut nz = vec![f32::NAN; nw * nh];
        let mut nk = vec![0u8; nw * nh];
        for r in 0..nh {
            let r0 = r * 2;
            let r1 = (r0 + 1).min(ph - 1);
            for c in 0..nw {
                let c0 = c * 2;
                let c1 = (c0 + 1).min(pw - 1);
                let mut sum = 0.0f64;
                let mut cnt = 0u32;
                for rr in [r0, r1] {
                    for cc in [c0, c1] {
                        let idx = rr * pw + cc;
                        if prev_k[idx] != 0 {
                            sum += f64::from(prev_z[idx]);
                            cnt += 1;
                        }
                    }
                }
                if cnt > 0 {
                    nz[r * nw + c] = (sum / f64::from(cnt)) as f32;
                    nk[r * nw + c] = 1;
                }
            }
        }
        levels.push((nw, nh, nz, nk));
    }

    // Fill coarsest level completely by iterative neighbor diffusion (fallback to global mean).
    {
        let (cw, ch, cz, ck) = levels.last_mut().unwrap();
        let (cw, ch) = (*cw, *ch);
        let mut mean_sum = 0.0f64;
        let mut mean_cnt = 0u64;
        for (&v, &k) in cz.iter().zip(ck.iter()) {
            if k != 0 {
                mean_sum += f64::from(v);
                mean_cnt += 1;
            }
        }
        let fallback = if mean_cnt > 0 { (mean_sum / mean_cnt as f64) as f32 } else { 0.0 };
        let mut tmp = cz.clone();
        for _ in 0..(cw + ch + 8) {
            let mut rem = 0usize;
            for r in 0..ch {
                for c in 0..cw {
                    let i = r * cw + c;
                    if cz[i].is_finite() {
                        tmp[i] = cz[i];
                        continue;
                    }
                    let mut s = 0.0f64;
                    let mut n = 0u32;
                    for dr in -1isize..=1 {
                        for dc in -1isize..=1 {
                            if dr == 0 && dc == 0 {
                                continue;
                            }
                            let nr = r as isize + dr;
                            let nc = c as isize + dc;
                            if nr >= 0 && nc >= 0 && (nr as usize) < ch && (nc as usize) < cw {
                                let v = cz[nr as usize * cw + nc as usize];
                                if v.is_finite() {
                                    s += f64::from(v);
                                    n += 1;
                                }
                            }
                        }
                    }
                    if n > 0 {
                        tmp[i] = (s / f64::from(n)) as f32;
                    } else {
                        rem += 1;
                    }
                }
            }
            cz.copy_from_slice(&tmp);
            if rem == 0 {
                break;
            }
        }
        for v in cz.iter_mut() {
            if !v.is_finite() {
                *v = fallback;
            }
        }
    }

    // Coarse-to-fine bilinear upsampling + SOR harmonic (Laplace) relaxation on unknown cells.
    for lvl in (0..levels.len() - 1).rev() {
        let (cw, ch) = (levels[lvl + 1].0, levels[lvl + 1].1);
        let coarse = levels[lvl + 1].2.clone();
        let (fw, fh, fz, fk) = &mut levels[lvl];
        let (fw, fh) = (*fw, *fh);

        let mut missing = Vec::new();
        for r in 0..fh {
            let sr = ((r as f32 + 0.5) * 0.5 - 0.5).clamp(0.0, (ch - 1) as f32);
            let r0 = sr.floor() as usize;
            let r1 = (r0 + 1).min(ch - 1);
            let wy = sr - r0 as f32;
            for c in 0..fw {
                let i = r * fw + c;
                if fk[i] != 0 {
                    continue;
                }
                let sc = ((c as f32 + 0.5) * 0.5 - 0.5).clamp(0.0, (cw - 1) as f32);
                let c0 = sc.floor() as usize;
                let c1 = (c0 + 1).min(cw - 1);
                let wx = sc - c0 as f32;
                let top = coarse[r0 * cw + c0] * (1.0 - wx) + coarse[r0 * cw + c1] * wx;
                let bot = coarse[r1 * cw + c0] * (1.0 - wx) + coarse[r1 * cw + c1] * wx;
                fz[i] = top * (1.0 - wy) + bot * wy;
                missing.push(i);
            }
        }

        // Harmonic relaxation (omega = 1.35 SOR) pinned on known ground pixels.
        let iters = if lvl == 0 { 10 } else { 14 };
        let omega = 1.35f32;
        for _ in 0..iters {
            for &i in &missing {
                let r = i / fw;
                let c = i - r * fw;
                let mut s = 0.0f32;
                let mut n = 0.0f32;
                if c > 0 {
                    s += fz[i - 1];
                    n += 1.0;
                }
                if c + 1 < fw {
                    s += fz[i + 1];
                    n += 1.0;
                }
                if r > 0 {
                    s += fz[i - fw];
                    n += 1.0;
                }
                if r + 1 < fh {
                    s += fz[i + fw];
                    n += 1.0;
                }
                if n > 0.0 {
                    let avg = s / n;
                    fz[i] += omega * (avg - fz[i]);
                }
            }
        }
    }

    levels.into_iter().next().unwrap().2
}

/// Separable 1D Gaussian blur (parallelized across rows with `rayon`).
pub fn gaussian_blur_f32(src: &[f32], w: usize, h: usize, sigma: f32) -> Vec<f32> {
    if sigma < 0.25 || w == 0 || h == 0 {
        return src.to_vec();
    }
    let radius = (sigma * 3.0).ceil() as usize;
    let mut kernel = Vec::with_capacity(2 * radius + 1);
    let inv_2s2 = 1.0 / (2.0 * sigma * sigma);
    let mut sum = 0.0f32;
    for k in -(radius as isize)..=(radius as isize) {
        let w_k = (-(k * k) as f32 * inv_2s2).exp();
        kernel.push(w_k);
        sum += w_k;
    }
    for v in &mut kernel {
        *v /= sum;
    }

    // Horizontal pass.
    let mut horiz = vec![0.0f32; w * h];
    horiz
        .par_chunks_mut(w)
        .enumerate()
        .for_each(|(r, dst_row)| {
            let src_row = &src[r * w..(r + 1) * w];
            for c in 0..w {
                let mut acc = 0.0f32;
                for (ki, &kw) in kernel.iter().enumerate() {
                    let sc = (c as isize + ki as isize - radius as isize).clamp(0, w as isize - 1) as usize;
                    acc += src_row[sc] * kw;
                }
                dst_row[c] = acc;
            }
        });

    // Vertical pass (row-parallel for cache-friendly contiguous loads).
    let mut out = vec![0.0f32; w * h];
    out.par_chunks_mut(w)
        .enumerate()
        .for_each(|(r, dst_row)| {
            for (ki, &kw) in kernel.iter().enumerate() {
                let sr = (r as isize + ki as isize - radius as isize).clamp(0, h as isize - 1) as usize;
                let src_row = &horiz[sr * w..(sr + 1) * w];
                for c in 0..w {
                    dst_row[c] += src_row[c] * kw;
                }
            }
        });
    out
}

/// Fast O(1) 2D box-mean using a 64-bit integral image (`(2*radius + 1)^2` window).
pub fn box_mean_f32(src: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    let stride = w + 1;
    let mut integral = vec![0.0f64; (h + 1) * stride];
    for r in 0..h {
        let mut row_sum = 0.0f64;
        let src_off = r * w;
        let dst_off = (r + 1) * stride;
        let prev_off = r * stride;
        for c in 0..w {
            let v = src[src_off + c];
            if v.is_finite() {
                row_sum += f64::from(v);
            }
            integral[dst_off + c + 1] = integral[prev_off + c + 1] + row_sum;
        }
    }
    let mut out = vec![0.0f32; w * h];
    out.par_chunks_mut(w).enumerate().for_each(|(r, dst_row)| {
        let r0 = r.saturating_sub(radius);
        let r1 = (r + radius + 1).min(h);
        let row0 = r0 * stride;
        let row1 = r1 * stride;
        let rh = (r1 - r0) as f64;
        for c in 0..w {
            let c0 = c.saturating_sub(radius);
            let c1 = (c + radius + 1).min(w);
            let area = rh * (c1 - c0) as f64;
            let s = integral[row1 + c1] - integral[row0 + c1] - integral[row1 + c0] + integral[row0 + c0];
            dst_row[c] = (s / area) as f32;
        }
    });
    out
}

/// Computes local terrain slope in degrees over a `±step` cell central difference.
pub fn compute_slope_deg(z: &[f32], w: usize, h: usize, cell: f64) -> Vec<f32> {
    let step = (2.0 / cell).round().max(1.0) as usize;
    let inv_span = 1.0 / (2.0 * step as f64 * cell);
    let mut out = vec![0.0f32; w * h];
    out.par_chunks_mut(w).enumerate().for_each(|(r, dst_row)| {
        let r_lo = r.saturating_sub(step);
        let r_hi = (r + step).min(h - 1);
        let dy_span = ((r_hi - r_lo).max(1) as f64 * cell).max(1e-6);
        for c in 0..w {
            let c_lo = c.saturating_sub(step);
            let c_hi = (c + step).min(w - 1);
            let dx_span = ((c_hi - c_lo).max(1) as f64 * cell).max(1e-6);
            let dx = f64::from(z[r * w + c_hi] - z[r * w + c_lo]) / dx_span;
            let dy = f64::from(z[r_lo * w + c] - z[r_hi * w + c]) / dy_span;
            let _ = inv_span;
            dst_row[c] = dx.hypot(dy).atan().to_degrees() as f32;
        }
    });
    out
}

/// Samples an existing 1 m slope grid onto the 2 m vegetation grid (zero recomputation).
pub fn sample_slope_to_2m(
    slope1: &[f32],
    w1: usize,
    h1: usize,
    world1: &WorldTransform,
    w2: usize,
    h2: usize,
    world2: &WorldTransform,
) -> Vec<f32> {
    let mut out = vec![0.0f32; w2 * h2];
    for r in 0..h2 {
        let y = world2.row_to_y(r as f64);
        for c in 0..w2 {
            let x = world2.col_to_x(c as f64);
            out[r * w2 + c] = sample_bilinear(slope1, w1, h1, world1, x, y).unwrap_or(0.0);
        }
    }
    out
}

/// Builds a clean drawable mask: fills interior building holes up to `max_hole_m`,
/// excludes open water and exterior empty margin outside the data domain.
fn build_drawable_mask(valid: &[u8], water: &[u8], w: usize, h: usize, max_hole_cells: usize) -> Vec<u8> {
    // 1. Expand valid mask by `max_hole_cells` via fast separable 1D distance transform (Chebyshev).
    let mut dist = vec![u16::MAX; w * h];
    for i in 0..(w * h) {
        if valid[i] != 0 {
            dist[i] = 0;
        }
    }
    // Forward pass.
    for r in 0..h {
        for c in 0..w {
            let i = r * w + c;
            let mut d = dist[i];
            if d == 0 {
                continue;
            }
            if c > 0 {
                d = d.min(dist[i - 1].saturating_add(1));
            }
            if r > 0 {
                d = d.min(dist[i - w].saturating_add(1));
            }
            dist[i] = d;
        }
    }
    // Backward pass.
    for r in (0..h).rev() {
        for c in (0..w).rev() {
            let i = r * w + c;
            let mut d = dist[i];
            if d == 0 {
                continue;
            }
            if c + 1 < w {
                d = d.min(dist[i + 1].saturating_add(1));
            }
            if r + 1 < h {
                d = d.min(dist[i + w].saturating_add(1));
            }
            dist[i] = d;
        }
    }
    let limit = max_hole_cells as u16;
    let mut out = vec![0u8; w * h];
    for i in 0..(w * h) {
        if water[i] == 0 && dist[i] <= limit {
            out[i] = 1;
        }
    }
    out
}

/// Computes fast 2 m slope directly from a filled 1 m DEM without running full contour smoothing.
/// Used by `otidgeo veg` for the steep-slope (`> 35 deg`) barrier in ~1–2 ms.
pub fn compute_slope_2m_fast(
    z1: &[f32],
    w1: usize,
    h1: usize,
    world1: &WorldTransform,
    w2: usize,
    h2: usize,
    world2: &WorldTransform,
) -> Vec<f32> {
    let mut out = vec![0.0f32; w2 * h2];
    let step = 2.0;
    let inv_span = 1.0 / (2.0 * step);
    out.par_chunks_mut(w2).enumerate().for_each(|(r, row)| {
        let y = world2.row_to_y(r as f64);
        for c in 0..w2 {
            let x = world2.col_to_x(c as f64);
            let ze = sample_bilinear(z1, w1, h1, world1, x + step, y);
            let zw = sample_bilinear(z1, w1, h1, world1, x - step, y);
            let zn = sample_bilinear(z1, w1, h1, world1, x, y + step);
            let zs = sample_bilinear(z1, w1, h1, world1, x, y - step);
            if let (Some(ze), Some(zw), Some(zn), Some(zs)) = (ze, zw, zn, zs) {
                let dx = f64::from(ze - zw) * inv_span;
                let dy = f64::from(zn - zs) * inv_span;
                row[c] = dx.hypot(dy).atan().to_degrees() as f32;
            }
        }
    });
    out
}

/// Flood-fills exterior nodata (`valid == 0 && water == 0`) from the 4 raster borders
/// so clip boundaries can be distinguished from interior building/lake holes.
fn build_exterior_mask(valid: &[u8], water: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut ext = vec![0u8; w * h];
    if w == 0 || h == 0 {
        return ext;
    }
    let mut stack = Vec::new();
    let push = |idx: usize, ext: &mut [u8], stack: &mut Vec<usize>| {
        if ext[idx] == 0 && valid[idx] == 0 && water[idx] == 0 {
            ext[idx] = 1;
            stack.push(idx);
        }
    };
    for c in 0..w {
        push(c, &mut ext, &mut stack);
        push((h - 1) * w + c, &mut ext, &mut stack);
    }
    for r in 0..h {
        push(r * w, &mut ext, &mut stack);
        push(r * w + w - 1, &mut ext, &mut stack);
    }
    while let Some(i) = stack.pop() {
        let r = i / w;
        let c = i - r * w;
        if c > 0 { push(i - 1, &mut ext, &mut stack); }
        if c + 1 < w { push(i + 1, &mut ext, &mut stack); }
        if r > 0 { push(i - w, &mut ext, &mut stack); }
        if r + 1 < h { push(i + w, &mut ext, &mut stack); }
    }
    ext
}

/// Augments `dem.wet` with flat low-lying shoreline zones adjacent to open water (when present).
fn build_wet_mask(
    dem_wet: &[u8],
    water: &[u8],
    raw_z: &[f32],
    mean_slope_40m: &[f32],
    w: usize,
    h: usize,
    cell: f64,
) -> Vec<u8> {
    let n = w * h;
    let mut wet = if dem_wet.len() == n { dem_wet.to_vec() } else { vec![0u8; n] };
    if !water.iter().any(|&v| v != 0) {
        return wet;
    }
    let max_steps = (14.0 / cell).round().max(3.0) as u16;
    let mut dist = vec![u16::MAX; n];
    let mut wz = vec![f32::NAN; n];
    let mut queue = Vec::new();
    for i in 0..n {
        if water[i] != 0 && raw_z[i].is_finite() {
            dist[i] = 0;
            wz[i] = raw_z[i];
            wet[i] = 1;
            queue.push(i);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        if dist[i] >= max_steps { continue; }
        let base_z = wz[i];
        let r = i / w;
        let c = i - r * w;
        for nb in [
            (c > 0).then(|| i - 1),
            (c + 1 < w).then(|| i + 1),
            (r > 0).then(|| i - w),
            (r + 1 < h).then(|| i + w),
        ]
        .into_iter()
        .flatten()
        {
            if dist[nb] == u16::MAX
                && mean_slope_40m[nb] < 2.5
                && raw_z[nb].is_finite()
                && (raw_z[nb] - base_z) <= 0.55
            {
                dist[nb] = dist[i] + 1;
                wz[nb] = base_z;
                wet[nb] = 1;
                queue.push(nb);
            }
        }
    }
    wet
}

/// Prepares all smooth, raw, slope, convexity, exterior, and wetness surfaces from a 1 m `DemGrid`.
pub fn prepare_dem(dem: &DemGrid, config: &EngineConfig) -> PreparedDem {
    let filled = fill_dem_gaps(dem);
    let (w, h, cell) = (dem.width, dem.height, dem.world.cell);
    let raw_sigma = (0.75 / cell) as f32;
    let raw_z = gaussian_blur_f32(&filled, w, h, raw_sigma);

    let smooth_sigma = (config.smooth_m / cell).max(0.0) as f32;
    let base_z = gaussian_blur_f32(&filled, w, h, smooth_sigma);

    let contour_z = if config.curviness > 1e-4 && smooth_sigma >= 0.4 {
        // Asymmetric ridge-preserving DoG boost: sharpens noses/ridges/small hills without deepening
        // micro-concavities into artificial depression loops.
        let fine_sigma = (smooth_sigma * 0.66).max(0.5);
        let fine_z = gaussian_blur_f32(&filled, w, h, fine_sigma);
        drop(filled);
        let curv = config.curviness.clamp(0.0, 0.8) as f32;
        let max_boost = (0.20 * config.interval) as f32;
        let out: Vec<f32> = base_z
            .par_iter()
            .zip(fine_z.par_iter())
            .map(|(&b, &f)| {
                let detail = f - b;
                let weight = if detail >= 0.0 { 1.0 } else { 0.55 };
                b + curv * weight * max_boost * (detail / max_boost).tanh()
            })
            .collect();
        drop(base_z);
        drop(fine_z);
        out
    } else {
        drop(filled);
        base_z
    };

    let slope_deg = compute_slope_deg(&raw_z, w, h, cell);
    let r_flat = (20.0 / cell).round().max(1.0) as usize;
    let mean_slope_40m = box_mean_f32(&slope_deg, w, h, r_flat);

    let r_conv16 = (8.0 / cell).round().max(1.0) as usize;
    let mean_z_16m = box_mean_f32(&raw_z, w, h, r_conv16);
    let convex_16m: Vec<f32> = raw_z
        .par_iter()
        .zip(mean_z_16m.par_iter())
        .map(|(&z, &m)| z - m)
        .collect();

    let r_conv = (30.0 / cell).round().max(2.0) as usize;
    let mean_z_60m = box_mean_f32(&raw_z, w, h, r_conv);
    let convex_60m: Vec<f32> = raw_z
        .par_iter()
        .zip(mean_z_60m.par_iter())
        .map(|(&z, &m)| z - m)
        .collect();

    let max_hole_cells = (22.0 / cell).round().max(4.0) as usize;
    let drawable = build_drawable_mask(&dem.valid, &dem.water, w, h, max_hole_cells);
    let exterior = build_exterior_mask(&dem.valid, &dem.water, w, h);
    let wet = build_wet_mask(&dem.wet, &dem.water, &raw_z, &mean_slope_40m, w, h, cell);

    PreparedDem {
        width: w,
        height: h,
        world: dem.world,
        raw_z,
        contour_z,
        drawable,
        exterior,
        wet,
        slope_deg,
        mean_slope_40m,
        convex_16m,
        convex_60m,
    }
}
