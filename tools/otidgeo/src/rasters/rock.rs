//! Clean-room MIT boulders, bare rock, and `berg.png` engine (`scripts/geo-rock.ts` + `geo-steps.ts`):
//! 2D integral `roughness_grid`, shared `local_relief(8.0)`, 3-4 chamfer `distance_to_mask`,
//! Sub-filtered `berg.png`+`.pgw`, and `berg.dxf` writer (combining rock, boulders, and knolls).

use crate::rasters::geom::{clean_mask, local_relief, mask_rings, simplify};
use crate::rasters::grid_io::{js_round, write_moisture_dxf, write_sub_png, DxfLayer, GroundGrid};
use crate::rasters::knolls::{choose_knolls, knoll_candidates_excluding_boulders, write_knolls_geojson};
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::Path;

const BOULDER_MIN_RISE: f64 = 0.8;
const LARGE_BOULDER_RISE: f64 = 1.8;
const BOULDER_MAX_FOOT: usize = 16;
const ROCK_ROUGHNESS: f64 = 0.07;
const ROCK_MIN_AREA_M2: f64 = 100.0;
const MAX_POINTS_PER_KM2: f64 = 400.0;

#[derive(Clone, Copy, Debug)]
pub struct Boulder {
    pub large: bool,
    pub at: [f64; 2],
    pub height: f64,
}

pub struct RockSummary {
    pub boulders: usize,
    pub knolls: usize,
    pub bare_rock_areas: usize,
    pub capped_points: usize,
}

/// Spatial grid index for O(1) nearest-point exclusion (`scripts/geo-rock.ts` `nearIndex`).
pub(crate) struct NearIndex {
    reach: f64,
    cells: HashMap<(i64, i64), Vec<[f64; 2]>>,
}

impl NearIndex {
    pub(crate) fn new(reach: f64) -> Self {
        Self { reach, cells: HashMap::new() }
    }

