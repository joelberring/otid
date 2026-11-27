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

#[derive(Clone, Copy, Debug)]
pub struct KnollCandidate {
    pub at: [f64; 2],
    pub rise: f64,
    pub share: f64,
    pub foot_m2: f64,
    pub wet: bool,
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

/// Finds all loose knoll candidates (`KNOLL_LOOSE` + `KNOLL_MIN_FOOT_M2 = 8`) with `wet` flag.
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
    let is_top = local_max_mask(&ground.z, w, h, top, outer);
    let outer_i = outer as isize;

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
                for dx in -outer_i..=outer_i {
                    let cbase = (xi + dx) as usize * h;
                    for dy in -outer_i..=outer_i {
                        if dx.abs().max(dy.abs()) >= inner {
                            let v = ground.z[cbase + (yi + dy) as usize];
                            if v.is_finite() { ring.push(f64::from(v)); }
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
                out.push(KnollCandidate {
                    at: ground.cell_center(x, y),
                    rise,
                    share: lower as f64 / ring.len() as f64,
                    foot_m2,
                    wet: wet_mask.is_some_and(|wm| wm[idx] != 0),
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
        if k.wet {
            write!(
                w,
                "{{\"type\":\"Feature\",\"geometry\":{{\"type\":\"Point\",\"coordinates\":[{rx},{ry}]}},\"properties\":{{\"rise\":{rise},\"share\":{share},\"foot\":{foot},\"wet\":1}}}}"
            )
            .map_err(|e| e.to_string())?;
        } else {
            write!(
                w,
                "{{\"type\":\"Feature\",\"geometry\":{{\"type\":\"Point\",\"coordinates\":[{rx},{ry}]}},\"properties\":{{\"rise\":{rise},\"share\":{share},\"foot\":{foot}}}}}"
            )
            .map_err(|e| e.to_string())?;
        }
    }
    write!(w, "]}}").map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}
