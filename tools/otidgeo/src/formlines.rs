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
    closed_loop_raw_prominence, has_self_intersection, is_depression_ring, polyline_length,
    rdp_simplify, signed_area, smooth_and_simplify_safe,
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
    let min_cut_len = if sprint { 8.0f64 } else { 12.0f64 };
    let taubin_passes = config.taubin_passes;

    // Monotonic ridge / small-hill boost parameters (preserve real small hills & distinct noses).
    let boost_loop_area_m2 = match config.formline_mode {
        FormlineMode::Off => return Vec::new(),
        FormlineMode::Sparse => (config.formline_min_loop_area_m2 * 0.75).max(if sprint { 18.0 } else { 44.0 }),
        FormlineMode::Normal => (config.formline_min_loop_area_m2 * 0.52).max(if sprint { 8.0 } else { 16.0 }),
        FormlineMode::Dense => (config.formline_min_loop_area_m2 * 0.48).max(if sprint { 7.0 } else { 14.0 }),
    }
    .min(config.formline_min_loop_area_m2);
    let boost_min_prominence = match config.formline_mode {
        FormlineMode::Sparse => if sprint { 0.55 } else { 0.85 },
        _ => if sprint { 0.35 } else { 0.50 },
    };
    let hard_clearance_floor = (config.min_clearance_m as f32 * 1.30).max(if sprint { 1.25 } else { 2.20 });
    let boost_open_gap = (min_gap * 0.80).max(hard_clearance_floor).min(min_gap);

    // Profile- and mode-dependent terrain-form selectivity (convexity / shelf preference).
    // Omits concave valley footslopes and featureless steep walls while keeping ridges,
    // noses, spurs, hilltops, saddles, and distinct benches/terraces cleanly.
    let (min_convex, min_form, allow_steep_shelf, selective_slope, form_scale) = match config.formline_mode {
        FormlineMode::Off => return Vec::new(),
        FormlineMode::Sparse => (0.25f32, 0.25f64, false, if sprint { 5.0f32 } else { 7.5f32 }, 1.45f32),
        FormlineMode::Dense => (-9.0f32, -1.0f64, true, 90.0f32, 0.0f32),
        FormlineMode::Normal => match config.profile {
            ContourProfile::VeryDetailed => (
                -2.5f32,
                -0.45f64,
                true,
                if sprint { 11.0f32 } else { 16.0f32 },
                if sprint { 0.55f32 } else { 0.42f32 },
            ),
            ContourProfile::Detailed => (
                -1.8f32,
                -0.35f64,
                true,
                if sprint { 8.5f32 } else { 14.2f32 },
                if sprint { 0.78f32 } else { 0.55f32 },
            ),
            ContourProfile::Normal => (
                if sprint { -0.80f32 } else { -1.40f32 },
                if sprint { -0.15f64 } else { -0.30f64 },
                true,
                if sprint { 6.8f32 } else { 13.0f32 },
                if sprint { 0.95f32 } else { 0.68f32 },
            ),
            ContourProfile::Generalized => (
                0.05f32,
                0.12f64,
                true,
                if sprint { 5.0f32 } else { 9.8f32 },
                if sprint { 1.25f32 } else { 1.05f32 },
            ),
            ContourProfile::VeryGeneralized => (
                0.25f32,
                0.25f64,
                false,
                if sprint { 3.8f32 } else { 7.5f32 },
                if sprint { 1.55f32 } else { 1.40f32 },
            ),
        },
    };

    let sample_step = if sprint { 2.5 } else { 3.5 };
    let max_intact_ring_area = if sprint { 600.0f64 } else { 2200.0f64 };
    let flat_mound_c16 = if sprint { 0.34f32 } else { 0.42f32 };
    let nose_c16 = if sprint { 0.10f32 } else { 0.12f32 };
    let nose_c60 = if sprint { 0.28f32 } else { 0.36f32 };
    let steep_cap = max_slope + if config.formline_mode == FormlineMode::Dense { 7.0 } else { 4.5 };

    let per_level: Vec<Vec<ContourLine>> = levels
        .par_iter()
        .map(|&elev| {
            let chains = trace_level(dem, elev);
            let mut out = Vec::new();

            // Evaluates per-sample keep/drop flags along any resampled half-contour (open or cyclic).
            let eval_samples = |pts: &[[f64; 2]]| -> (Vec<bool>, Vec<bool>, Vec<f32>, Vec<f32>) {
                let mut drop = vec![false; pts.len()];
                let mut hard_gap = vec![false; pts.len()];
                let mut med_slopes = vec![5.0f32; pts.len()];
                let mut conv16s = vec![0.0f32; pts.len()];

                for (i, &[x, y]) in pts.iter().enumerate() {
                    let d = dist_at(x, y);
                    let local_slp = dem.sample_slope(x, y).unwrap_or(5.0);
                    let med_slp = dem.sample_mean_slope_16m(x, y).unwrap_or(local_slp);
                    let flat_slp = dem.sample_mean_slope(x, y).unwrap_or(med_slp);
                    let conv16 = dem.sample_convex_16m(x, y).unwrap_or(0.0);
                    let conv60 = dem.sample_convex(x, y).unwrap_or(0.0);
                    med_slopes[i] = med_slp;
                    conv16s[i] = conv16;

                    // 1. Suppress wandering ghost formlines on flat ground (0-2.5°), including flat park lawns
                    // immediately adjacent to steep hills (detected cleanly via `med_slp` and `local_slp`).
                    let eff_flat = flat_slp.min(med_slp);
                    let flat_local_floor = if sprint { min_slope * 0.88 } else { min_slope * 0.84 };
                    if eff_flat < min_slope || local_slp < flat_local_floor {
                        if !(conv16 >= flat_mound_c16 && local_slp >= 2.1) {
                            drop[i] = true;
                            continue;
                        }
                    }

                    // 2. Ridge / nose / spur detection across readable hilly slopes.
                    let is_ridge_nose = config.formline_mode != FormlineMode::Sparse
                        && local_slp >= 2.2
                        && local_slp <= max_slope + 3.5
                        && (conv16 >= nose_c16 || conv60 >= nose_c60);
                    let eff_gap = if is_ridge_nose { boost_open_gap } else { min_gap };
                    let hard_min = (eff_gap * 0.74).max(hard_clearance_floor);

                    if d < hard_min {
                        drop[i] = true;
                        hard_gap[i] = true;
                        continue;
                    }

                    // 3. Steep slopes (> max_slope or close to main contour): keep ONLY distinct shelves & strong noses.
                    if local_slp > max_slope || d < eff_gap {
                        if allow_steep_shelf && local_slp <= steep_cap && d >= hard_min {
                            let form = form_between_contours(dem, x, y, iv, config.level_offset);
                            let req_steep_c16 = (if sprint { 0.18 } else { 0.24 }) * form_scale.max(0.6);
                            let req_steep_form = (0.34 * f64::from(form_scale.max(0.6))).min(0.55);
                            let strong_nose = is_ridge_nose && conv16 >= req_steep_c16 && form >= 0.08;
                            if form < req_steep_form && !strong_nose {
                                drop[i] = true;
                            }
                        } else {
                            drop[i] = true;
                        }
                        continue;
                    }

                    // 4. Slope-progressive form selectivity above `selective_slope` (10.5° forest, 6.2° sprint):
                    // drop smooth uniform walls where 101 contours already define the slope,
                    // while keeping ridges, noses, spurs, gullies/saddles, and distinct benches/shelves!
                    if form_scale > 0.0 && local_slp > selective_slope {
                        let t = ((local_slp - selective_slope) / (max_slope - selective_slope).max(3.0)).clamp(0.0, 1.0);
                        let req_c16 = ((if sprint { 0.09 } else { 0.11 }) + (if sprint { 0.14 } else { 0.17 }) * t) * form_scale;
                        let req_c60 = ((if sprint { 0.30 } else { 0.42 }) + (if sprint { 0.38 } else { 0.45 }) * t) * form_scale;
                        let has_convex = conv16 >= req_c16 || conv60 >= req_c60;
                        if !has_convex {
                            let form = form_between_contours(dem, x, y, iv, config.level_offset);
                            let req_form = ((if sprint { 0.22 } else { 0.16 }) + (if sprint { 0.22 } else { 0.24 }) * f64::from(t))
                                * f64::from(form_scale);
                            if form < req_form {
                                drop[i] = true;
                                continue;
                            }
                        }
                    }

                    // 5. Gentle/moderate slope form selectivity for concave footslopes & generalized profiles.
                    if config.formline_mode != FormlineMode::Dense && !is_ridge_nose {
                        if conv60 < min_convex {
                            let form = form_between_contours(dem, x, y, iv, config.level_offset);
                            if form < min_form {
                                drop[i] = true;
                            }
                        }
                    }
                }
                (drop, hard_gap, med_slopes, conv16s)
            };

            for ch in chains {
                if ch.closed {
                    let area = signed_area(&ch.points).abs();
                    if area < boost_loop_area_m2 {
                        continue;
                    }
                    let is_dep = is_depression_ring(&ch.points, elev, dem);
                    let raw_prom = if area <= max_intact_ring_area {
                        closed_loop_raw_prominence(&ch.points, elev, is_dep, dem)
                    } else {
                        boost_min_prominence + 1.0
                    };
                    let verified_hill = raw_prom >= boost_min_prominence;

                    if area < config.formline_min_loop_area_m2 && !verified_hill {
                        continue;
                    }

                    // Small/medium closed hilltops & depressions: try intact closed ring first!
                    if area <= max_intact_ring_area {
                        let mut mean_slp = 0.0f64;
                        let mut med_slp_sum = 0.0f64;
                        let mut local_slp_sum = 0.0f64;
                        let mut min_d = f32::INFINITY;
                        let mut dists: Vec<f32> = Vec::with_capacity(ch.points.len());
                        let mut n_ok = 0usize;
                        for &[x, y] in &ch.points {
                            if let Some(s) = dem.sample_mean_slope(x, y) {
                                mean_slp += f64::from(s);
                                n_ok += 1;
                            }
                            if let Some(ms) = dem.sample_mean_slope_16m(x, y) {
                                med_slp_sum += f64::from(ms);
                            }
                            if let Some(ls) = dem.sample_slope(x, y) {
                                local_slp_sum += f64::from(ls);
                            }
                            let dv = dist_at(x, y);
                            min_d = min_d.min(dv);
                            dists.push(dv);
                        }
                        let avg_slp = if n_ok > 0 { (mean_slp / n_ok as f64) as f32 } else { 5.0 };
                        let avg_med = if n_ok > 0 { (med_slp_sum / n_ok as f64) as f32 } else { avg_slp };
                        let avg_local = if n_ok > 0 { (local_slp_sum / n_ok as f64) as f32 } else { 5.0 };
                        let cx = ch.points.iter().map(|p| p[0]).sum::<f64>() / ch.points.len() as f64;
                        let cy = ch.points.iter().map(|p| p[1]).sum::<f64>() / ch.points.len() as f64;
                        let cen_med = dem.sample_mean_slope_16m(cx, cy).unwrap_or(avg_med);
                        dists.sort_by(|a, b| a.total_cmp(b));
                        let med_d = dists[dists.len() / 2];

                        // Keep flat ground (< 2.6°) free of ghost 103 rings: only allow genuinely prominent hills/pits.
                        if avg_med.min(cen_med) < 2.6 || avg_slp < 2.5 {
                            let flat_prom_req = if is_dep {
                                if sprint { 0.65 } else { 0.85 }
                            } else if sprint {
                                0.82
                            } else {
                                0.95
                            };
                            if raw_prom < flat_prom_req || area < config.formline_min_loop_area_m2 {
                                continue;
                            }
                        } else {
                            let loop_min_slope = if is_dep || verified_hill { 1.0 } else { min_slope * 0.70 };
                            if avg_slp.min(avg_med) < loop_min_slope {
                                continue;
                            }
                        }

                        let hard_loop_gap = if verified_hill {
                            (config.min_clearance_m as f32 * 0.80).max(if sprint { 0.78 } else { 1.45 })
                        } else {
                            (config.min_clearance_m as f32 * 0.90).max(if sprint { 0.95 } else { 1.75 })
                        };
                        let loop_med_gap = if config.formline_mode == FormlineMode::Dense {
                            hard_loop_gap
                        } else if verified_hill {
                            (min_gap * 0.44).max(hard_loop_gap + 0.25)
                        } else {
                            (min_gap * 0.65).max(hard_loop_gap + 0.6)
                        };
                        if avg_local <= max_slope + 6.0 && min_d >= hard_loop_gap && med_d >= loop_med_gap {
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
                        // If a medium hilltop/bench only failed on one steep side, let the cyclic cutter keep
                        // the readable side rather than deleting the entire hill!
                        if polyline_length(&ch.points, true) < min_len * 1.5 {
                            continue;
                        }
                    }

                    // Large closed half-contour rings (or partially pinched medium rings):
                    // evaluate per-point cyclically so steep cliffs & flat meadows are cleanly cut out
                    // while all readable noses, ridges, saddles, and benches survive!
                    let smoothed = smooth_and_simplify_safe(
                        &ch.points,
                        true,
                        dem,
                        elev,
                        max_rise,
                        config.simplify_m * 0.7,
                        taubin_passes,
                    );
                    let samples = resample(&smoothed, true, sample_step);
                    let m = samples.len().saturating_sub(1);
                    if m < 4 {
                        continue;
                    }
                    let ring_pts = &samples[..m];
                    let total_len = polyline_length(&samples, false);
                    let step = total_len / m as f64;
                    let (drop, hard_gap, med_slopes, conv16s) = eval_samples(ring_pts);

                    let Some(keep_anchor) = drop.iter().position(|&d| !d) else {
                        continue; // Entire ring dropped.
                    };
                    let mut cut = vec![false; m];
                    let mut off = 0usize;
                    while off < m {
                        let idx = (keep_anchor + off) % m;
                        if !drop[idx] {
                            off += 1;
                            continue;
                        }
                        let run_start = off;
                        let mut hard_viol = hard_gap[idx];
                        while off + 1 < m && drop[(keep_anchor + off + 1) % m] {
                            off += 1;
                            if hard_gap[(keep_anchor + off) % m] {
                                hard_viol = true;
                            }
                        }
                        if ((off - run_start + 1) as f64) * step >= min_cut_len || hard_viol {
                            for k in run_start..=off {
                                cut[(keep_anchor + k) % m] = true;
                            }
                        }
                        off += 1;
                    }

                    if let Some(cut_anchor) = cut.iter().position(|&c| c) {
                        let mut pos = 0usize;
                        while pos < m {
                            if cut[(cut_anchor + pos) % m] {
                                pos += 1;
                                continue;
                            }
                            let run_start = pos;
                            while pos + 1 < m && !cut[(cut_anchor + pos + 1) % m] {
                                pos += 1;
                            }
                            let cnt = pos - run_start + 1;
                            let piece_len = ((cnt - 1) as f64) * step;
                            if piece_len >= min_len && cnt >= 2 {
                                let mut slp_sum = 0.0f32;
                                let mut max_c16 = f32::NEG_INFINITY;
                                let mut raw_piece = Vec::with_capacity(cnt);
                                for k in run_start..=pos {
                                    let idx = (cut_anchor + k) % m;
                                    slp_sum += med_slopes[idx];
                                    max_c16 = max_c16.max(conv16s[idx]);
                                    raw_piece.push(ring_pts[idx]);
                                }
                                if (slp_sum / cnt as f32) >= min_slope * 0.92 || max_c16 >= flat_mound_c16 {
                                    let piece = rdp_simplify(&raw_piece, false, config.simplify_m);
                                    if piece.len() >= 2 && !has_self_intersection(&piece, false) {
                                        out.push(ContourLine {
                                            layer: ContourLayer::Formline,
                                            elevation: elev,
                                            closed: false,
                                            points: piece,
                                        });
                                    }
                                }
                            }
                            pos += 1;
                        }
                    } else {
                        // Entire ring passed per-point filter cleanly -> verify not a flat ghost ring, then keep intact!
                        let avg_med_slp = med_slopes.iter().sum::<f32>() / m as f32;
                        let max_c16 = conv16s.iter().copied().fold(f32::NEG_INFINITY, f32::max);
                        let cx = ch.points.iter().map(|p| p[0]).sum::<f64>() / ch.points.len() as f64;
                        let cy = ch.points.iter().map(|p| p[1]).sum::<f64>() / ch.points.len() as f64;
                        let cen_med = dem.sample_mean_slope_16m(cx, cy).unwrap_or(avg_med_slp);
                        let flat_ok = if avg_med_slp.min(cen_med) < 2.6 && area <= 5000.0 {
                            closed_loop_raw_prominence(&ch.points, elev, is_dep, dem)
                                >= if sprint { 0.72 } else { 0.95 }
                        } else {
                            avg_med_slp >= min_slope || max_c16 >= flat_mound_c16
                        };
                        if flat_ok {
                            let simp = rdp_simplify(&smoothed, true, config.simplify_m);
                            if simp.len() >= 3 && !has_self_intersection(&simp, true) {
                                out.push(ContourLine {
                                    layer: ContourLayer::Formline,
                                    elevation: elev,
                                    closed: true,
                                    points: simp,
                                });
                            }
                        }
                    }
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
                let (drop, hard_gap, med_slopes, conv16s) = eval_samples(&samples);

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

                // Collect surviving pieces >= min_len, rejecting stray flat-ground slivers.
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
                        let cnt = (j - i + 1) as f32;
                        let avg_med_slp = med_slopes[i..=j].iter().sum::<f32>() / cnt;
                        let max_c16 = conv16s[i..=j].iter().copied().fold(f32::NEG_INFINITY, f32::max);
                        if avg_med_slp < min_slope * 0.92 && max_c16 < flat_mound_c16 {
                            i = j + 1;
                            continue;
                        }
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