    pub(crate) fn has(&self, x: f64, y: f64) -> bool {
        let cx = (x / self.reach).floor() as i64;
        let cy = (y / self.reach).floor() as i64;
        for ax in -1..=1 {
            for ay in -1..=1 {
                if let Some(list) = self.cells.get(&(cx + ax, cy + ay)) {
                    for &[px, py] in list {
                        if (px - x).hypot(py - y) < self.reach {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    pub(crate) fn add(&mut self, x: f64, y: f64) {
        let key = ((x / self.reach).floor() as i64, (y / self.reach).floor() as i64);
        self.cells.entry(key).or_default().push([x, y]);
    }
}

#[inline]
fn median_f64(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.total_cmp(b));
    values[values.len() / 2]
}

/// Point cap per km² of finite ground cells (`scripts/geo-steps.ts` `pointCap`).
pub fn point_cap(ground: &GroundGrid) -> usize {
    let finite = ground.z.par_iter().filter(|v| v.is_finite()).count();
    js_round(finite as f64 * ground.cell * ground.cell / 1e6 * MAX_POINTS_PER_KM2).max(50.0) as usize
}

/// Detects boulders (`sten`, `stort_block`) in parallel across columns (`scripts/geo-rock.ts` `boulders`).
pub fn detect_boulders(ground: &GroundGrid, water_mask: Option<&[u8]>) -> (Vec<Boulder>, usize) {
    let (w, h, cell) = (ground.width, ground.height, ground.cell);
    let inner = js_round(3.0 / cell).max(1.0) as isize;
    let outer = js_round(4.0 / cell).max((inner + 1) as f64) as isize;
    let two = js_round(2.0 / cell).max(1.0) as isize;
    if w as isize <= 2 * outer || h as isize <= 2 * outer {
        return (Vec::new(), 0);
    }
    let (x_start, x_end, y_start, y_end) = (outer as usize, w - outer as usize, outer as usize, h - outer as usize);
    let at = |x: isize, y: isize| f64::from(ground.z[x as usize * h + y as usize]);

    let per_col: Vec<Vec<Boulder>> = (x_start..x_end)
        .into_par_iter()
        .map(|x| {
            let mut col_found = Vec::new();
            let mut ring = Vec::<f64>::with_capacity(64);
            let mut near = Vec::<f64>::with_capacity(24);
            let xi = x as isize;
            for y in y_start..y_end {
                let yi = y as isize;
                let here = at(xi, yi);
                if !here.is_finite() { continue; }
                let mut is_top = true;
                'peak: for dx in -1..=1isize {
                    for dy in -1..=1isize {
                        if dx == 0 && dy == 0 { continue; }
                        let nb = at(xi + dx, yi + dy);
                        if !(here > nb || (here == nb && dx + dy > 0)) {
                            is_top = false;
                            break 'peak;
                        }
                    }
                }
                if !is_top { continue; }
                ring.clear();
                for dx in -outer..=outer {
                    for dy in -outer..=outer {
                        let d = dx.abs().max(dy.abs());
                        if d >= inner && d <= outer {
                            let v = at(xi + dx, yi + dy);
                            if v.is_finite() { ring.push(v); }
                        }
                    }
                }
                if ring.len() < 12 { continue; }
                let base = median_f64(&mut ring);
                let rise = here - base;
                if rise < BOULDER_MIN_RISE { continue; }
                near.clear();
                for dx in -two..=two {
                    for dy in -two..=two {
                        if dx.abs().max(dy.abs()) == two {
                            let v = at(xi + dx, yi + dy);
                            if v.is_finite() { near.push(v); }
                        }
                    }
                }
                if near.len() < 8 || here - median_f64(&mut near) < 0.7 * rise { continue; }
                let half_h = base + rise * 0.5;
                let mut foot = 0usize;
                for dx in -inner..=inner {
                    for dy in -inner..=inner {
                        if at(xi + dx, yi + dy) > half_h { foot += 1; }
                    }
                }
                if foot > BOULDER_MAX_FOOT || water_mask.is_some_and(|wm| wm[x * h + y] != 0) {
                    continue;
                }
                col_found.push(Boulder {
                    large: rise >= LARGE_BOULDER_RISE,
                    at: ground.cell_center(x, y),
                    height: js_round(rise * 10.0) / 10.0,
                });
            }
            col_found
        })
        .collect();

    let mut found: Vec<Boulder> = per_col.into_iter().flatten().collect();
    found.sort_by(|a, b| b.height.total_cmp(&a.height));
    let mut kept = Vec::new();
    let mut near = NearIndex::new(3.0);
    for stone in found {
        if !near.has(stone.at[0], stone.at[1]) {
            near.add(stone.at[0], stone.at[1]);
            kept.push(stone);
        }
    }
    let cap = point_cap(ground);
    let capped = kept.len().saturating_sub(cap);
    kept.truncate(cap);
    (kept, capped)
}

/// 5x5 mean absolute deviation from 3x3 smoothing via O(1) 2D integral tables (`roughnessGrid`).
pub fn roughness_grid(ground: &GroundGrid) -> Vec<f32> {
    let fine = local_relief(ground, ground.cell);
    let (w, h) = (ground.width, ground.height);
    let mut out = vec![f32::NAN; w * h];
    if w < 5 || h < 5 {
        return out;
    }
    let stride = h + 1;
    let table_len = (w + 1) * stride;
    let mut sum_tbl = vec![0.0f64; table_len];
    let mut cnt_tbl = vec![0u32; table_len];
    for x in 0..w {
        let (src, dst, left) = (x * h, (x + 1) * stride, x * stride);
        for y in 0..h {
            let v = fine[src + y];
            let fin = v.is_finite();
            let i = dst + y + 1;
            sum_tbl[i] = (if fin { f64::from(v).abs() } else { 0.0 })
                + sum_tbl[left + y + 1]
                + sum_tbl[dst + y]
                - sum_tbl[left + y];
            cnt_tbl[i] = u32::from(fin) + cnt_tbl[left + y + 1] + cnt_tbl[dst + y] - cnt_tbl[left + y];
        }
    }
    out.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
        if x < 2 || x + 2 >= w { return; }
        let (hi_x, lo_x) = ((x + 3) * stride, (x - 2) * stride);
        for y in 2..(h - 2) {
            let (hi_y, lo_y) = (y + 3, y - 2);
            let cnt = (cnt_tbl[hi_x + hi_y] + cnt_tbl[lo_x + lo_y]) - cnt_tbl[lo_x + hi_y] - cnt_tbl[hi_x + lo_y];
            if cnt >= 13 {
                let s = sum_tbl[hi_x + hi_y] - sum_tbl[lo_x + hi_y] - sum_tbl[hi_x + lo_y] + sum_tbl[lo_x + lo_y];
                col[y] = (s / f64::from(cnt)) as f32;
            }
        }
    });
    out
}

/// 3-4 chamfer distance transform in meters (`scripts/geo-rock.ts` `distanceToMask`).
pub fn distance_to_mask(mask: &[u8], width: usize, height: usize, cell: f64) -> Vec<f32> {
    const FAR: i32 = 1 << 28;
    let mut d: Vec<i32> = mask.iter().map(|&v| if v != 0 { 0 } else { FAR }).collect();
    let (wi, hi) = (width as isize, height as isize);
    let relax = |d: &mut [i32], i: usize, x: isize, y: isize, dx: isize, dy: isize, wt: i32| {
        let (nx, ny) = (x + dx, y + dy);
        if nx >= 0 && ny >= 0 && nx < wi && ny < hi {
            let val = d[nx as usize * height + ny as usize] + wt;
            if val < d[i] { d[i] = val; }
        }
    };
    for x in 0..width {
        let xi = x as isize;
        for y in 0..height {
            let (yi, i) = (y as isize, x * height + y);
            relax(&mut d, i, xi, yi, -1, 0, 3);
            relax(&mut d, i, xi, yi, 0, -1, 3);
            relax(&mut d, i, xi, yi, -1, -1, 4);
            relax(&mut d, i, xi, yi, -1, 1, 4);
        }
    }
    for x in (0..width).rev() {
        let xi = x as isize;
        for y in (0..height).rev() {
            let (yi, i) = (y as isize, x * height + y);
            relax(&mut d, i, xi, yi, 1, 0, 3);
            relax(&mut d, i, xi, yi, 0, 1, 3);
            relax(&mut d, i, xi, yi, 1, 1, 4);
            relax(&mut d, i, xi, yi, 1, -1, 4);
        }
    }
    d.into_iter()
        .map(|v| if v >= FAR { f32::INFINITY } else { (f64::from(v) * cell / 3.0) as f32 })
        .collect()
}

/// Bare-rock polygon rings using precomputed `rough` and 8 m `broad` relief (`bareRock`).
pub fn bare_rock_rings(
    ground: &GroundGrid,
    rough: &[f32],
    broad: &[f32],
    open_mask: &[u8],
    forest_mask: &[u8],
    water_mask: Option<&[u8]>,
) -> Vec<Vec<[f64; 2]>> {
    let (w, h, cell) = (ground.width, ground.height, ground.cell);
    let slope_limit = (8.0 * std::f64::consts::PI / 180.0).tan();
    let mut mask = vec![0u8; w * h];
    mask.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
        if x < 2 || x + 2 >= w { return; }
        let base = x * h;
        for y in 2..(h - 2) {
            let i = base + y;
            let r = f64::from(rough[i]);
            if !(r >= ROCK_ROUGHNESS) { continue; }
            let dzx = f64::from(ground.z[(x + 1) * h + y]) - f64::from(ground.z[(x - 1) * h + y]);
            let dzy = f64::from(ground.z[base + y + 1]) - f64::from(ground.z[base + y - 1]);
            let slope = dzx.hypot(dzy) / (2.0 * cell);
            let b = f64::from(broad[i]);
            if !(b > 0.15 || slope > slope_limit) || water_mask.is_some_and(|wm| wm[i] != 0) { continue; }
            if open_mask[i] != 0 || (forest_mask[i] != 0 && r >= ROCK_ROUGHNESS * 1.5 && b > 0.3) {
                col[y] = 1;
            }
        }
    });
    let min_cells = js_round(ROCK_MIN_AREA_M2 / (cell * cell)).max(4.0) as usize;
    let cleaned = clean_mask(&mask, w, h, min_cells, min_cells, None);
    mask_rings(&cleaned, ground.min_x + cell * 0.5, ground.min_y + cell * 0.5, cell, w, h)
        .into_iter()
        .map(|r| simplify(&r, cell * 0.75))
        .filter(|r| r.len() >= 4)
        .collect()
}

