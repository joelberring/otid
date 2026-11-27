//! Topology-safe Marching Squares contour extraction (`rayon`-parallel over levels)
//! with strict ISOM 2017-2 / ISSprOM index-contour (`102`) level and size rules.

use crate::dem::PreparedDem;
use crate::geometry::{
    closed_loop_raw_prominence, guard_and_simplify_all, is_depression_ring, polyline_length,
    signed_area, smooth_curve_safe,
};
use crate::knolls::promote_small_loop_to_knoll;
use crate::types::{ContourLayer, ContourLine, EngineConfig, KnollPoint};
use rayon::prelude::*;
use std::collections::HashMap;

/// Raw traced polyline prior to smoothing and simplification.
#[derive(Clone, Debug)]
pub struct RawChain {
    pub closed: bool,
    pub points: Vec<[f64; 2]>,
}

/// Deterministic canonical edge ID in the `(w x h)` grid.
/// Bit 0 = 0: horizontal edge `(c, r)` between `(c, r)` and `(c+1, r)`.
/// Bit 0 = 1: vertical edge `(c, r)` between `(c, r)` and `(c, r+1)`.
#[inline]
fn edge_h(c: usize, r: usize, w: usize) -> u64 {
    ((r as u64) * (w as u64) + (c as u64)) << 1
}

#[inline]
fn edge_v(c: usize, r: usize, w: usize) -> u64 {
    (((r as u64) * (w as u64) + (c as u64)) << 1) | 1
}

