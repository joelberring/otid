//! Clean-room MIT cliff detection & orientation engine (exact port of `scripts/geo-cliffs.ts`):
//! 38 deg smoothed / 48 deg raw 1 m + 1.25 m drop2 ridge extraction on 1 m ground grid,
//! optional raw tick augmentation, +/-3 m and +/-6 m median drop measurement, local gradient
//! orientation with saddle splitting, 2 m dense top-edge snapping, 1-2-1 smoothing,
//! `brantlinjer.dxf`, and `brantlinjer.geojson`.

use crate::rasters::geom::simplify;
use crate::rasters::grid_io::{js_round, write_moisture_dxf, DxfLayer, GroundGrid};
use crate::rasters::skeleton::{close_4, paths, thin};
use rayon::prelude::*;
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

pub const CLIFF_LOOSE_DROP: f64 = 0.8;
const SLOPE_CLIFF_MIN_DEG: f64 = 38.0;
const RAW_CLIFF_MIN_DEG: f64 = 48.0;
const RAW_CLIFF_MIN_DROP2_M: f64 = 1.25;
const SLOPE_CLIFF_MIN_LEN_M: f64 = 4.5;
const TICK_CELL: f64 = 1.0;

#[derive(Clone, Copy, Debug)]
pub struct CliffRules {
    pub min_drop: f64,
    pub impassable_drop3: f64,
    pub impassable_drop6: f64,
    pub impassable_length: f64,
    pub tags: bool,
}

impl Default for CliffRules {
    fn default() -> Self {
        Self {
            min_drop: 1.3,
            impassable_drop3: 4.5,
            impassable_drop6: 4.5,
            impassable_length: 20.0,
            tags: false,
        }
    }
}

pub struct CliffSummary {
    pub cliffs_201: usize,
    pub cliffs_202: usize,
    pub cliff_meters_201: usize,
    pub cliff_meters_202: usize,
    pub cliffs_dropped: usize,
}

pub(crate) struct CliffCandidate {
    pub(crate) line: Vec<[f64; 2]>,
    pub(crate) drop3: f64,
    pub(crate) drop6: f64,
    pub(crate) length: f64,
    pub(crate) slope_deg: f64,
    pub(crate) sharpness: f64,
}

type Tick = [f64; 4];

fn median_sorted(values: &mut [f64]) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    values[values.len() / 2]
}

fn line_length(line: &[[f64; 2]]) -> f64 {
    let mut total = 0.0f64;
    for i in 1..line.len() {
        total += (line[i][0] - line[i - 1][0]).hypot(line[i][1] - line[i - 1][1]);
    }
    total
}

fn sample_line(line: &[[f64; 2]], step_m: f64) -> Vec<[f64; 2]> {
    if line.is_empty() {
        return Vec::new();
    }
    let mut out = vec![line[0]];
    for i in 1..line.len() {
        let [ax, ay] = line[i - 1];
        let [bx, by] = line[i];
        let len = (bx - ax).hypot(by - ay);
        let steps = (len / step_m).ceil().max(1.0) as usize;
        for k in 1..=steps {
            let t = k as f64 / steps as f64;
            out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        }
    }
    out
}

/// Parses 2-vertex cliff ticks from Karttapullautin DXF (`scripts/geo-cliffs.ts` `readTicks`).
pub fn read_ticks(path: &Path) -> Result<Vec<Tick>, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed reading {}: {e}", path.display()))?;
    let lines: Vec<&str> = text.lines().collect();
    let mut ticks = Vec::new();
    let mut pts = Vec::<f64>::new();
    let mut in_vertex = false;
    let mut i = 0usize;
    while i + 1 < lines.len() {
        let code = lines[i].trim();
        let value = lines[i + 1].trim();
        if code == "0" {
            if value == "SEQEND" {
                if pts.len() >= 4 {
                    let n = pts.len();
                    let t = [pts[0], pts[1], pts[n - 2], pts[n - 1]];
                    if t.iter().all(|v| v.is_finite()) {
                        ticks.push(t);
                    }
                }
                pts.clear();
            }
            in_vertex = value == "VERTEX";
        } else if in_vertex && (code == "10" || code == "20") {
            pts.push(value.parse::<f64>().unwrap_or(f64::NAN));
        }
        i += 2;
    }
    Ok(ticks)
}

