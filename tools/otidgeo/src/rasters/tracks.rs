//! Clean-room MIT forest-track detection (`scripts/geo-tracks.ts`) and shared ditches+tracks runner:
//! 16-direction O(1) sliding-window ray filter parallelized over columns & disjoint scanlines.

use crate::rasters::ditches::ditch_lines;
use crate::rasters::geom::simplify;
use crate::rasters::grid_io::{js_round, write_moisture_dxf, DxfLayer, GroundGrid};
use crate::rasters::skeleton::{close_8, paths, thin};
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};

const TRACK_CELL: f64 = 1.0;
const TRACK_SIDE: f64 = 4.0;
const TRACK_INNER: f64 = 1.5;
const TRACK_JOIN: f64 = 1.0;
const TRACK_REACH: f64 = 12.0;
const TRACK_STRONG_Q: f64 = 0.95;
const TRACK_WEAK_Q: f64 = 0.88;
const TRACK_MIN_STRONG: f64 = 0.03;
const TRACK_MIN_WEAK: f64 = 0.015;
const TRACK_MIN_PIECE: f64 = 24.0;
const TRACK_MAX_GAP: f64 = 50.0;
const TRACK_MAX_ANGLE_DEG: f64 = 25.0;
const TRACK_MIN_CHAIN: f64 = 80.0;
const TRACK_DIRECTIONS: usize = 16;
const MAX_TRACKS: usize = 20_000;

pub struct DitchesTracksSummary {
    pub ditches: usize,
    pub terrain_channels: usize,
    pub tracks: usize,
}

fn line_length(points: &[[f64; 2]]) -> f64 {
    let mut sum = 0.0f64;
    for k in 1..points.len() {
        sum += (points[k][0] - points[k - 1][0]).hypot(points[k][1] - points[k - 1][1]);
    }
    sum
}

fn coarse_relief(relief: &[f32], width: usize, height: usize, factor: usize) -> (Vec<f32>, usize, usize) {
    if factor <= 1 {
        return (relief.to_vec(), width, height);
    }
    let (w, h) = (width / factor, height / factor);
    let mut grid = vec![f32::NAN; w * h];
    grid.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
        for (y, dst) in col.iter_mut().enumerate() {
            let (mut sum, mut n) = (0.0f64, 0u32);
            for ax in 0..factor {
                let base = (x * factor + ax) * height + y * factor;
                for ay in 0..factor {
                    let v = relief[base + ay];
                    if v.is_finite() { sum += f64::from(v); n += 1; }
                }
            }
            if n > 0 { *dst = (sum / f64::from(n)) as f32; }
        }
    });
    (grid, w, h)
}

#[inline]
fn clip_scanline_range(
    c: isize,
    slope: f64,
    margin_i: isize,
    prim_lim: isize,
    sec_lim: isize,
    shift: &[isize],
) -> (isize, isize) {
    if slope == 0.0 {
        return (margin_i, prim_lim);
    }
    if slope > 0.0 {
        let mut a = (((margin_i - c) as f64 - 0.5) / slope).floor().clamp(margin_i as f64, (prim_lim + 1) as f64) as isize;
        let mut b = (((sec_lim - c) as f64 + 0.5) / slope).ceil().clamp((margin_i - 1) as f64, prim_lim as f64) as isize;
        while a <= prim_lim && c + shift[a as usize] < margin_i { a += 1; }
        while a > margin_i && c + shift[(a - 1) as usize] >= margin_i { a -= 1; }
        while b >= margin_i && c + shift[b as usize] > sec_lim { b -= 1; }
        while b < prim_lim && c + shift[(b + 1) as usize] <= sec_lim { b += 1; }
        (a, b)
    } else {
        let mut a = (((sec_lim - c) as f64 + 0.5) / slope).floor().clamp(margin_i as f64, (prim_lim + 1) as f64) as isize;
        let mut b = (((margin_i - c) as f64 - 0.5) / slope).ceil().clamp((margin_i - 1) as f64, prim_lim as f64) as isize;
        while a <= prim_lim && c + shift[a as usize] > sec_lim { a += 1; }
        while a > margin_i && c + shift[(a - 1) as usize] <= sec_lim { a -= 1; }
        while b >= margin_i && c + shift[b as usize] < margin_i { b -= 1; }
        while b < prim_lim && c + shift[(b + 1) as usize] >= margin_i { b += 1; }
        (a, b)
    }
}