/// Extracts all contour chains at a single elevation `level` using Marching Squares
/// with exact asymptotic saddle resolution (guarantees 0 crossings & 0 self-intersections).
pub fn trace_level(dem: &PreparedDem, level: f64) -> Vec<RawChain> {
    let (w, h) = (dem.width, dem.height);
    if w < 2 || h < 2 {
        return Vec::new();
    }
    let z = &dem.contour_z;
    let draw = &dem.drawable;
    let world = dem.world;

    // Small deterministic nudge prevents exact zero hits at grid nodes.
    let val = |idx: usize| -> f64 {
        let d = f64::from(z[idx]) - level;
        if d.abs() < 1e-4 { 1e-4 } else { d }
    };

    let mut next_edge: HashMap<u64, (u64, [f64; 2], [f64; 2])> = HashMap::new();
    let mut has_incoming: HashMap<u64, bool> = HashMap::new();

    for r in 0..(h - 1) {
        let row0 = r * w;
        let row1 = (r + 1) * w;
        for c in 0..(w - 1) {
            let i00 = row0 + c;
            let i10 = row0 + c + 1;
            let i11 = row1 + c + 1;
            let i01 = row1 + c;
            if draw[i00] == 0 || draw[i10] == 0 || draw[i11] == 0 || draw[i01] == 0 {
                continue;
            }
            let v00 = val(i00);
            let v10 = val(i10);
            let v11 = val(i11);
            let v01 = val(i01);

            let mask = (usize::from(v00 >= 0.0))
                | (usize::from(v10 >= 0.0) << 1)
                | (usize::from(v11 >= 0.0) << 2)
                | (usize::from(v01 >= 0.0) << 3);
            if mask == 0 || mask == 15 {
                continue;
            }

            let pt_n = || -> (u64, [f64; 2]) {
                let t = (-v00 / (v10 - v00)).clamp(1e-4, 1.0 - 1e-4);
                (edge_h(c, r, w), [world.col_to_x(c as f64 + t), world.row_to_y(r as f64)])
            };
            let pt_e = || -> (u64, [f64; 2]) {
                let t = (-v10 / (v11 - v10)).clamp(1e-4, 1.0 - 1e-4);
                (edge_v(c + 1, r, w), [world.col_to_x((c + 1) as f64), world.row_to_y(r as f64 + t)])
            };
            let pt_s = || -> (u64, [f64; 2]) {
                let t = (-v01 / (v11 - v01)).clamp(1e-4, 1.0 - 1e-4);
                (edge_h(c, r + 1, w), [world.col_to_x(c as f64 + t), world.row_to_y((r + 1) as f64)])
            };
            let pt_w = || -> (u64, [f64; 2]) {
                let t = (-v00 / (v01 - v00)).clamp(1e-4, 1.0 - 1e-4);
                (edge_v(c, r, w), [world.col_to_x(c as f64), world.row_to_y(r as f64 + t)])
            };

            let mut add = |a: (u64, [f64; 2]), b: (u64, [f64; 2])| {
                next_edge.insert(a.0, (b.0, a.1, b.1));
                has_incoming.insert(b.0, true);
            };

            // Oriented with high ground (>= 0) consistently on the LEFT.
            match mask {
                1 => add(pt_w(), pt_n()),
                2 => add(pt_n(), pt_e()),
                3 => add(pt_w(), pt_e()),
                4 => add(pt_e(), pt_s()),
                6 => add(pt_n(), pt_s()),
                7 => add(pt_w(), pt_s()),
                8 => add(pt_s(), pt_w()),
                9 => add(pt_s(), pt_n()),
                11 => add(pt_s(), pt_e()),
                12 => add(pt_e(), pt_w()),
                13 => add(pt_e(), pt_n()),
                14 => add(pt_n(), pt_w()),
                5 => {
                    let denom = v00 + v11 - v10 - v01;
                    let saddle = (v00 * v11 - v10 * v01) / denom;
                    if saddle >= 0.0 {
                        add(pt_e(), pt_n());
                        add(pt_w(), pt_s());
                    } else {
                        add(pt_w(), pt_n());
                        add(pt_e(), pt_s());
                    }
                }
                10 => {
                    let denom = v00 + v11 - v10 - v01;
                    let saddle = (v00 * v11 - v10 * v01) / denom;
                    if saddle >= 0.0 {
                        add(pt_n(), pt_w());
                        add(pt_s(), pt_e());
                    } else {
                        add(pt_n(), pt_e());
                        add(pt_s(), pt_w());
                    }
                }
                _ => {}
            }
        }
    }

    if next_edge.is_empty() {
        return Vec::new();
    }

    let mut visited: HashMap<u64, bool> = HashMap::with_capacity(next_edge.len());
    let mut chains = Vec::new();

    // 1. Trace open chains from boundary edges with in-degree 0.
    let mut starts: Vec<u64> = next_edge
        .keys()
        .copied()
        .filter(|e| !has_incoming.contains_key(e))
        .collect();
    starts.sort_unstable();

    for start in starts {
        if visited.contains_key(&start) {
            continue;
        }
        let mut pts = Vec::new();
        let mut cur = start;
        let mut first = true;
        while let Some(&(nxt, p_from, p_to)) = next_edge.get(&cur) {
            if visited.insert(cur, true).is_some() {
                break;
            }
            if first {
                pts.push(p_from);
                first = false;
            }
            pts.push(p_to);
            cur = nxt;
        }
        if pts.len() >= 2 {
            chains.push(RawChain { closed: false, points: pts });
        }
    }

    // 2. Trace closed loops from remaining unvisited edges.
    let mut remaining: Vec<u64> = next_edge.keys().copied().collect();
    remaining.sort_unstable();
    for start in remaining {
        if visited.contains_key(&start) {
            continue;
        }
        let mut pts = Vec::new();
        let mut cur = start;
        while let Some(&(nxt, p_from, _p_to)) = next_edge.get(&cur) {
            if visited.insert(cur, true).is_some() {
                break;
            }
            pts.push(p_from);
            cur = nxt;
            if cur == start {
                break;
            }
        }
        if pts.len() >= 3 {
            chains.push(RawChain { closed: true, points: pts });
        }
    }

    chains
}