fn cliff_lines_from_ticks(ticks: &[Tick], min_length_m: f64) -> Vec<Vec<[f64; 2]>> {
    if ticks.is_empty() {
        return Vec::new();
    }
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for &[x1, y1, x2, y2] in ticks {
        min_x = min_x.min(x1).min(x2);
        max_x = max_x.max(x1).max(x2);
        min_y = min_y.min(y1).min(y2);
        max_y = max_y.max(y1).max(y2);
    }
    min_x = min_x.floor() - 3.0;
    min_y = min_y.floor() - 3.0;
    let width = (max_x - min_x).ceil() as usize + 4;
    let height = (max_y - min_y).ceil() as usize + 4;
    if width.saturating_mul(height) > 80_000_000 {
        return Vec::new();
    }
    let mut mask = vec![0u8; width * height];
    let mut dx = vec![0.0f32; width * height];
    let mut dy = vec![0.0f32; width * height];
    for &[x1, y1, x2, y2] in ticks {
        let raw_len = (x2 - x1).hypot(y2 - y1);
        let len = if raw_len == 0.0 { 1.0 } else { raw_len };
        let ux = (x2 - x1) / len;
        let uy = (y2 - y1) / len;
        let mut step = 0.0f64;
        while step <= len {
            let cx = ((x1 + ux * step - min_x) / TICK_CELL).floor() as usize;
            let cy = ((y1 + uy * step - min_y) / TICK_CELL).floor() as usize;
            let idx = cx * height + cy;
            mask[idx] = 1;
            dx[idx] += ux as f32;
            dy[idx] += uy as f32;
            step += 0.5;
        }
    }
    let skeleton = thin(&close_4(&mask, width, height), width, height);
    let min_cells = js_round(min_length_m / TICK_CELL / std::f64::consts::SQRT_2).max(3.0) as usize;
    let mut lines = Vec::new();
    for path in paths(&skeleton, width, height, min_cells, usize::MAX) {
        let mut points: Vec<[f64; 2]> = path
            .iter()
            .map(|&i| {
                let x = i / height;
                let y = i - x * height;
                [min_x + (x as f64 + 0.5) * TICK_CELL, min_y + (y as f64 + 0.5) * TICK_CELL]
            })
            .collect();
        let mut length = 0.0f64;
        let mut along = 0.0f64;
        for k in 1..points.len() {
            let tx = points[k][0] - points[k - 1][0];
            let ty = points[k][1] - points[k - 1][1];
            length += tx.hypot(ty);
            let x = (path[k] / height) as isize;
            let y = (path[k] - x as usize * height) as isize;
            for ax in -1..=1isize {
                for ay in -1..=1isize {
                    let i = (x + ax) * height as isize + y + ay;
                    if i >= 0 && (i as usize) < dx.len() {
                        along += tx * f64::from(dx[i as usize]) + ty * f64::from(dy[i as usize]);
                    }
                }
            }
        }
        if length < min_length_m {
            continue;
        }
        if along > 0.0 {
            points.reverse();
        }
        let line = simplify(&points, 1.1);
        if line.len() >= 2 {
            lines.push(line);
        }
    }
    lines
}

/// Splits and orients cliff segments locally so downhill is to the right (`geo-cliffs.ts` `orientSegments`).
fn orient_segments(points: &[[f64; 2]], scores: &[f64], min_length_m: f64) -> Vec<Vec<[f64; 2]>> {
    let n = points.len();
    if n < 2 {
        return Vec::new();
    }
    let mut smooth = vec![0.0f64; n];
    let mut total = 0.0f64;
    for i in 0..n {
        total += scores[i];
        let lo = i.saturating_sub(3);
        let hi = (n - 1).min(i + 3);
        let mut sum = 0.0f64;
        for &s in &scores[lo..=hi] {
            sum += s;
        }
        smooth[i] = sum / (hi - lo + 1) as f64;
    }

    #[derive(Clone, Copy)]
    struct Run {
        from: usize,
        to: usize,
        sign: i8,
        length: f64,
        sum: f64,
    }

    let mut runs = Vec::<Run>::new();
    let (mut start, mut sign) = (0usize, 0i8);
    for i in 0..n {
        let s = if smooth[i].abs() > 1e-4 { if smooth[i] > 0.0 { 1 } else { -1 } } else { sign };
        if sign == 0 { sign = s; continue; }
        if s != 0 && s != sign {
            runs.push(Run { from: start, to: i, sign, length: line_length(&points[start..=i]), sum: scores[start..=i].iter().sum() });
            start = i;
            sign = s;
        }
    }
    let final_sign = if sign != 0 { sign } else if total < 0.0 { -1 } else { 1 };
    runs.push(Run { from: start, to: n - 1, sign: final_sign, length: line_length(&points[start..n]), sum: scores[start..n].iter().sum() });

    if !(runs.iter().any(|r| r.length >= min_length_m && r.sign > 0) && runs.iter().any(|r| r.length >= min_length_m && r.sign < 0)) {
        let mut copy = points.to_vec();
        if total < 0.0 { copy.reverse(); }
        return vec![copy];
    }

    let mut merged = Vec::<Run>::new();
    for run in runs {
        if let Some(prev) = merged.last_mut() {
            if run.length < min_length_m || prev.sign == run.sign {
                prev.to = run.to;
                prev.length += run.length;
                prev.sum += run.sum;
                continue;
            }
        }
        merged.push(run);
    }
    if merged.len() > 1 && merged[0].length < min_length_m {
        let first = merged.remove(0);
        merged[0].from = first.from;
        merged[0].length += first.length;
        merged[0].sum += first.sum;
    }

    merged
        .into_iter()
        .filter_map(|run| {
            let mut slice = points[run.from..=run.to].to_vec();
            if line_length(&slice) < min_length_m { return None; }
            if run.sum < 0.0 { slice.reverse(); }
            Some(slice)
        })
        .collect()
}

