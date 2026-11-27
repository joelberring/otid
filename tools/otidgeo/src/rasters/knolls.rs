//! Clean-room MIT knoll candidate detection (`scripts/geo-rock.ts` `localMaxMask`,
//! `knollCandidates`, `chooseKnolls`, and `kullar.geojson` writer) with calibrated G4A limits
//! (`KNOLL_LOOSE`, `KNOLL_MIN_FOOT_M2 = 8`, `KNOLL_OBVIOUS_RISE = 1.5`).

use crate::rasters::grid_io::{js_round, GroundGrid};
use crate::rasters::rock::NearIndex;
use rayon::prelude::*;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

pub const KNOLL_LOWER_SHARE: f64 = 0.85;
pub const KNOLL_MIN_RISE: f64 = 0.9;
pub const KNOLL_MAX_FOOT_M2: f64 = 70.0;
pub const KNOLL_MIN_FOOT_M2: f64 = 8.0;
pub const KNOLL_SPACING: f64 = 12.0;
pub const KNOLL_OBVIOUS_RISE: f64 = 1.5;
pub const KNOLL_LOOSE_MIN_RISE: f64 = 0.5;
pub const KNOLL_LOOSE_LOWER_SHARE: f64 = 0.5;
pub const KNOLL_LOOSE_MAX_FOOT_M2: f64 = 160.0;

const CLIFF_LIP_SLOPE_DEG: f64 = 38.0;
const CLIFF_LIP_MAX_DROP_M: f64 = 3.5;
const CLIFF_LIP_SAFE_RISE_M: f64 = 1.8;
const HILLSIDE_BROAD_SLOPE_DEG: f64 = 16.0;
const HILLSIDE_SAFE_RISE_M: f64 = 1.6;

#[derive(Clone, Copy, Debug)]
pub struct KnollCandidate {
    pub at: [f64; 2],
    pub rise: f64,
    pub share: f64,
    pub foot_m2: f64,
    pub wet: bool,
    /// 2D inertia-tensor footprint elongation aspect ratio (`sqrt(l1 / l2) >= 1.0`).
    pub aspect: f64,
    /// Major-axis orientation in degrees CCW from East (`+X`), in `[0, 180)`.
    pub angle_deg: f64,
}

#[inline]
fn median_f64(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.total_cmp(b));
    values[values.len() / 2]
}