/// 16-direction O(1) sliding-window ray filter parallelized over columns & disjoint scanlines.
pub fn track_response(
    grid: &[f32],
    w: usize,
    h: usize,
    side_cells: &[usize],
    reach_cells: usize,
) -> Vec<f32> {
    let n = w * h;
    let best_bits: Vec<AtomicU32> = (0..n).map(|_| AtomicU32::new(0)).collect();
    let margin = reach_cells + 1;
    if w <= 2 * margin || h <= 2 * margin || side_cells.is_empty() {
        return vec![0.0f32; n];
    }
    let mut profile = vec![0.0f32; n];
    let mut shift = vec![0isize; w.max(h)];
    let x_end_lim = (w - margin - 1) as isize;
    let y_end_lim = (h - margin - 1) as isize;
    let margin_i = margin as isize;

    for d in 0..TRACK_DIRECTIONS {
        let angle = std::f64::consts::PI * d as f64 / TRACK_DIRECTIONS as f64;
        let (ux, uy) = (angle.cos(), angle.sin());
        let nx_list: Vec<isize> = side_cells.iter().map(|&s| js_round(-uy * s as f64) as isize).collect();
        let ny_list: Vec<isize> = side_cells.iter().map(|&s| js_round(ux * s as f64) as isize).collect();
        let mut far = 0usize;
        for s in 0..side_cells.len() {
            far = far.max(nx_list[s].unsigned_abs()).max(ny_list[s].unsigned_abs());
        }
        if w <= 2 * far || h <= 2 * far {
            continue;
        }
        let offs: Vec<isize> = (0..side_cells.len()).map(|s| nx_list[s] * h as isize + ny_list[s]).collect();
        let two_sides = offs.len() == 2;

        profile.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
            if x < far || x >= w - far {
                col.fill(0.0);
                return;
            }
            col[..far].fill(0.0);
            col[(h - far)..h].fill(0.0);
            let base = (x * h) as isize;
            if two_sides {
                let (off0, off1) = (offs[0], offs[1]);
                for y in far..(h - far) {
                    let i = base + y as isize;
                    let (a, b, c, dv, center) = (
                        grid[(i + off0) as usize],
                        grid[(i - off0) as usize],
                        grid[(i + off1) as usize],
                        grid[(i - off1) as usize],
                        grid[i as usize],
                    );
                    col[y] = if a.is_finite() && b.is_finite() && c.is_finite() && dv.is_finite() && center.is_finite() {
                        a.min(b).min(c.min(dv)) - center
                    } else {
                        0.0
                    };
                }
            } else {
                for y in far..(h - far) {
                    let i = base + y as isize;
                    let center = grid[i as usize];
                    if !center.is_finite() {
                        col[y] = 0.0;
                        continue;
                    }
                    let mut low = f32::INFINITY;
                    let mut ok = true;
                    for &off in &offs {
                        let (a, b) = (grid[(i + off) as usize], grid[(i - off) as usize]);
                        if !a.is_finite() || !b.is_finite() { ok = false; break; }
                        low = low.min(a).min(b);
                    }
                    col[y] = if ok { low - center } else { 0.0 };
                }
            }
        });

        let profile_ref = &profile;
        let best_ref = &best_bits;

        if ux.abs() >= uy.abs() {
            let slope = uy / ux;
            let r = js_round(reach_cells as f64 * ux.abs()).max(1.0) as isize;
            let inv = 1.0 / (2 * r + 1) as f64;
            for x in 0..w { shift[x] = js_round(x as f64 * slope) as isize; }
            let (s0, s1) = (shift[margin], shift[x_end_lim as usize]);
            let (c_min, c_max) = (margin_i - s0.max(s1), y_end_lim - s0.min(s1));
            let shift_ref = &shift[..w];

            (c_min..=c_max).into_par_iter().for_each(|c| {
                let (mut x0, x1) = clip_scanline_range(c, slope, margin_i, x_end_lim, y_end_lim, shift_ref);
                if x0 > x1 { return; }
                let mut sum = 0.0f64;
                for k in (x0 - r)..=(x0 + r) {
                    sum += f64::from(profile_ref[k as usize * h + (c + shift_ref[k as usize]) as usize]);
                }
                loop {
                    let idx = x0 as usize * h + (c + shift_ref[x0 as usize]) as usize;
                    let val = sum * inv;
                    if val > f64::from(f32::from_bits(best_ref[idx].load(Ordering::Relaxed))) {
                        best_ref[idx].store((val as f32).to_bits(), Ordering::Relaxed);
                    }
                    if x0 == x1 { break; }
                    let (add, drop) = ((x0 + r + 1) as usize, (x0 - r) as usize);
                    sum += f64::from(profile_ref[add * h + (c + shift_ref[add]) as usize])
                        - f64::from(profile_ref[drop * h + (c + shift_ref[drop]) as usize]);
                    x0 += 1;
                }
            });
        } else {
            let slope = ux / uy;
            let r = js_round(reach_cells as f64 * uy).max(1.0) as isize;
            let inv = 1.0 / (2 * r + 1) as f64;
            for y in 0..h { shift[y] = js_round(y as f64 * slope) as isize; }
            let (s0, s1) = (shift[margin], shift[y_end_lim as usize]);
            let (c_min, c_max) = (margin_i - s0.max(s1), x_end_lim - s0.min(s1));
            let shift_ref = &shift[..h];

            (c_min..=c_max).into_par_iter().for_each(|c| {
                let (mut y0, y1) = clip_scanline_range(c, slope, margin_i, y_end_lim, x_end_lim, shift_ref);
                if y0 > y1 { return; }
                let mut sum = 0.0f64;
                for k in (y0 - r)..=(y0 + r) {
                    sum += f64::from(profile_ref[(c + shift_ref[k as usize]) as usize * h + k as usize]);
                }
                loop {
                    let idx = (c + shift_ref[y0 as usize]) as usize * h + y0 as usize;
                    let val = sum * inv;
                    if val > f64::from(f32::from_bits(best_ref[idx].load(Ordering::Relaxed))) {
                        best_ref[idx].store((val as f32).to_bits(), Ordering::Relaxed);
                    }
                    if y0 == y1 { break; }
                    let (add, drop) = ((y0 + r + 1) as usize, (y0 - r) as usize);
                    sum += f64::from(profile_ref[(c + shift_ref[add]) as usize * h + add])
                        - f64::from(profile_ref[(c + shift_ref[drop]) as usize * h + drop]);
                    y0 += 1;
                }
            });
        }
    }

    best_bits.into_iter().map(|a| f32::from_bits(a.into_inner())).collect()
}