/// Computes 1-2-1 smoothed 1 m ground surface (shared by slope extraction & centerline slope measurement).
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

/// Extracts cliff centerlines from the 1 m ground grid (`scripts/geo-cliffs.ts` `slopeLines`).
#[allow(dead_code)]
pub fn slope_lines(ground: &GroundGrid) -> Vec<Vec<[f64; 2]>> {
    let smooth = smooth_ground_121(ground);
    slope_lines_with_smooth(ground, &smooth)
}

fn slope_lines_with_smooth(ground: &GroundGrid, smooth: &[f32]) -> Vec<Vec<[f64; 2]>> {
    let (w, h, cell) = (ground.width, ground.height, ground.cell);
    if w < 3 || h < 3 {
        return Vec::new();
    }

    let limit = (SLOPE_CLIFF_MIN_DEG * std::f64::consts::PI / 180.0).tan();
    let raw_limit = (RAW_CLIFF_MIN_DEG * std::f64::consts::PI / 180.0).tan();
    let mut mask = vec![0u8; w * h];
    let mut gx = vec![0.0f32; w * h];
    let mut gy = vec![0.0f32; w * h];

    mask.par_chunks_mut(h)
        .zip(gx.par_chunks_mut(h))
        .zip(gy.par_chunks_mut(h))
        .enumerate()
        .for_each(|(x, ((m_col, gx_col), gy_col))| {
            if x == 0 || x + 1 >= w {
                return;
            }
            let base = x * h;
            for y in 1..(h - 1) {
                let i = base + y;
                let dx = (f64::from(smooth[i + h]) - f64::from(smooth[i - h])) / (2.0 * cell);
                let dy = (f64::from(smooth[i + 1]) - f64::from(smooth[i - 1])) / (2.0 * cell);
                let smooth_ok = dx.is_finite() && dy.is_finite();
                if smooth_ok {
                    gx_col[y] = dx as f32;
                    gy_col[y] = dy as f32;
                    if dx.hypot(dy) >= limit {
                        m_col[y] = 1;
                        continue;
                    }
                }
                // Recover crisp vertical sprint rock ledges that 1-2-1 smoothing smears below 38 deg,
                // while gating on raw_1m_slope >= 48 deg && +/-2 m drop2 >= 1.25 m to reject soil/rock clutter & spikes.
                let z0 = f64::from(ground.z[i]);
                if !z0.is_finite() {
                    continue;
                }
                let dxs = [
                    (f64::from(ground.z[i + h]) - z0) / cell,
                    (z0 - f64::from(ground.z[i - h])) / cell,
                ];
                let dys = [
                    (f64::from(ground.z[i + 1]) - z0) / cell,
                    (z0 - f64::from(ground.z[i - 1])) / cell,
                ];
                let mut raw_grad = 0.0f64;
                let mut raw_gx = 0.0f64;
                let mut raw_gy = 0.0f64;
                for &qx in &dxs {
                    let qx_f = if qx.is_finite() { qx } else { 0.0 };
                    for &qy in &dys {
                        let qy_f = if qy.is_finite() { qy } else { 0.0 };
                        let g = qx_f.hypot(qy_f);
                        if g > raw_grad {
                            raw_grad = g;
                            raw_gx = qx_f;
                            raw_gy = qy_f;
                        }
                    }
                }
                if raw_grad >= raw_limit {
                    let (nx, ny, nlen) = if smooth_ok && dx.hypot(dy) > 1e-4 {
                        (dx, dy, dx.hypot(dy))
                    } else {
                        (raw_gx, raw_gy, raw_grad)
                    };
                    let ux = nx / nlen;
                    let uy = ny / nlen;
                    let [cx, cy] = ground.cell_center(x, y);
                    let up2 = ground.height_at(cx + ux * 2.0, cy + uy * 2.0);
                    let dn2 = ground.height_at(cx - ux * 2.0, cy - uy * 2.0);
                    if up2.is_finite() && dn2.is_finite() && (up2 - dn2) >= RAW_CLIFF_MIN_DROP2_M {
                        m_col[y] = 1;
                        if !smooth_ok {
                            gx_col[y] = raw_gx as f32;
                            gy_col[y] = raw_gy as f32;
                        }
                    }
                }
            }
        });

    let skeleton = thin(&close_4(&mask, w, h), w, h);
    let min_cells = js_round(SLOPE_CLIFF_MIN_LEN_M / cell / std::f64::consts::SQRT_2).max(3.0) as usize;
    let mut lines = Vec::new();
    for path in paths(&skeleton, w, h, min_cells, 50_000) {
        let points: Vec<[f64; 2]> = path
            .iter()
            .map(|&i| {
                let x = i / h;
                let y = i - x * h;
                ground.cell_center(x, y)
            })
            .collect();
        if line_length(&points) < SLOPE_CLIFF_MIN_LEN_M {
            continue;
        }
        let n = points.len();
        let scores: Vec<f64> = (0..n)
            .map(|k| {
                let a = points[k.saturating_sub(2)];
                let b = points[(n - 1).min(k + 2)];
                let tx = b[0] - a[0];
                let ty = b[1] - a[1];
                let raw_len = tx.hypot(ty);
                let len = if raw_len == 0.0 { 1.0 } else { raw_len };
                let idx = path[k];
                (ty * -f64::from(gx[idx]) + -tx * -f64::from(gy[idx])) / len
            })
            .collect();
        for oriented in orient_segments(&points, &scores, SLOPE_CLIFF_MIN_LEN_M) {
            let line = simplify(&oriented, 1.1);
            if line.len() >= 2 {
                lines.push(line);
            }
        }
    }
    lines
}