/// Writes `berg.png` + `berg.pgw` (exact `scripts/geo-rock.ts` `rockImage` RGB channel encoding).
pub fn write_rock_png(
    out_dir: &Path,
    ground: &GroundGrid,
    rough: &[f32],
    broad: &[f32],
    open_mask: Option<&[u8]>,
    water_mask: Option<&[u8]>,
) -> Result<(), String> {
    let (w, h, cell) = (ground.width, ground.height, ground.cell);
    let to_water = water_mask.map(|wm| distance_to_mask(wm, w, h, cell));
    write_sub_png(&out_dir.join("berg.png"), w, h, |line, row_buf| {
        let y = h - 1 - line;
        for col in 0..w {
            let i = col * h + y;
            let o = col * 4;
            let r = f64::from(rough[i]);
            if !r.is_finite() || water_mask.is_some_and(|wm| wm[i] != 0) {
                row_buf[o..o + 4].fill(0);
                continue;
            }
            let rise = f64::from(broad[i]);
            let rise_v = if rise.is_finite() { rise } else { 0.0 };
            let wm = to_water.as_ref().map_or(f64::INFINITY, |d| f64::from(d[i]));
            let open_bit = if open_mask.is_some_and(|om| om[i] == 1) { 128u8 } else { 0u8 };
            row_buf[o..o + 4].copy_from_slice(&[
                js_round(r * 1000.0).clamp(0.0, 255.0) as u8,
                open_bit + js_round(rise_v * 10.0).clamp(0.0, 127.0) as u8,
                if wm.is_finite() && wm <= 254.0 { js_round(wm) as u8 } else { 255 },
                255,
            ]);
        }
    })?;
    std::fs::write(out_dir.join("berg.pgw"), ground.world_file())
        .map_err(|e| format!("Failed writing berg.pgw: {e}"))
}