/// Checks whether an elevation level is a true index level (strictly every `index_every`-th
/// contour counted from sea level 0 m when `level_offset` is 0 or a multiple of `interval`).
#[inline]
pub fn is_index_level(elev: f64, interval: f64, level_offset: f64, index_every: i32) -> bool {
    if index_every <= 0 || !(interval > 0.0) {
        return false;
    }
    let phase = level_offset.rem_euclid(interval);
    let phase = if (interval - phase).abs() < 1e-6 || phase.abs() < 1e-6 { 0.0 } else { phase };
    let k = ((elev - phase) / interval).round() as i32;
    k.rem_euclid(index_every) == 0
}

/// Evaluates ISOM 2017-2 / ISSprOM index-contour promotion for a closed ring on an index level.
/// Prevents "index-contour blobs" on small isolated knolls and small closed depressions.
#[inline]
pub fn qualifies_closed_index_ring(perim_m: f64, area_m2: f64, is_dep: bool, interval: f64) -> bool {
    let sprint = interval <= 3.0;
    if is_dep {
        // Never draw small/medium closed depressions as heavy index contours; only huge basins.
        return if sprint {
            perim_m >= 160.0 && area_m2 >= 1400.0
        } else {
            perim_m >= 320.0 && area_m2 >= 6000.0
        };
    }
    if sprint {
        perim_m >= 48.0 || area_m2 >= 230.0
    } else {
        perim_m >= 105.0 || area_m2 >= 900.0
    }
}

/// Evaluates ISOM 2017-2 / ISSprOM index-contour promotion for an open contour on an index level.
/// Keeps long open index contours and contours continuing across the clip edge, while
/// downgrading short isolated interior stubs to regular `contour` (`101`).
#[inline]
pub fn qualifies_open_index_line(len_m: f64, touches_clip_edge: bool, interval: f64) -> bool {
    let sprint = interval <= 3.0;
    let min_len = if sprint { 25.0 } else { 60.0 };
    let min_edge_len = if sprint { 8.0 } else { 15.0 };
    len_m >= min_len || (touches_clip_edge && len_m >= min_edge_len)
}