/// Separable 1D monotonic-queue maximum over +/-`radius` in `(z, x + y)` order (`localMaxMask`).
fn local_max_mask(z: &[f32], width: usize, height: usize, radius: usize, outer: usize) -> Vec<u8> {
    let size = width * height;
    let mut is_top = vec![0u8; size];
    if width <= 2 * outer || height <= 2 * outer {
        return is_top;
    }
    let mut row_max_val = vec![f32::NEG_INFINITY; size];
    let mut row_max_sum = vec![0i32; size];
    let x_min = outer - radius;
    let x_max = width - outer + radius;

    // Pass 1: along y within each column (parallel across columns).
    row_max_val[x_min * height..x_max * height]
        .par_chunks_mut(height)
        .zip(row_max_sum[x_min * height..x_max * height].par_chunks_mut(height))
        .enumerate()
        .for_each(|(ox, (val_col, sum_col))| {
            let x = x_min + ox;
            let base = x * height;
            let mut dq_pos = vec![0usize; height];
            let mut dq_val = vec![0.0f32; height];
            let mut head = 0usize;
            let mut tail = 0usize;
            for y in (outer - radius)..(outer + radius) {
                let raw = z[base + y];
                let v = if raw.is_finite() { raw } else { f32::NEG_INFINITY };
                while tail > head && dq_val[tail - 1] <= v { tail -= 1; }
                dq_pos[tail] = y;
                dq_val[tail] = v;
                tail += 1;
            }
            for y in outer..(height - outer) {
                let ny = y + radius;
                let raw = z[base + ny];
                let v = if raw.is_finite() { raw } else { f32::NEG_INFINITY };
                while tail > head && dq_val[tail - 1] <= v { tail -= 1; }
                dq_pos[tail] = ny;
                dq_val[tail] = v;
                tail += 1;
                while dq_pos[head] < y - radius { head += 1; }
                val_col[y] = dq_val[head];
                sum_col[y] = (x + dq_pos[head]) as i32;
            }
        });

    // Pass 2: along x within each row (parallel across rows).
    let y_count = height - 2 * outer;
    let tops_per_y: Vec<Vec<usize>> = (0..y_count)
        .into_par_iter()
        .map(|oy| {
            let y = outer + oy;
            let mut hits = Vec::new();
            let mut dq_pos = vec![0usize; width];
            let mut dq_val = vec![0.0f32; width];
            let mut dq_sum = vec![0i32; width];
            let mut head = 0usize;
            let mut tail = 0usize;
            for x in (outer - radius)..(outer + radius) {
                let idx = x * height + y;
                let (v, s) = (row_max_val[idx], row_max_sum[idx]);
                while tail > head && (dq_val[tail - 1] < v || (dq_val[tail - 1] == v && dq_sum[tail - 1] <= s)) {
                    tail -= 1;
                }
                dq_pos[tail] = x;
                dq_val[tail] = v;
                dq_sum[tail] = s;
                tail += 1;
            }
            for x in outer..(width - outer) {
                let nx = x + radius;
                let nidx = nx * height + y;
                let (v, s) = (row_max_val[nidx], row_max_sum[nidx]);
                while tail > head && (dq_val[tail - 1] < v || (dq_val[tail - 1] == v && dq_sum[tail - 1] <= s)) {
                    tail -= 1;
                }
                dq_pos[tail] = nx;
                dq_val[tail] = v;
                dq_sum[tail] = s;
                tail += 1;
                while dq_pos[head] < x - radius { head += 1; }
                let idx = x * height + y;
                let here = z[idx];
                if here.is_finite() && here == dq_val[head] && (x + y) as i32 == dq_sum[head] {
                    hits.push(idx);
                }
            }
            hits
        })
        .collect();

    for hits in tops_per_y {
        for idx in hits {
            is_top[idx] = 1;
        }
    }
    is_top
}

/// 1-2-1 smoothed ground surface for stable cliff-lip slope checks and footprint inertia tensor.
fn smooth_ground_121(ground: &GroundGrid) -> Vec<f32> {
    let (w, h) = (ground.width, ground.height);
    let mut smooth = vec![f32::NAN; w * h];
    if w < 3 || h < 3 {
        return smooth;
    }
    smooth.par_chunks_mut(h).enumerate().for_each(|(x, dst_col)| {
        if x == 0 || x + 1 >= w {
            return;
        }
        for y in 1..(h - 1) {
            if !ground.z[x * h + y].is_finite() {
                continue;
            }
            let mut sum = 0.0f64;
            let mut weight = 0.0f64;
            for ax in -1..=1isize {
                let wx = if ax != 0 { 1.0 } else { 2.0 };
                let col_base = (x as isize + ax) as usize * h;
                for ay in -1..=1isize {
                    let v = ground.z[col_base + (y as isize + ay) as usize];
                    if !v.is_finite() {
                        continue;
                    }
                    let wt = wx * if ay != 0 { 1.0 } else { 2.0 };
                    sum += f64::from(v) * wt;
                    weight += wt;
                }
            }
            if weight > 0.0 {
                dst_col[y] = (sum / weight) as f32;
            }
        }
    });
    smooth
}