/// Runs boulders, optional `berg.png` + `bareRock`, optional knolls, and writes `berg.png`, `berg.dxf`, `kullar.geojson`.
pub fn run_rock_and_knolls(
    ground: &GroundGrid,
    rock_mode: u8,
    include_knolls: bool,
    knoll_share: f64,
    veg_masks: Option<&(Vec<u8>, Vec<u8>)>,
    water_mask: Option<&[u8]>,
    wet_mask: Option<&[u8]>,
    out_dir: &Path,
) -> Result<RockSummary, String> {
    let cap = point_cap(ground);
    let (((stones, stones_capped), (knolls, knolls_capped, candidates)), rock_res) = rayon::join(
        || {
            let (stones, stones_capped) = detect_boulders(ground, water_mask);
            if !include_knolls {
                return ((stones, stones_capped), (Vec::new(), 0usize, Vec::new()));
            }
            let stone_pts: Vec<[f64; 2]> = stones.iter().map(|s| s.at).collect();
            let mut cands = knoll_candidates_excluding_boulders(ground, &stone_pts, water_mask, wet_mask);
            let mut chosen = choose_knolls(&cands, knoll_share);
            let capped = chosen.len().saturating_sub(cap);
            chosen.truncate(cap);
            cands.truncate(cap * 6);
            ((stones, stones_capped), (chosen, capped, cands))
        },
        || -> Result<Vec<Vec<[f64; 2]>>, String> {
            let Some((open_mask, forest_mask)) = veg_masks else {
                return Ok(Vec::new());
            };
            let (rough, broad) = rayon::join(|| roughness_grid(ground), || local_relief(ground, 8.0));
            let (rock, png_res) = rayon::join(
                || {
                    if rock_mode > 0 {
                        bare_rock_rings(ground, &rough, &broad, open_mask, forest_mask, water_mask)
                    } else {
                        Vec::new()
                    }
                },
                || write_rock_png(out_dir, ground, &rough, &broad, Some(open_mask), water_mask),
            );
            png_res?;
            Ok(rock)
        },
    );
    let rock = rock_res?;

    if !candidates.is_empty() {
        write_knolls_geojson(&out_dir.join("kullar.geojson"), &candidates)?;
    }
    if !stones.is_empty() || !rock.is_empty() || !knolls.is_empty() {
        let small: Vec<[f64; 2]> = stones.iter().filter(|s| !s.large).map(|s| s.at).collect();
        let large: Vec<[f64; 2]> = stones.iter().filter(|s| s.large).map(|s| s.at).collect();
        let rock_layer = if rock_mode >= 2 { "berg_i_dagen" } else { "berg_i_dagen_laser" };
        let layers = [
            DxfLayer { name: rock_layer, closed: true, parts: &rock, points: &[] },
            DxfLayer { name: "sten", closed: false, parts: &[], points: &small },
            DxfLayer { name: "stort_block", closed: false, parts: &[], points: &large },
            DxfLayer { name: "dotknoll_laser", closed: false, parts: &[], points: &knolls },
        ];
        write_moisture_dxf(&out_dir.join("berg.dxf"), &layers)?;
    }

    Ok(RockSummary {
        boulders: stones.len(),
        knolls: knolls.len(),
        bare_rock_areas: rock.len(),
        capped_points: stones_capped + knolls_capped,
    })
}
