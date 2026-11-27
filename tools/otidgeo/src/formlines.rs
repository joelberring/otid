//! Directly controllable orienteering form lines (ISOM 103).
//!
//! Extracts half-interval contours (`interval / 2`) and selectively retains
//! segments that clarify real terrain forms (ridges, spurs, noses, saddles,
//! shelves, small knolls, depressions) while discarding steep-slope crowding
//! and flat-ground noise. Includes a local ridge/knoll boost so real 2–3.5 m
//! small hills and distinct noses in 3–8° terrain are never lost.

use crate::contours::trace_level;
use crate::dem::PreparedDem;
use crate::geometry::{
    has_self_intersection, is_depression_ring, point_in_ring, polyline_length, rdp_simplify,
    signed_area, smooth_and_simplify_safe,
};
use crate::types::{ContourLayer, ContourLine, ContourProfile, EngineConfig, FormlineMode};
use rayon::prelude::*;

/// Builds a fast 2D Euclidean-approximation distance grid (meters) to all supplied polylines
/// using rasterization + 2-pass Chamfer (3-4) distance transform (`O(W*H)`).
pub(crate) fn build_line_distance_grid(dem: &PreparedDem, lines: &[ContourLine]) -> Vec<f32> {
    let (w, h, cell) = (dem.width, dem.height, dem.world.cell);
    let mut dist = vec![u16::MAX; w * h];

    let mark = |dist: &mut [u16], x: f64, y: f64| {
        let c = dem.world.x_to_col_f(x).round() as isize;
        let r = dem.world.y_to_row_f(y).round() as isize;
        if c >= 0 && r >= 0 && (c as usize) < w && (r as usize) < h {
            dist[r as usize * w + c as usize] = 0;
        }
    };

    for line in lines {
        let pts = &line.points;
        let segs = if line.closed { pts.len() } else { pts.len().saturating_sub(1) };
        for i in 0..segs {
            let a = pts[i];
            let b = pts[(i + 1) % pts.len()];
            let len = (b[0] - a[0]).hypot(b[1] - a[1]);
            let steps = (len / (cell * 0.5)).ceil().max(1.0) as usize;
            for s in 0..=steps {
                let t = s as f64 / steps as f64;
                mark(&mut dist, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
            }
        }
    }

    // 3-4 Chamfer forward sweep (units = cell / 3).
    for r in 0..h {
        for c in 0..w {
            let i = r * w + c;
            let mut best = dist[i];
            if best == 0 {
                continue;
            }
            if c > 0 {
                best = best.min(dist[i - 1].saturating_add(3));
            }
            if r > 0 {
                best = best.min(dist[i - w].saturating_add(3));
                if c > 0 {
                    best = best.min(dist[i - w - 1].saturating_add(4));
                }
                if c + 1 < w {
                    best = best.min(dist[i - w + 1].saturating_add(4));
                }
            }
            dist[i] = best;
        }
    }
    // 3-4 Chamfer backward sweep.
    for r in (0..h).rev() {
        for c in (0..w).rev() {
            let i = r * w + c;
            let mut best = dist[i];
            if best == 0 {
                continue;
            }
            if c + 1 < w {
                best = best.min(dist[i + 1].saturating_add(3));
            }
            if r + 1 < h {
                best = best.min(dist[i + w].saturating_add(3));
                if c + 1 < w {
                    best = best.min(dist[i + w + 1].saturating_add(4));
                }
                if c > 0 {
                    best = best.min(dist[i + w - 1].saturating_add(4));
                }
            }
            dist[i] = best;
        }
    }

    let scale = (cell / 3.0) as f32;
    dist.into_iter().map(|d| if d == u16::MAX { 999.0 } else { d as f32 * scale }).collect()
}

/// Evaluates terrain form between main contours (`(up - down) / (up + down)` in `[-1, 1]`),
/// positive on shelves/terraces/tops, ~0 on uniform slopes, negative at concave footslopes.
fn form_between_contours(dem: &PreparedDem, x: f64, y: f64, interval: f64, offset: f64) -> f64 {
    let Some(z) = dem.sample_raw(x, y) else { return 0.0 };
    let (Some(ze), Some(zw), Some(zn), Some(zs)) = (
        dem.sample_raw(x + 4.0, y),
        dem.sample_raw(x - 4.0, y),
        dem.sample_raw(x, y + 4.0),
        dem.sample_raw(x, y - 4.0),
    ) else {
        return 0.0;
    };
    let dx = f64::from(ze - zw);
    let dy = f64::from(zn - zs);
    let grad = dx.hypot(dy);
    if grad < 0.05 {
        return 0.0;
    }
    let ux = dx / grad;
    let uy = dy / grad;
    let lower = ((f64::from(z) - offset) / interval).floor() * interval + offset;
    let upper = lower + interval;
    let max_reach = 55.0;
    let step = 2.0;

    let mut up = max_reach;
    let mut d = step;
    while d < max_reach {
        match dem.sample_raw(x + ux * d, y + uy * d) {
            Some(h) if f64::from(h) >= upper => {
                up = d;
                break;
            }
            None => {
                up = d;
                break;
            }
            _ => d += step,
        }
    }

    let mut down = max_reach;
    let mut d = step;
    while d < max_reach {
        match dem.sample_raw(x - ux * d, y - uy * d) {
            Some(h) if f64::from(h) <= lower => {
                down = d;
                break;
            }
            None => {
                down = d;
                break;
            }
            _ => d += step,
        }
    }
    (up - down) / (up + down)
}

/// Measures `raw_z` prominence of an enclosed closed formline loop (peak height above `elev`,
/// or pit depth below `elev`). Used by the ridge/knoll boost to verify genuine small hills/pits.
fn closed_loop_raw_prominence(pts: &[[f64; 2]], elev: f64, is_dep: bool, dem: &PreparedDem) -> f64 {
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let (mut sx, mut sy) = (0.0, 0.0);
    for &[x, y] in pts {
        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);
        sx += x;
        sy += y;
    }
    let cx = sx / pts.len() as f64;
    let cy = sy / pts.len() as f64;
    let mut best = 0.0f64;
    if let Some(zc) = dem.sample_raw(cx, cy) {
        best = best.max(if is_dep { elev - f64::from(zc) } else { f64::from(zc) - elev });
    }
    // Sample interior grid points (step 2 m, capped to <= 12x12) so crescent/elongated peaks are found.
    let step = ((max_x - min_x).max(max_y - min_y) / 10.0).max(2.0);
    let mut y = min_y + 0.5 * step;
    while y < max_y {
        let mut x = min_x + 0.5 * step;
        while x < max_x {
            if point_in_ring([x, y], pts) {
                if let Some(z) = dem.sample_raw(x, y) {
                    best = best.max(if is_dep { elev - f64::from(z) } else { f64::from(z) - elev });
                }
            }
            x += step;
        }
        y += step;
    }
    best
}