/// Bounded 4-connected BFS around summit `(x0, y0)` above `half_h` on smoothed ground (`+x` East, `+y` North),
/// returning 2D inertia-tensor `(aspect, angle_deg)` with `angle_deg` CCW from `+X` in `[0, 180)`.
fn foot_inertia(
    ground: &GroundGrid,
    smooth_z: &[f32],
    x0: usize,
    y0: usize,
    half_h: f64,
    max_rad: isize,
) -> (f64, f64) {
    let (w, h, cell) = (ground.width, ground.height, ground.cell);
    let span = (2 * max_rad + 1) as usize;
    let mut visited = vec![0u8; span * span];
    let mut queue = Vec::<(isize, isize)>::with_capacity(96);
    let mut cells = Vec::<(f64, f64)>::with_capacity(96);
    let (x0i, y0i) = (x0 as isize, y0 as isize);
    let max_r2 = max_rad * max_rad;

    visited[(max_rad as usize) * span + (max_rad as usize)] = 1;
    queue.push((0, 0));
    let mut head = 0usize;
    let mut sum_x = 0.0f64;
    let mut sum_y = 0.0f64;

    while head < queue.len() {
        let (dx, dy) = queue[head];
        head += 1;
        let wx = dx as f64 * cell;
        let wy = dy as f64 * cell;
        cells.push((wx, wy));
        sum_x += wx;
        sum_y += wy;

        for (ndx, ndy) in [(dx - 1, dy), (dx + 1, dy), (dx, dy - 1), (dx, dy + 1)] {
            if ndx.abs() > max_rad || ndy.abs() > max_rad || ndx * ndx + ndy * ndy > max_r2 {
                continue;
            }
            let nx = x0i + ndx;
            let ny = y0i + ndy;
            if nx < 0 || ny < 0 || (nx as usize) >= w || (ny as usize) >= h {
                continue;
            }
            let li = ((ndx + max_rad) as usize) * span + ((ndy + max_rad) as usize);
            if visited[li] != 0 {
                continue;
            }
            let idx = nx as usize * h + ny as usize;
            let sv = smooth_z[idx];
            let zv = if sv.is_finite() { f64::from(sv) } else { f64::from(ground.z[idx]) };
            if zv.is_finite() && zv > half_h {
                visited[li] = 1;
                queue.push((ndx, ndy));
            }
        }
    }

    let n = cells.len();
    if n < 5 {
        return (1.0, 0.0);
    }
    let nf = n as f64;
    let mx = sum_x / nf;
    let my = sum_y / nf;
    let (mut cxx, mut cyy, mut cxy) = (0.0f64, 0.0f64, 0.0f64);
    for &(wx, wy) in &cells {
        let ux = wx - mx;
        let uy = wy - my;
        cxx += ux * ux;
        cyy += uy * uy;
        cxy += ux * uy;
    }
    cxx /= nf;
    cyy /= nf;
    cxy /= nf;
    let tr = cxx + cyy;
    let disc = (cxx - cyy).hypot(2.0 * cxy);
    let l1 = (0.5 * (tr + disc)).max(1e-6);
    let l2 = (0.5 * (tr - disc)).max(1e-6);
    let aspect = (l1 / l2).sqrt();
    let angle_deg = (0.5 * (2.0 * cxy).atan2(cxx - cyy)).to_degrees().rem_euclid(180.0);
    (aspect, angle_deg)
}