fn quantile(values: &[f32], share: f64) -> f64 {
    let (mut max, mut n) = (0.0f64, 0usize);
    for &v in values {
        if v > 0.0 {
            n += 1;
            if f64::from(v) > max { max = f64::from(v); }
        }
    }
    if n == 0 {
        return f64::INFINITY;
    }
    const BINS: usize = 4096;
    let mut counts = [0u32; BINS];
    for &v in values {
        if v > 0.0 {
            counts[((f64::from(v) / max * BINS as f64).floor() as usize).min(BINS - 1)] += 1;
        }
    }
    let target = share * values.len() as f64;
    let mut below = (values.len() - n) as f64;
    for (b, &cnt) in counts.iter().enumerate() {
        below += f64::from(cnt);
        if below >= target {
            return (b + 1) as f64 / BINS as f64 * max;
        }
    }
    max
}

fn densify(line: &[[f64; 2]], step: f64) -> Vec<[f64; 2]> {
    let mut out = vec![line[0]];
    for k in 1..line.len() {
        let ([ax, ay], [bx, by]) = (line[k - 1], line[k]);
        let n = ((bx - ax).hypot(by - ay) / step).ceil().max(1.0) as usize;
        for t in 1..=n {
            let f = t as f64 / n as f64;
            out.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
        }
    }
    out
}

fn straight_pieces(line: &[[f64; 2]], min_length: f64) -> Vec<Vec<[f64; 2]>> {
    if line.is_empty() { return Vec::new(); }
    let mut out = Vec::new();
    let mut current = vec![line[0]];
    let max_turn = std::f64::consts::PI * 35.0 / 180.0;
    let flush = |cur: &[[f64; 2]], out: &mut Vec<Vec<[f64; 2]>>| {
        if cur.len() >= 2 {
            let total = line_length(cur);
            let last = *cur.last().unwrap();
            let chord = (last[0] - cur[0][0]).hypot(last[1] - cur[0][1]);
            if total >= min_length && chord >= 0.8 * total { out.push(cur.to_vec()); }
        }
    };
    for k in 1..line.len() {
        current.push(line[k]);
        if k + 1 < line.len() {
            let ([ax, ay], [bx, by], [cx, cy]) = (line[k - 1], line[k], line[k + 1]);
            let cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
            let dot = (bx - ax) * (cx - bx) + (by - ay) * (cy - by);
            if cross.atan2(dot).abs() > max_turn {
                flush(&current, &mut out);
                current = vec![line[k]];
            }
        }
    }
    flush(&current, &mut out);
    out
}