/// Extracts main orienteering contours (`101`, `102`, `depression`, `depression_index`)
/// and small-loop-promoted knoll/pit candidates in parallel over elevation levels.
/// Call `knolls::detect_knolls_and_pits` after `extract_formlines` for full `109`/`110`/`111` output.
pub fn extract_contours(dem: &PreparedDem, config: &EngineConfig) -> (Vec<ContourLine>, Vec<KnollPoint>) {
    let mut z_min = f32::INFINITY;
    let mut z_max = f32::NEG_INFINITY;
    for (&z, &d) in dem.contour_z.iter().zip(dem.drawable.iter()) {
        if d != 0 && z.is_finite() {
            z_min = z_min.min(z);
            z_max = z_max.max(z);
        }
    }
    if !z_min.is_finite() || !z_max.is_finite() || z_max <= z_min {
        return (Vec::new(), Vec::new());
    }

    let iv = config.interval;
    let k_min = ((f64::from(z_min) - config.level_offset) / iv).ceil() as i32;
    let k_max = ((f64::from(z_max) - config.level_offset) / iv).floor() as i32;
    if k_max < k_min {
        return (Vec::new(), Vec::new());
    }

    let mut levels: Vec<(f64, bool, bool)> = (k_min..=k_max)
        .map(|k| {
            let elev = config.level_offset + f64::from(k) * iv;
            let is_index = is_index_level(elev, iv, config.level_offset, config.index_every);
            (elev, is_index, false)
        })
        .collect();
    if config.include_intermed {
        for k in k_min..k_max {
            levels.push((config.level_offset + (f64::from(k) + 0.5) * iv, false, true));
        }
    }

    let max_rise = 0.25 * iv;
    let min_open_len = if iv <= 3.0 { 4.0 } else { 6.0 };
    let taubin_passes = config.taubin_passes;

    let per_level: Vec<(Vec<(ContourLine, Vec<[f64; 2]>)>, Vec<KnollPoint>)> = levels
        .par_iter()
        .map(|&(elev, is_index, is_intermed)| {
            let chains = trace_level(dem, elev);
            let mut out_lines = Vec::new();
            let mut out_knolls = Vec::new();

            for ch in chains {
                if ch.closed {
                    let area = signed_area(&ch.points).abs();
                    let is_dep = is_depression_ring(&ch.points, elev, dem);
                    if area < config.min_loop_area_m2 {
                        if !is_intermed {
                            if let Some(knoll) = promote_small_loop_to_knoll(&ch.points, elev, is_dep, dem, config) {
                                out_knolls.push(knoll);
                            }
                        }
                        continue;
                    }
                    let cx = ch.points.iter().map(|p| p[0]).sum::<f64>() / ch.points.len() as f64;
                    let cy = ch.points.iter().map(|p| p[1]).sum::<f64>() / ch.points.len() as f64;
                    let s40 = dem.sample_mean_slope(cx, cy).unwrap_or(5.0);
                    let s16 = dem.sample_mean_slope_16m(cx, cy).unwrap_or(s40);
                    let flat_slp = s40.min(s16);
                    let max_ghost_area = if iv <= 3.0 { 1200.0 } else { 2500.0 };
                    // Suppress flat-ground ghost loops (< 2.6°) lacking real vertical prominence,
                    // while preserving genuine small hills/pits protruding above/below flat ground.
                    if flat_slp < 2.6 && area < max_ghost_area {
                        let prom = closed_loop_raw_prominence(&ch.points, elev, is_dep, dem);
                        let min_prom = if flat_slp < 1.6 {
                            if iv <= 3.0 { 0.62 } else { 0.85 }
                        } else if iv <= 3.0 {
                            0.52
                        } else {
                            0.72
                        };
                        if prom < min_prom {
                            continue;
                        }
                    }
                    let smoothed = smooth_curve_safe(&ch.points, true, dem, elev, max_rise, taubin_passes);
                    let perim = polyline_length(&smoothed, true);
                    let index_ring = is_index && qualifies_closed_index_ring(perim, area, is_dep, iv);
                    let layer = if is_intermed {
                        ContourLayer::ContourIntermed
                    } else {
                        match (is_dep, index_ring) {
                            (true, true) => ContourLayer::DepressionIndex,
                            (true, false) => ContourLayer::Depression,
                            (false, true) => ContourLayer::ContourIndex,
                            (false, false) => ContourLayer::Contour,
                        }
                    };
                    out_lines.push((
                        ContourLine { layer, elevation: elev, closed: true, points: smoothed },
                        ch.points,
                    ));
                } else {
                    let raw_len = polyline_length(&ch.points, false);
                    if raw_len < min_open_len {
                        continue;
                    }
                    let smoothed = smooth_curve_safe(&ch.points, false, dem, elev, max_rise, taubin_passes);
                    let touches_edge = ch
                        .points
                        .first()
                        .is_some_and(|p| dem.touches_clip_boundary(p[0], p[1]))
                        || ch
                            .points
                            .last()
                            .is_some_and(|p| dem.touches_clip_boundary(p[0], p[1]));
                    let open_index = is_index && qualifies_open_index_line(raw_len, touches_edge, iv);
                    let layer = if is_intermed {
                        ContourLayer::ContourIntermed
                    } else if open_index {
                        ContourLayer::ContourIndex
                    } else {
                        ContourLayer::Contour
                    };
                    out_lines.push((
                        ContourLine { layer, elevation: elev, closed: false, points: smoothed },
                        ch.points,
                    ));
                }
            }
            (out_lines, out_knolls)
        })
        .collect();

    let mut lines = Vec::new();
    let mut raw_backups = Vec::new();
    let mut promoted_knolls = Vec::new();
    for (ll, kk) in per_level {
        for (line, raw) in ll {
            lines.push(line);
            raw_backups.push(raw);
        }
        promoted_knolls.extend(kk);
    }

    guard_and_simplify_all(&mut lines, &raw_backups, config.min_clearance_m, config.simplify_m);
    (lines, promoted_knolls)
}