/// Measures median elevation drops across +/-3 m and +/-6 m normal to the line (`geo-cliffs.ts` `measureCliff`).
pub fn measure_cliff(line: &[[f64; 2]], ground: &GroundGrid) -> (f64, f64, f64) {
    let mut drops3 = Vec::new();
    let mut drops6 = Vec::new();
    let mut length = 0.0f64;
    for i in 1..line.len() {
        let [ax, ay] = line[i - 1];
        let [bx, by] = line[i];
        let seg = (bx - ax).hypot(by - ay);
        if seg == 0.0 {
            continue;
        }
        let rx = (by - ay) / seg;
        let ry = -(bx - ax) / seg;
        let mut step = 0.5f64;
        while step < seg {
            let x = ax + (bx - ax) * step / seg;
            let y = ay + (by - ay) * step / seg;
            let u3 = ground.height_at(x - rx * 3.0, y - ry * 3.0);
            let d3 = ground.height_at(x + rx * 3.0, y + ry * 3.0);
            if u3.is_finite() && d3.is_finite() {
                drops3.push(u3 - d3);
            }
            let u6 = ground.height_at(x - rx * 6.0, y - ry * 6.0);
            let d6 = ground.height_at(x + rx * 6.0, y + ry * 6.0);
            if u6.is_finite() && d6.is_finite() {
                drops6.push(u6 - d6);
            }
            step += 1.0;
        }
        length += seg;
    }
    (median_sorted(&mut drops3), median_sorted(&mut drops6), length)
}