fn end_direction(line: &[[f64; 2]], at_start: bool, back: f64) -> [f64; 2] {
    let pts: Vec<[f64; 2]> = if at_start { line.iter().rev().copied().collect() } else { line.to_vec() };
    let end = *pts.last().unwrap();
    let mut k = pts.len().saturating_sub(2);
    let mut walked = 0.0f64;
    while k > 0 && walked < back {
        walked += (pts[k][0] - pts[k + 1][0]).hypot(pts[k][1] - pts[k + 1][1]);
        if walked < back { k -= 1; }
    }
    let from = pts[k];
    let (dx, dy) = (end[0] - from[0], end[1] - from[1]);
    let raw_n = dx.hypot(dy);
    let n = if raw_n == 0.0 { 1.0 } else { raw_n };
    [dx / n, dy / n]
}

fn link_tracks(pieces: &[Vec<[f64; 2]>]) -> Vec<Vec<[f64; 2]>> {
    struct End { piece: usize, start: bool, at: [f64; 2], dir: [f64; 2] }
    let mut ends = Vec::<End>::with_capacity(pieces.len() * 2);
    for (piece, line) in pieces.iter().enumerate() {
        ends.push(End { piece, start: false, at: *line.last().unwrap(), dir: end_direction(line, false, 15.0) });
        ends.push(End { piece, start: true, at: line[0], dir: end_direction(line, true, 15.0) });
    }
    let cos_lim = (TRACK_MAX_ANGLE_DEG * std::f64::consts::PI / 180.0).cos();
    let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (k, e) in ends.iter().enumerate() {
        buckets.entry(((e.at[0] / TRACK_MAX_GAP).floor() as i64, (e.at[1] / TRACK_MAX_GAP).floor() as i64)).or_default().push(k);
    }
    let mut candidates = Vec::<(f64, usize, usize)>::new();
    for (k, a) in ends.iter().enumerate() {
        let (bx, by) = ((a.at[0] / TRACK_MAX_GAP).floor() as i64, (a.at[1] / TRACK_MAX_GAP).floor() as i64);
        for ax in -1..=1 {
            for ay in -1..=1 {
                if let Some(list) = buckets.get(&(bx + ax, by + ay)) {
                    for &m in list {
                        if m <= k || ends[m].piece == a.piece { continue; }
                        let b = &ends[m];
                        let (dx, dy) = (b.at[0] - a.at[0], b.at[1] - a.at[1]);
                        let gap = dx.hypot(dy);
                        if gap > TRACK_MAX_GAP { continue; }
                        if gap < 1.0 || ((a.dir[0] * dx + a.dir[1] * dy) / gap > cos_lim && -(b.dir[0] * dx + b.dir[1] * dy) / gap > cos_lim) {
                            candidates.push((gap, k, m));
                        }
                    }
                }
            }
        }
    }
    candidates.sort_by(|p, q| p.0.total_cmp(&q.0));
    let mut partner = vec![-1i32; ends.len()];
    let mut parent: Vec<usize> = (0..pieces.len()).collect();
    let find_root = |mut k: usize, par: &mut [usize]| -> usize {
        while par[k] != k { par[k] = par[par[k]]; k = par[k]; }
        k
    };
    for (_, a, b) in candidates {
        if partner[a] >= 0 || partner[b] >= 0 { continue; }
        let (ra, rb) = (find_root(ends[a].piece, &mut parent), find_root(ends[b].piece, &mut parent));
        if ra == rb { continue; }
        partner[a] = b as i32;
        partner[b] = a as i32;
        parent[ra] = rb;
    }

    let mut used = vec![0u8; pieces.len()];
    let mut out = Vec::new();
    for k in 0..ends.len() {
        if partner[k] >= 0 || used[ends[k].piece] != 0 { continue; }
        let mut line = Vec::new();
        let mut end = k as i32;
        while end >= 0 && used[ends[end as usize].piece] == 0 {
            let eu = end as usize;
            let piece = ends[eu].piece;
            let pts = &pieces[piece];
            used[piece] = 1;
            if ends[eu].start { line.extend_from_slice(pts); } else { line.extend(pts.iter().rev().copied()); }
            end = partner[eu ^ 1];
        }
        if line_length(&line) >= TRACK_MIN_CHAIN { out.push(line); }
    }
    out
}