/// Finds all loose knoll candidates (`KNOLL_LOOSE` + `KNOLL_MIN_FOOT_M2 = 8`) with `wet`, `aspect`, `angle_deg`,
/// and cliff-lip / steep-hillside false-positive guards.
pub fn knoll_candidates(
    ground: &GroundGrid,
    water_mask: Option<&[u8]>,
    wet_mask: Option<&[u8]>,
) -> Vec<KnollCandidate> {
    let (w, h, cell) = (ground.width, ground.height, ground.cell);
    let top = js_round(3.0 / cell).max(1.0) as usize;
    let inner = js_round(6.0 / cell).max((top + 1) as f64) as isize;
    let outer = js_round(8.0 / cell).max((inner + 1) as f64) as usize;
    if w <= 2 * outer || h <= 2 * outer {
        return Vec::new();
    }
    let max_foot = KNOLL_LOOSE_MAX_FOOT_M2 / (cell * cell);
    let (is_top, smooth_z) = rayon::join(
        || local_max_mask(&ground.z, w, h, top, outer),
        || smooth_ground_121(ground),
    );
    let outer_i = outer as isize;
    let cliff_rad = js_round(4.0 / cell).max(2.0) as isize;
    let cliff_rad2 = cliff_rad * cliff_rad;
    let cliff_slope_tan = (CLIFF_LIP_SLOPE_DEG * std::f64::consts::PI / 180.0).tan();
    let hillside_tan = (HILLSIDE_BROAD_SLOPE_DEG * std::f64::consts::PI / 180.0).tan();
    let shape_rad = js_round(7.0 / cell).max(5.0) as isize;

    let per_col: Vec<Vec<KnollCandidate>> = (outer..(w - outer))
        .into_par_iter()
        .map(|x| {
            let mut out = Vec::new();
            let mut ring = Vec::<f64>::with_capacity(144);
            let xi = x as isize;
            let base_col = x * h;
            for y in outer..(h - outer) {
                let idx = base_col + y;
                if is_top[idx] == 0 { continue; }
                let yi = y as isize;
                let here = f64::from(ground.z[idx]);
                ring.clear();
                let mut ring_min = f64::INFINITY;
                for dx in -outer_i..=outer_i {
                    let cbase = (xi + dx) as usize * h;
                    for dy in -outer_i..=outer_i {
                        if dx.abs().max(dy.abs()) >= inner {
                            let v = ground.z[cbase + (yi + dy) as usize];
                            if v.is_finite() {
                                let vf = f64::from(v);
                                if vf < ring_min { ring_min = vf; }
                                ring.push(vf);
                            }
                        }
                    }
                }
                if ring.len() < 24 { continue; }
                let base = median_f64(&mut ring);
                let rise = here - base;
                if rise < KNOLL_LOOSE_MIN_RISE { continue; }
                let limit = here - rise / 3.0;
                let lower = ring.iter().filter(|&&v| v <= limit).count();
                if (lower as f64) < KNOLL_LOOSE_LOWER_SHARE * ring.len() as f64 { continue; }
                let half_h = base + rise * 0.5;
                let mut foot = 0usize;
                for dx in -inner..=inner {
                    let cbase = (xi + dx) as usize * h;
                    for dy in -inner..=inner {
                        if f64::from(ground.z[cbase + (yi + dy) as usize]) > half_h { foot += 1; }
                    }
                }
                let foot_m2 = foot as f64 * cell * cell;
                if foot_m2 < KNOLL_MIN_FOOT_M2 || (foot as f64) > max_foot { continue; }
                if water_mask.is_some_and(|wm| wm[idx] != 0) { continue; }

                // Guard 1: Suppress cliff-lip bumps perched directly above a steep cliff (>38 deg, >=3.5 m drop).
                let max_drop = if ring_min.is_finite() { here - ring_min } else { 0.0 };
                if rise < CLIFF_LIP_SAFE_RISE_M && max_drop >= CLIFF_LIP_MAX_DROP_M {
                    let mut near_cliff = false;
                    'cliff: for dx in -cliff_rad..=cliff_rad {
                        let nx = xi + dx;
                        if nx < 1 || (nx as usize) + 1 >= w { continue; }
                        let ncol = nx as usize * h;
                        for dy in -cliff_rad..=cliff_rad {
                            if dx * dx + dy * dy > cliff_rad2 { continue; }
                            let ny = yi + dy;
                            if ny < 1 || (ny as usize) + 1 >= h { continue; }
                            let ni = ncol + ny as usize;
                            let sx = (f64::from(smooth_z[ni + h]) - f64::from(smooth_z[ni - h])) / (2.0 * cell);
                            let sy = (f64::from(smooth_z[ni + 1]) - f64::from(smooth_z[ni - 1])) / (2.0 * cell);
                            if sx.is_finite() && sy.is_finite() && sx.hypot(sy) >= cliff_slope_tan {
                                near_cliff = true;
                                break 'cliff;
                            }
                        }
                    }
                    if near_cliff { continue; }
                }

                // Guard 2: Suppress weak shoulder bumps on steep broad hillsides (>16 deg across ±8 m).
                if rise < HILLSIDE_SAFE_RISE_M {
                    let zx_hi = f64::from(ground.z[(xi + outer_i) as usize * h + y]);
                    let zx_lo = f64::from(ground.z[(xi - outer_i) as usize * h + y]);
                    let zy_hi = f64::from(ground.z[base_col + (yi + outer_i) as usize]);
                    let zy_lo = f64::from(ground.z[base_col + (yi - outer_i) as usize]);
                    let span = 2.0 * outer_i as f64 * cell;
                    let bsx = (zx_hi - zx_lo) / span;
                    let bsy = (zy_hi - zy_lo) / span;
                    if bsx.is_finite() && bsy.is_finite() && bsx.hypot(bsy) >= hillside_tan {
                        continue;
                    }
                }

                let (aspect, angle_deg) = foot_inertia(ground, &smooth_z, x, y, half_h, shape_rad);
                out.push(KnollCandidate {
                    at: ground.cell_center(x, y),
                    rise,
                    share: lower as f64 / ring.len() as f64,
                    foot_m2,
                    wet: wet_mask.is_some_and(|wm| wm[idx] != 0),
                    aspect,
                    angle_deg,
                });
            }
            out
        })
        .collect();

    let mut found: Vec<KnollCandidate> = per_col.into_iter().flatten().collect();
    found.sort_by(|a, b| b.rise.total_cmp(&a.rise));
    found
}