/// Shifts a cliff polyline onto its upper breakline (2 m dense sampling, exact `toTopEdge`).
fn to_top_edge(line: &[[f64; 2]], ground: &GroundGrid, up: f64) -> Vec<[f64; 2]> {
    if line.len() < 2 {
        return line.to_vec();
    }
    let dense = sample_line(line, 2.0);
    let n = dense.len();
    let normals: Vec<[f64; 2]> = (0..n)
        .map(|i| {
            let [ax, ay] = dense[i.saturating_sub(1)];
            let [bx, by] = dense[(n - 1).min(i + 1)];
            let raw_len = (bx - ax).hypot(by - ay);
            let len = if raw_len == 0.0 { 1.0 } else { raw_len };
            [(by - ay) / len, -(bx - ax) / len]
        })
        .collect();

    let steps_count = ((2.5 + up) / 0.5).floor() as usize + 1;
    let mut profile = Vec::<f64>::with_capacity(steps_count);
    let mut shifts = Vec::<f64>::with_capacity(n);
    let mut any_nonzero = false;

    for i in 0..n {
        let [x, y] = dense[i];
        let [rx, ry] = normals[i];
        profile.clear();
        let mut t = -up;
        while t <= 2.5 + 1e-9 {
            profile.push(ground.height_at(x + rx * t, y + ry * t));
            t += 0.5;
        }
        let mut best = 0.0f64;
        let mut best_curve = f64::INFINITY;
        for k in 1..profile.len().saturating_sub(1) {
            let tk = -up + k as f64 * 0.5;
            if tk > 2.0 + 1e-9 {
                break;
            }
            let curve = profile[k - 1] - 2.0 * profile[k] + profile[k + 1];
            if curve.is_finite() && curve < best_curve {
                best_curve = curve;
                best = tk;
            }
        }
        let s = if best_curve.is_finite() && best_curve < -0.1 {
            best.clamp(1.5 - up, 3.0)
        } else {
            0.0
        };
        if s != 0.0 {
            any_nonzero = true;
        }
        shifts.push(s);
    }
    if !any_nonzero {
        return line.to_vec();
    }

    let mut med = vec![0.0f64; n];
    let mut win = [0.0f64; 5];
    for i in 0..n {
        let lo = i.saturating_sub(2);
        let hi = (n - 1).min(i + 2);
        let cnt = hi - lo + 1;
        win[..cnt].copy_from_slice(&shifts[lo..=hi]);
        win[..cnt].sort_by(|a, b| a.total_cmp(b));
        med[i] = win[cnt / 2];
    }

    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let smooth_s = if i == 0 || i + 1 == n {
            med[i]
        } else {
            (med[i - 1] + 2.0 * med[i] + med[i + 1]) * 0.25
        };
        let [x, y] = dense[i];
        let [rx, ry] = normals[i];
        out.push([x + rx * smooth_s, y + ry * smooth_s]);
    }
    out
}

/// Two 1-2-1 smoothing passes on interior vertices + 1.5 m Douglas–Peucker (`geo-cliffs.ts` `evenLine`).
fn even_line(line: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let mut pts = line.to_vec();
    if pts.len() < 3 {
        return pts;
    }
    let mut next = vec![[0.0, 0.0]; pts.len()];
    for _ in 0..2 {
        let n = pts.len();
        next[0] = pts[0];
        next[n - 1] = pts[n - 1];
        for i in 1..(n - 1) {
            next[i] = [
                (pts[i - 1][0] + 2.0 * pts[i][0] + pts[i + 1][0]) * 0.25,
                (pts[i - 1][1] + 2.0 * pts[i][1] + pts[i + 1][1]) * 0.25,
            ];
        }
        std::mem::swap(&mut pts, &mut next);
    }
    simplify(&pts, 1.5)
}

fn orient_by_ground(line: &[[f64; 2]], ground: &GroundGrid, min_length_m: f64) -> Vec<Vec<[f64; 2]>> {
    if line.len() < 2 {
        return Vec::new();
    }
    let dense = sample_line(line, 2.0);
    let n = dense.len();
    let mut measured = 0usize;
    let scores: Vec<f64> = (0..n)
        .map(|i| {
            let [ax, ay] = dense[i.saturating_sub(1)];
            let [bx, by] = dense[(n - 1).min(i + 1)];
            let raw_len = (bx - ax).hypot(by - ay);
            let len = if raw_len == 0.0 { 1.0 } else { raw_len };
            let rx = (by - ay) / len;
            let ry = -(bx - ax) / len;
            let [x, y] = dense[i];
            let up = ground.height_at(x - rx * 3.0, y - ry * 3.0);
            let down = ground.height_at(x + rx * 3.0, y + ry * 3.0);
            if !up.is_finite() || !down.is_finite() {
                return 0.0;
            }
            measured += 1;
            up - down
        })
        .collect();
    if measured == 0 {
        return vec![line.to_vec()];
    }
    orient_segments(&dense, &scores, min_length_m)
}