/// Extracts forest tracks (`spar_laser`) from precomputed 4 m local relief (`scripts/geo-tracks.ts`).
pub fn track_lines(
    ground: &GroundGrid,
    relief: &[f32],
    wet_mask: Option<&[u8]>,
    water_mask: Option<&[u8]>,
) -> Vec<Vec<[f64; 2]>> {
    let factor = js_round(TRACK_CELL / ground.cell).max(1.0) as usize;
    let cell = ground.cell * factor as f64;
    let (grid, w, h) = coarse_relief(relief, ground.width, ground.height, factor);
    if w < 8 || h < 8 { return Vec::new(); }
    let mut sides = vec![js_round(TRACK_SIDE / cell).max(1.0) as usize];
    if TRACK_INNER > 0.0 {
        let inner = js_round(TRACK_INNER / cell).max(1.0) as usize;
        if !sides.contains(&inner) { sides.push(inner); }
    }
    let response = track_response(&grid, w, h, &sides, js_round(TRACK_REACH / cell).max(2.0) as usize);
    let strong = TRACK_MIN_STRONG.max(quantile(&response, TRACK_STRONG_Q));
    let weak = TRACK_MIN_WEAK.max(quantile(&response, TRACK_WEAK_Q));

    let mut mask = vec![0u8; w * h];
    let mut queue = Vec::<usize>::new();
    for (i, &v) in response.iter().enumerate() {
        if f64::from(v) >= strong { mask[i] = 1; queue.push(i); }
    }
    let mut head = 0usize;
    let (wi, hi) = (w as isize, h as isize);
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        let x = (i / h) as isize;
        let y = (i - x as usize * h) as isize;
        for ax in -1..=1isize {
            let nx = x + ax;
            if nx < 0 || nx >= wi { continue; }
            for ay in -1..=1isize {
                let ny = y + ay;
                if ny < 0 || ny >= hi { continue; }
                let n = nx as usize * h + ny as usize;
                if mask[n] == 0 && f64::from(response[n]) >= weak { mask[n] = 1; queue.push(n); }
            }
        }
    }

    let skeleton = thin(&close_8(&mask, w, h, js_round(TRACK_JOIN / cell) as usize), w, h);
    let min_cells = js_round(TRACK_MIN_PIECE / cell / std::f64::consts::SQRT_2).max(3.0) as usize;
    let mut pieces = Vec::new();
    for path in paths(&skeleton, w, h, min_cells, usize::MAX) {
        let pts: Vec<[f64; 2]> = path
            .iter()
            .map(|&i| {
                let x = i / h;
                [ground.min_x + (x as f64 + 0.5) * cell, ground.min_y + ((i - x * h) as f64 + 0.5) * cell]
            })
            .collect();
        for piece in straight_pieces(&simplify(&pts, cell * 0.75), TRACK_MIN_PIECE) {
            if let Some(wm) = water_mask {
                if piece.iter().any(|&[px, py]| ground.lookup_mask(wm, px, py)) { continue; }
            }
            if let Some(wet) = wet_mask {
                let dense = densify(&piece, cell);
                if dense.iter().filter(|&&[px, py]| ground.lookup_mask(wet, px, py)).count() * 2 > dense.len() { continue; }
            }
            pieces.push(piece);
        }
    }

    let mut linked: Vec<Vec<[f64; 2]>> = link_tracks(&pieces).into_iter().map(|l| simplify(&l, cell * 0.5)).collect();
    linked.truncate(MAX_TRACKS);
    linked
}

/// Runs ditches + tracks in parallel on a shared 4 m `local_relief` and writes `diken.dxf` & `spar.dxf`.
pub fn run_ditches_tracks(
    ground: &GroundGrid,
    relief_4m: &[f32],
    wet_mask: Option<&[u8]>,
    water_mask: Option<&[u8]>,
    out_dir: &Path,
) -> Result<DitchesTracksSummary, String> {
    let ((ditches, terrain_channels), tracks) = rayon::join(
        || ditch_lines(ground, relief_4m, wet_mask, water_mask),
        || track_lines(ground, relief_4m, wet_mask, water_mask),
    );
    if !ditches.is_empty() || !terrain_channels.is_empty() {
        let layers = [
            DxfLayer { name: "dike", closed: false, parts: &ditches, points: &[] },
            DxfLayer { name: "fuktstrak_terrang", closed: false, parts: &terrain_channels, points: &[] },
        ];
        write_moisture_dxf(&out_dir.join("diken.dxf"), &layers)?;
    }
    if !tracks.is_empty() {
        let layers = [DxfLayer { name: "spar_laser", closed: false, parts: &tracks, points: &[] }];
        write_moisture_dxf(&out_dir.join("spar.dxf"), &layers)?;
    }
    Ok(DitchesTracksSummary { ditches: ditches.len(), terrain_channels: terrain_channels.len(), tracks: tracks.len() })
}