/// Resamples a polyline to uniform spacing `step_m`.
fn resample(pts: &[[f64; 2]], closed: bool, step_m: f64) -> Vec<[f64; 2]> {
    let mut path = pts.to_vec();
    if closed && pts.len() >= 3 {
        path.push(pts[0]);
    }
    let total = polyline_length(&path, false);
    let count = (total / step_m).ceil().max(1.0) as usize;
    let mut out = Vec::with_capacity(count + 1);
    out.push(path[0]);
    let mut idx = 1usize;
    let mut before = 0.0;
    for k in 1..count {
        let target = total * (k as f64) / (count as f64);
        let mut span = (path[idx][0] - path[idx - 1][0]).hypot(path[idx][1] - path[idx - 1][1]);
        while idx + 1 < path.len() && before + span < target {
            before += span;
            idx += 1;
            span = (path[idx][0] - path[idx - 1][0]).hypot(path[idx][1] - path[idx - 1][1]);
        }
        let t = if span > 1e-9 { ((target - before) / span).clamp(0.0, 1.0) } else { 0.0 };
        let a = path[idx - 1];
        let b = path[idx];
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out.push(*path.last().unwrap());
    out
}

/// Extracts and filters directly controllable formlines (`103`) on half-contour levels.
pub fn extract_formlines(
    dem: &PreparedDem,
    main_contours: &[ContourLine],
    config: &EngineConfig,
) -> Vec<ContourLine> {
    if config.formline_mode == FormlineMode::Off {
        return Vec::new();
    }

    let mut z_min = f32::INFINITY;
    let mut z_max = f32::NEG_INFINITY;
    for (&z, &d) in dem.contour_z.iter().zip(dem.drawable.iter()) {
        if d != 0 && z.is_finite() {
            z_min = z_min.min(z);
            z_max = z_max.max(z);
        }
    }
    if !z_min.is_finite() || z_max <= z_min {
        return Vec::new();
    }

    let dist_main = build_line_distance_grid(dem, main_contours);
    let dist_at = |x: f64, y: f64| -> f32 {
        let c = dem.world.x_to_col_f(x).round() as isize;
        let r = dem.world.y_to_row_f(y).round() as isize;
        if c >= 0 && r >= 0 && (c as usize) < dem.width && (r as usize) < dem.height {
            dist_main[r as usize * dem.width + c as usize]
        } else {
            999.0
        }
    };

    let iv = config.interval;
    let sprint = iv <= 3.0;
    let half_off = config.level_offset + 0.5 * iv;
    let k_min = ((f64::from(z_min) - half_off) / iv).ceil() as i32;
    let k_max = ((f64::from(z_max) - half_off) / iv).floor() as i32;
    if k_max < k_min {
        return Vec::new();
    }

    let levels: Vec<f64> = (k_min..=k_max).map(|k| half_off + f64::from(k) * iv).collect();
    let max_rise = 0.14 * iv;
    let min_gap = config.formline_min_gap_m as f32;
    let min_slope = config.formline_min_slope_deg as f32;
    let max_slope = config.formline_max_slope_deg as f32;
    let min_len = config.formline_min_length_m;
    let min_cut_len = 14.0f64;
    let taubin_passes = config.taubin_passes;

    // Ridge / small-hill boost parameters (preserve real 2-3.5 m hills & distinct noses in 3-8° terrain).
    let detailed_profile = matches!(config.profile, ContourProfile::VeryDetailed | ContourProfile::Detailed);
    let boost_loop_area_m2: f64 = match config.formline_mode {
        FormlineMode::Off => return Vec::new(),
        FormlineMode::Sparse => if sprint { 28.0 } else { 65.0 },
        FormlineMode::Normal => {
            if detailed_profile {
                if sprint { 10.0 } else { 20.0 }
            } else if sprint {
                16.0
            } else {
                35.0
            }
        }
        FormlineMode::Dense => if sprint { 10.0 } else { 20.0 },
    };
    let boost_loop_area_m2 = boost_loop_area_m2.min(config.formline_min_loop_area_m2);
    let boost_min_prominence = if sprint { 0.45 } else { 0.70 };
    let boost_open_gap = (if sprint { 2.8f32 } else { 4.5f32 }).min(min_gap);

    // Mode-dependent terrain-form selectivity (convexity / shelf preference).
    let (min_convex, min_form, allow_steep_shelf) = match config.formline_mode {
        FormlineMode::Off => return Vec::new(),
        FormlineMode::Sparse => (0.25f32, 0.22f64, false),
        FormlineMode::Normal => (-0.80f32, -0.18f64, true),
        FormlineMode::Dense => (-9.0f32, -1.0f64, true),
    };

    let sample_step = 4.0;
    let per_level: Vec<Vec<ContourLine>> = levels
        .par_iter()
        .map(|&elev| {
            let chains = trace_level(dem, elev);
            let mut out = Vec::new();

            for ch in chains {
                if ch.closed {
                    let area = signed_area(&ch.points).abs();
                    if area < boost_loop_area_m2 {
                        continue;
                    }
                    let is_dep = is_depression_ring(&ch.points, elev, dem);
                    let raw_prom = closed_loop_raw_prominence(&ch.points, elev, is_dep, dem);
                    let verified_hill = raw_prom >= boost_min_prominence;

                    if area < config.formline_min_loop_area_m2 && !verified_hill {
                        continue;
                    }

                    let mut mean_slp = 0.0f64;
                    let mut local_slp_sum = 0.0f64;
                    let mut min_d = f32::INFINITY;
                    let mut n_ok = 0usize;
                    for &[x, y] in &ch.points {
                        if let Some(s) = dem.sample_mean_slope(x, y) {
                            mean_slp += f64::from(s);
                            n_ok += 1;
                        }
                        if let Some(ls) = dem.sample_slope(x, y) {
                            local_slp_sum += f64::from(ls);
                        }
                        min_d = min_d.min(dist_at(x, y));
                    }
                    let avg_slp = if n_ok > 0 { (mean_slp / n_ok as f64) as f32 } else { 5.0 };
                    let avg_local = if n_ok > 0 { (local_slp_sum / n_ok as f64) as f32 } else { 5.0 };
                    // Verified small hills/depressions survive down to gentler background slopes.
                    let loop_min_slope = if is_dep || verified_hill { 0.5 } else { min_slope * 0.6 };
                    if avg_slp < loop_min_slope {
                        continue;
                    }
                    let norm_floor = if sprint { 1.3f32 } else { 2.4f32 };
                    let loop_min_gap = if config.formline_mode == FormlineMode::Dense {
                        (config.min_clearance_m as f32 * 0.9).max(norm_floor * 0.85)
                    } else if verified_hill {
                        (min_gap * 0.40).min(4.5).max(norm_floor)
                    } else {
                        (min_gap * 0.45).max(config.min_clearance_m as f32).max(norm_floor)
                    };
                    if avg_local > max_slope + 4.5 || min_d < loop_min_gap {
                        continue;
                    }
                    let smoothed = smooth_and_simplify_safe(
                        &ch.points,
                        true,
                        dem,
                        elev,
                        max_rise,
                        config.simplify_m,
                        taubin_passes,
                    );
                    out.push(ContourLine {
                        layer: ContourLayer::Formline,
                        elevation: elev,
                        closed: true,
                        points: smoothed,
                    });
                    continue;
                }

                // Open half-contour: smooth first, then resample & evaluate per-point keep mask.
                if polyline_length(&ch.points, false) < min_len {
                    continue;
                }
                let smoothed = smooth_and_simplify_safe(
                    &ch.points,
                    false,
                    dem,
                    elev,
                    max_rise,
                    config.simplify_m * 0.7,
                    taubin_passes,
                );
                let samples = resample(&smoothed, false, sample_step);
                if samples.len() < 3 {
                    continue;
                }
                let total_len = polyline_length(&samples, false);
                let step = total_len / (samples.len() - 1) as f64;

                let mut drop = vec![false; samples.len()];
                let mut hard_gap = vec![false; samples.len()];
                for (i, &[x, y]) in samples.iter().enumerate() {
                    let d = dist_at(x, y);
                    let local_slp = dem.sample_slope(x, y).unwrap_or(5.0);
                    let flat_slp = dem.sample_mean_slope(x, y).unwrap_or(local_slp);
                    let conv16 = dem.sample_convex_16m(x, y).unwrap_or(0.0);
                    let conv60 = dem.sample_convex(x, y).unwrap_or(0.0);

                    // Ridge / nose boost in 2.5-10° terrain (keeps distinct convex spurs & small ridges).
                    let is_ridge_nose = config.formline_mode != FormlineMode::Sparse
                        && local_slp >= 2.0
                        && local_slp <= 11.0
                        && (conv16 >= 0.16 || conv60 >= 0.42);
                    let eff_gap = if is_ridge_nose { boost_open_gap } else { min_gap };

                    if d < eff_gap * 0.78 {
                        drop[i] = true;
                        hard_gap[i] = true;
                        continue;
                    }
                    if flat_slp < min_slope {
                        if !((conv16 >= 0.22 || conv60 >= 0.45) && local_slp >= 1.5) {
                            drop[i] = true;
                            continue;
                        }
                    }
                    // Steep slopes (> max_slope or close to main contour): keep ONLY distinct shelves/noses.
                    if local_slp > max_slope || d < eff_gap {
                        if allow_steep_shelf && local_slp <= max_slope + 3.5 && d >= eff_gap * 0.80 {
                            let form = form_between_contours(dem, x, y, iv, config.level_offset);
                            if form < 0.42 && !is_ridge_nose {
                                drop[i] = true;
                            }
                        } else {
                            drop[i] = true;
                        }
                        continue;
                    }
                    if config.formline_mode != FormlineMode::Dense && !is_ridge_nose {
                        if conv60 < min_convex {
                            let form = form_between_contours(dem, x, y, iv, config.level_offset);
                            if form < min_form {
                                drop[i] = true;
                            }
                        }
                    }
                }

                // Cut runs of dropped samples >= min_cut_len (or always cut if violating hard clearance).
                let mut cut = vec![false; samples.len()];
                let mut i = 0;
                while i < samples.len() {
                    if !drop[i] {
                        i += 1;
                        continue;
                    }
                    let mut j = i;
                    let mut hard_viol = hard_gap[i];
                    while j + 1 < samples.len() && drop[j + 1] {
                        j += 1;
                        if hard_gap[j] {
                            hard_viol = true;
                        }
                    }
                    if ((j - i) as f64) * step >= min_cut_len || hard_viol {
                        for k in i..=j {
                            cut[k] = true;
                        }
                    }
                    i = j + 1;
                }

                // Collect surviving pieces >= min_len.
                let mut i = 0;
                while i < samples.len() {
                    if cut[i] {
                        i += 1;
                        continue;
                    }
                    let mut j = i;
                    while j + 1 < samples.len() && !cut[j + 1] {
                        j += 1;
                    }
                    let piece_len = ((j - i) as f64) * step;
                    if piece_len >= min_len && j > i {
                        let piece = rdp_simplify(&samples[i..=j], false, config.simplify_m);
                        if piece.len() >= 2 && !has_self_intersection(&piece, false) {
                            out.push(ContourLine {
                                layer: ContourLayer::Formline,
                                elevation: elev,
                                closed: false,
                                points: piece,
                            });
                        }
                    }
                    i = j + 1;
                }
            }
            out
        })
        .collect();

    per_level.into_iter().flatten().collect()
}