/// Measures median smoothed slope in degrees along the cliff centerline (prior to top-edge snapping).
fn measure_cliff_slope_deg(line: &[[f64; 2]], ground: &GroundGrid, smooth: &[f32]) -> f64 {
    let (w, h, cell) = (ground.width, ground.height, ground.cell);
    if w < 3 || h < 3 {
        return f64::NAN;
    }
    let mut slopes = Vec::new();
    for i in 1..line.len() {
        let [ax, ay] = line[i - 1];
        let [bx, by] = line[i];
        let seg = (bx - ax).hypot(by - ay);
        if seg == 0.0 {
            continue;
        }
        let mut step = 0.5f64;
        while step < seg {
            let x = ax + (bx - ax) * step / seg;
            let y = ay + (by - ay) * step / seg;
            let gx = ((x - ground.min_x) / cell).floor() as isize;
            let gy = ((y - ground.min_y) / cell).floor() as isize;
            if gx >= 1 && gy >= 1 && (gx as usize) + 1 < w && (gy as usize) + 1 < h {
                let idx = gx as usize * h + gy as usize;
                let dx = (f64::from(smooth[idx + h]) - f64::from(smooth[idx - h])) / (2.0 * cell);
                let dy = (f64::from(smooth[idx + 1]) - f64::from(smooth[idx - 1])) / (2.0 * cell);
                if dx.is_finite() && dy.is_finite() {
                    slopes.push(dx.hypot(dy).atan().to_degrees());
                }
            }
            step += 1.0;
        }
    }
    median_sorted(&mut slopes)
}

#[inline]
fn write_json_opt_f64<W: Write>(w: &mut W, value: f64, scale: f64) -> std::io::Result<()> {
    if value.is_finite() {
        let rounded = js_round(value * scale) / scale;
        let clean = if rounded == 0.0 { 0.0 } else { rounded };
        write!(w, "{clean}")
    } else {
        write!(w, "null")
    }
}