/// Chooses final knolls from candidates using G4A limits & marsh guard (`chooseKnolls`).
pub fn choose_knolls(candidates: &[KnollCandidate], lower_share: f64) -> Vec<[f64; 2]> {
    let mut found: Vec<&KnollCandidate> = candidates
        .iter()
        .filter(|k| {
            k.rise >= KNOLL_MIN_RISE
                && k.share >= lower_share
                && k.foot_m2 >= KNOLL_MIN_FOOT_M2
                && k.foot_m2 <= KNOLL_MAX_FOOT_M2
                && (!k.wet || k.rise >= KNOLL_OBVIOUS_RISE)
        })
        .collect();
    found.sort_by(|a, b| b.rise.total_cmp(&a.rise));
    let mut kept = Vec::new();
    let mut near = NearIndex::new(KNOLL_SPACING);
    for k in found {
        if !near.has(k.at[0], k.at[1]) {
            near.add(k.at[0], k.at[1]);
            kept.push(k.at);
        }
    }
    kept
}

/// Writes `kullar.geojson` FeatureCollection (`scripts/geo-worker.ts` lines 481–483).
pub fn write_knolls_geojson(path: &Path, candidates: &[KnollCandidate]) -> Result<(), String> {
    let file = File::create(path).map_err(|e| format!("Failed creating {}: {e}", path.display()))?;
    let mut w = BufWriter::with_capacity(64 * 1024, file);
    write!(
        w,
        "{{\"type\":\"FeatureCollection\",\"crs\":{{\"type\":\"name\",\"properties\":{{\"name\":\"EPSG:3006\"}}}},\"features\":["
    )
    .map_err(|e| e.to_string())?;
    for (i, k) in candidates.iter().enumerate() {
        if i > 0 { write!(w, ",").map_err(|e| e.to_string())?; }
        let rx = js_round(k.at[0] * 10.0) / 10.0;
        let ry = js_round(k.at[1] * 10.0) / 10.0;
        let rise = js_round(k.rise * 100.0) / 100.0;
        let share = js_round(k.share * 1000.0) / 1000.0;
        let foot = js_round(k.foot_m2) as i64;
        let aspect = if k.aspect.is_finite() { js_round(k.aspect.max(1.0) * 100.0) / 100.0 } else { 1.0 };
        let angle = if k.angle_deg.is_finite() {
            let a = js_round(k.angle_deg.rem_euclid(180.0) * 10.0) / 10.0;
            if a >= 180.0 || a == 0.0 { 0.0 } else { a }
        } else {
            0.0
        };
        if k.wet {
            write!(
                w,
                "{{\"type\":\"Feature\",\"geometry\":{{\"type\":\"Point\",\"coordinates\":[{rx},{ry}]}},\"properties\":{{\"rise\":{rise},\"share\":{share},\"foot\":{foot},\"wet\":1,\"aspect\":{aspect},\"angle\":{angle}}}}}"
            )
            .map_err(|e| e.to_string())?;
        } else {
            write!(
                w,
                "{{\"type\":\"Feature\",\"geometry\":{{\"type\":\"Point\",\"coordinates\":[{rx},{ry}]}},\"properties\":{{\"rise\":{rise},\"share\":{share},\"foot\":{foot},\"aspect\":{aspect},\"angle\":{angle}}}}}"
            )
            .map_err(|e| e.to_string())?;
        }
    }
    write!(w, "]}}").map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}