pub(crate) fn write_cliffs_geojson(path: &Path, candidates: &[CliffCandidate]) -> Result<(), String> {
    let file = File::create(path).map_err(|e| format!("Failed creating {}: {e}", path.display()))?;
    let mut w = BufWriter::with_capacity(64 * 1024, file);
    write!(
        w,
        "{{\"type\":\"FeatureCollection\",\"crs\":{{\"type\":\"name\",\"properties\":{{\"name\":\"EPSG:3006\"}}}},\"features\":["
    )
    .map_err(|e| e.to_string())?;
    let mut written = 0usize;
    for c in candidates {
        if c.line.len() < 2 || !c.line.iter().all(|&[x, y]| x.is_finite() && y.is_finite()) {
            continue;
        }
        if written > 0 {
            write!(w, ",").map_err(|e| e.to_string())?;
        }
        written += 1;
        write!(
            w,
            "{{\"type\":\"Feature\",\"geometry\":{{\"type\":\"LineString\",\"coordinates\":["
        )
        .map_err(|e| e.to_string())?;
        for (vi, &[x, y]) in c.line.iter().enumerate() {
            if vi > 0 {
                write!(w, ",").map_err(|e| e.to_string())?;
            }
            let rx = js_round(x * 10.0) / 10.0;
            let ry = js_round(y * 10.0) / 10.0;
            write!(w, "[{rx},{ry}]").map_err(|e| e.to_string())?;
        }
        write!(w, "]}},\"properties\":{{\"drop3\":").map_err(|e| e.to_string())?;
        write_json_opt_f64(&mut w, c.drop3, 100.0).map_err(|e| e.to_string())?;
        write!(w, ",\"drop6\":").map_err(|e| e.to_string())?;
        write_json_opt_f64(&mut w, c.drop6, 100.0).map_err(|e| e.to_string())?;
        write!(w, ",\"length\":").map_err(|e| e.to_string())?;
        write_json_opt_f64(&mut w, c.length, 100.0).map_err(|e| e.to_string())?;
        write!(w, ",\"slope\":").map_err(|e| e.to_string())?;
        write_json_opt_f64(&mut w, c.slope_deg, 10.0).map_err(|e| e.to_string())?;
        write!(w, ",\"sharpness\":").map_err(|e| e.to_string())?;
        write_json_opt_f64(&mut w, c.sharpness, 100.0).map_err(|e| e.to_string())?;
        write!(w, "}}}}").map_err(|e| e.to_string())?;
    }
    write!(w, "]}}").map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

/// Runs the complete cliff pipeline and writes `brantlinjer.dxf` and `brantlinjer.geojson` when non-empty.
pub fn run_cliffs(
    ground: &GroundGrid,
    rules: CliffRules,
    c3g_path: Option<&Path>,
    c2g_path: Option<&Path>,
    out_dir: &Path,
) -> Result<CliffSummary, String> {
    let mut ticks = Vec::<Tick>::new();
    for p in [c3g_path, c2g_path].into_iter().flatten() {
        if p.exists() { ticks.extend(read_ticks(p)?); }
    }

    let smooth = smooth_ground_121(ground);
    let own = slope_lines_with_smooth(ground, &smooth);
    let mut entries: Vec<(Vec<[f64; 2]>, bool)> = own.iter().cloned().map(|l| (l, true)).collect();

    if !ticks.is_empty() {
        let mut taken = HashSet::<(i64, i64)>::new();
        for line in &own {
            for [x, y] in sample_line(line, 3.0) {
                let (gx, gy) = ((x / 6.0).floor() as i64, (y / 6.0).floor() as i64);
                for ax in -1..=1 { for ay in -1..=1 { taken.insert((gx + ax, gy + ay)); } }
            }
        }
        for line in cliff_lines_from_ticks(&ticks, SLOPE_CLIFF_MIN_LEN_M) {
            let samples = sample_line(&line, 3.0);
            let hits = samples.iter().filter(|&&[x, y]| taken.contains(&((x / 6.0).floor() as i64, (y / 6.0).floor() as i64))).count();
            if hits * 2 < samples.len() {
                for oriented in orient_by_ground(&line, ground, SLOPE_CLIFF_MIN_LEN_M) {
                    entries.push((oriented, false));
                }
            }
        }
    }

    let loose_min = rules.min_drop.min(CLIFF_LOOSE_DROP);
    enum Eval { NoData(Vec<[f64; 2]>), Dropped, Candidate { cand: CliffCandidate, kind: Option<bool> } }
    let evaluated: Vec<Eval> = entries
        .into_par_iter()
        .map(|(line, from_ground)| {
            let (drop3, drop6, length) = measure_cliff(&line, ground);
            if !drop3.is_finite() { return Eval::NoData(line); }
            if drop3 < loose_min { return Eval::Dropped; }
            let slope_deg = measure_cliff_slope_deg(&line, ground, &smooth);
            let sharpness = if drop6.is_finite() && drop6 > 0.1 { drop3 / drop6 } else { f64::NAN };
            let top = even_line(&to_top_edge(&line, ground, if from_ground { 8.5 } else { 4.5 }));
            let kind = if drop3 < rules.min_drop {
                None
            } else if drop3 >= rules.impassable_drop3 && drop6 >= rules.impassable_drop6 && length >= rules.impassable_length {
                Some(true)
            } else {
                Some(false)
            };
            Eval::Candidate { cand: CliffCandidate { line: top, drop3, drop6, length, slope_deg, sharpness }, kind }
        })
        .collect();

    let (mut high, mut low, mut candidates, mut dropped) = (Vec::new(), Vec::new(), Vec::new(), 0usize);
    for ev in evaluated {
        match ev {
            Eval::NoData(line) => low.push(line),
            Eval::Dropped => dropped += 1,
            Eval::Candidate { cand, kind } => {
                let top_line = cand.line.clone();
                candidates.push(cand);
                match kind { Some(true) => high.push(top_line), Some(false) => low.push(top_line), None => dropped += 1 }
            }
        }
    }

    if !candidates.is_empty() {
        write_cliffs_geojson(&out_dir.join("brantlinjer.geojson"), &candidates)?;
    }
    if !high.is_empty() || !low.is_empty() {
        let low_layer = if rules.tags { "brant_passerbar_taggar" } else { "brant_passerbar" };
        let layers = [
            DxfLayer { name: "brant_opasserbar", closed: false, parts: &high, points: &[] },
            DxfLayer { name: low_layer, closed: false, parts: &low, points: &[] },
        ];
        write_moisture_dxf(&out_dir.join("brantlinjer.dxf"), &layers)?;
    }

    let total_meters = |lines: &[Vec<[f64; 2]>]| -> usize {
        js_round(lines.iter().map(|l| line_length(l)).sum::<f64>()) as usize
    };
    Ok(CliffSummary {
        cliffs_201: high.len(),
        cliffs_202: low.len(),
        cliff_meters_201: total_meters(&high),
        cliff_meters_202: total_meters(&low),
        cliffs_dropped: dropped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("otidgeo-cliffs-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_36deg_wooded_soil_slope_and_recovers_crisp_vertical_rock_ledge() {
        // 1. Uniform 36 deg wooded soil slope: must NOT produce any cliff line (below 38 deg smoothed & 48 deg raw).
        let (w, h) = (40, 40);
        let tan36 = (36.0 * std::f64::consts::PI / 180.0).tan();
        let mut z_soil = vec![0.0f32; w * h];
        for x in 0..w {
            for y in 0..h {
                z_soil[x * h + y] = (10.0 + y as f64 * tan36) as f32;
            }
        }
        let g_soil = GroundGrid { min_x: 660_000.0, min_y: 6_570_000.0, cell: 1.0, width: w, height: h, z: z_soil };
        let soil_lines = slope_lines(&g_soil);
        assert!(soil_lines.is_empty(), "36 deg wooded soil slope must not extract cliffs, got {}", soil_lines.len());

        // 2. Crisp 1.35 m vertical rock ledge (smoothed slope ~27 deg < 38 deg, raw 1 m slope 53.5 deg >= 48 deg, drop2 = 1.35 m >= 1.25 m).
        let mut z_ledge = vec![10.0f32; w * h];
        for x in 0..w {
            for y in 0..h {
                z_ledge[x * h + y] = if y >= 20 { 11.35 } else { 10.0 };
            }
        }
        let g_ledge = GroundGrid { min_x: 660_000.0, min_y: 6_570_000.0, cell: 1.0, width: w, height: h, z: z_ledge };
        let ledge_lines = slope_lines(&g_ledge);
        assert!(!ledge_lines.is_empty(), "Crisp 1.35 m sprint rock ledge must be recovered");
        let (d3, d6, len) = measure_cliff(&ledge_lines[0], &g_ledge);
        assert!((d3 - 1.35).abs() < 0.15 && (d6 - 1.35).abs() < 0.15 && len > 20.0, "Got d3={d3}, d6={d6}, len={len}");

        let dir = tmp_dir("crisp-ledge");
        let rules = CliffRules { min_drop: 1.0, ..CliffRules::default() };
        let summary = run_cliffs(&g_ledge, rules, None, None, &dir).unwrap();
        assert!(summary.cliffs_202 >= 1);
        let geo = std::fs::read_to_string(dir.join("brantlinjer.geojson")).unwrap();
        assert!(!geo.contains("NaN") && !geo.contains("Infinity"));
        let val: serde_json::Value = serde_json::from_str(&geo).expect("brantlinjer.geojson must be valid JSON");
        let props = &val["features"][0]["properties"];
        assert!(props["drop3"].as_f64().is_some_and(|v| v >= 1.25));
        assert!(props["sharpness"].as_f64().is_some_and(|v| v >= 0.9));
        let _ = std::fs::remove_dir_all(&dir);

        // 3. Shallow 1.05 m step (raw slope 46.4 deg < 48 deg, drop2 = 1.05 < 1.25 m) must NOT extract clutter.
        let mut z_shallow = vec![10.0f32; w * h];
        for x in 0..w {
            for y in 0..h {
                z_shallow[x * h + y] = if y >= 20 { 11.05 } else { 10.0 };
            }
        }
        let g_shallow = GroundGrid { min_x: 660_000.0, min_y: 6_570_000.0, cell: 1.0, width: w, height: h, z: z_shallow };
        assert!(slope_lines(&g_shallow).is_empty(), "Shallow 1.05 m step must not trigger 48 deg / 1.25 m fallback");

        // 4. Narrow 1-cell ridge / spike (1.5 m high, 1 cell wide): raw slope >= 48 deg, but drop2 = 0 -> must NOT extract!
        let mut z_spike = vec![10.0f32; w * h];
        for x in 0..w {
            z_spike[x * h + 20] = 11.5;
        }
        let g_spike = GroundGrid { min_x: 660_000.0, min_y: 6_570_000.0, cell: 1.0, width: w, height: h, z: z_spike };
        assert!(slope_lines(&g_spike).is_empty(), "1-cell narrow spike (drop2 = 0) must not extract cliffs");
    }
}
