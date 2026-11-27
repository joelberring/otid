//! Small-hill (`dotknoll` 109, `dotknoll_avlang` 110) and small-pit (`udepression` 111)
//! detection on `raw_z`, with connected-component footprint analysis, 2D inertia-tensor
//! elongation/orientation, marsh/wetland noise protection, and closed-loop suppression.

use crate::dem::PreparedDem;
use crate::formlines::build_line_distance_grid;
use crate::geometry::{point_in_ring, signed_area};
use crate::types::{ContourLine, EngineConfig, KnollKind, KnollPoint};

const MARSH_MIN_RISE_M: f64 = 1.5;
const ELONGATED_ASPECT_MIN: f64 = 1.65;

struct FootShape {
    area_m2: f64,
    aspect: f64,
    angle_deg: f64,
}

/// Runs a bounded 4-connected BFS around `(r0, c0)` within `max_rad` cells on `raw_z`
/// above `half_z` (for hills) or below `half_z` (for pits), returning footprint area
/// and 2D inertia-tensor aspect ratio & major-axis angle (degrees CCW from East `+X`, `[0, 180)`).
fn analyze_foot_shape(
    dem: &PreparedDem,
    r0: usize,
    c0: usize,
    half_z: f32,
    is_pit: bool,
    max_rad: isize,
) -> FootShape {
    let (w, h, cell) = (dem.width, dem.height, dem.world.cell);
    let span = (2 * max_rad + 1) as usize;
    let mut visited = vec![0u8; span * span];
    let mut queue: Vec<(isize, isize)> = Vec::with_capacity(128);
    let mut cells: Vec<(f64, f64)> = Vec::with_capacity(128);

    let r0i = r0 as isize;
    let c0i = c0 as isize;
    let center_idx = (max_rad as usize) * span + (max_rad as usize);
    visited[center_idx] = 1;
    queue.push((0, 0));

    let max_r2 = max_rad * max_rad;
    let mut head = 0usize;
    let mut sum_x = 0.0f64;
    let mut sum_y = 0.0f64;

    while head < queue.len() {
        let (dr, dc) = queue[head];
        head += 1;
        // World +X is +dc, world +Y (North) is -dr.
        let dx = dc as f64 * cell;
        let dy = -(dr as f64) * cell;
        cells.push((dx, dy));
        sum_x += dx;
        sum_y += dy;

        for (ndr, ndc) in [(dr - 1, dc), (dr + 1, dc), (dr, dc - 1), (dr, dc + 1)] {
            if ndr.abs() > max_rad || ndc.abs() > max_rad || ndr * ndr + ndc * ndc > max_r2 {
                continue;
            }
            let nr = r0i + ndr;
            let nc = c0i + ndc;
            if nr < 0 || nc < 0 || (nr as usize) >= h || (nc as usize) >= w {
                continue;
            }
            let li = ((ndr + max_rad) as usize) * span + ((ndc + max_rad) as usize);
            if visited[li] != 0 {
                continue;
            }
            let z = dem.raw_z[(nr as usize) * w + (nc as usize)];
            let inside = if is_pit { z < half_z } else { z > half_z };
            if inside {
                visited[li] = 1;
                queue.push((ndr, ndc));
            }
        }
    }

    let n = cells.len();
    let area_m2 = (n as f64) * cell * cell;
    if n < 5 {
        return FootShape { area_m2, aspect: 1.0, angle_deg: 0.0 };
    }
    let mx = sum_x / n as f64;
    let my = sum_y / n as f64;
    let mut cxx = 0.0f64;
    let mut cyy = 0.0f64;
    let mut cxy = 0.0f64;
    for &(dx, dy) in &cells {
        let ux = dx - mx;
        let uy = dy - my;
        cxx += ux * ux;
        cyy += uy * uy;
        cxy += ux * uy;
    }
    cxx /= n as f64;
    cyy /= n as f64;
    cxy /= n as f64;
    let tr = cxx + cyy;
    let disc = (cxx - cyy).hypot(2.0 * cxy);
    let l1 = (0.5 * (tr + disc)).max(1e-6);
    let l2 = (0.5 * (tr - disc)).max(1e-6);
    let aspect = (l1 / l2).sqrt();
    let angle_deg = (0.5 * (2.0 * cxy).atan2(cxx - cyy)).to_degrees().rem_euclid(180.0);

    FootShape { area_m2, aspect, angle_deg }
}

/// Classifies a verified hill at `(r0, c0)` into Round (`109`) or Elongated (`110`) with angle.
fn classify_hill_kind(shape: &FootShape) -> (KnollKind, Option<f64>) {
    if shape.aspect >= ELONGATED_ASPECT_MIN && shape.area_m2 >= 18.0 {
        (KnollKind::Elongated, Some(shape.angle_deg))
    } else {
        (KnollKind::Round, None)
    }
}

/// Checks if a dropped tiny closed contour represents a genuine small knoll (`109`/`110`) or pit (`111`).
pub fn promote_small_loop_to_knoll(
    pts: &[[f64; 2]],
    level: f64,
    is_dep: bool,
    dem: &PreparedDem,
    config: &EngineConfig,
) -> Option<KnollPoint> {
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for &[x, y] in pts {
        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);
    }
    let cx = 0.5 * (min_x + max_x);
    let cy = 0.5 * (min_y + max_y);
    let zc = f64::from(dem.sample_raw(cx, cy)?);
    let prominence = if is_dep { level - zc } else { zc - level };
    if prominence < 0.30 {
        return None;
    }

    let sprint = config.interval <= 3.0;
    let ring_r = if sprint { 5.5 } else { 7.0 };
    let mut ring = Vec::with_capacity(16);
    for k in 0..16 {
        let ang = k as f64 * std::f64::consts::TAU / 16.0;
        if let Some(zr) = dem.sample_raw(cx + ring_r * ang.cos(), cy + ring_r * ang.sin()) {
            ring.push(f64::from(zr));
        }
    }
    if ring.len() < 10 {
        return None;
    }
    ring.sort_by(|a, b| a.total_cmp(b));
    let med = ring[ring.len() / 2];
    let rel = if is_dep { med - zc } else { zc - med };

    let wet = dem.is_wet(cx, cy);
    if is_dep {
        if wet || rel < 0.70 {
            return None;
        }
        let share = ring
            .iter()
            .filter(|&&zr| zr > zc + (rel * 0.25).max(0.12))
            .count() as f64
            / ring.len() as f64;
        if share >= 0.78 {
            return Some(KnollPoint { kind: KnollKind::Pit, x: cx, y: cy, z: zc, angle_deg: None });
        }
        return None;
    }

    let min_rel = if wet { MARSH_MIN_RISE_M } else { config.knoll_min_rise_m.min(0.85) };
    let share = ring
        .iter()
        .filter(|&&zr| zr < zc - (rel * 0.25).max(0.12))
        .count() as f64
        / ring.len() as f64;
    if rel < min_rel || share < config.knoll_lower_share.min(0.75) {
        return None;
    }

    let c0 = dem.world.x_to_col_f(cx).round().clamp(0.0, (dem.width - 1) as f64) as usize;
    let r0 = dem.world.y_to_row_f(cy).round().clamp(0.0, (dem.height - 1) as f64) as usize;
    let half_z = (med + rel * 0.5) as f32;
    let max_rad = (8.0 / dem.world.cell).round().max(4.0) as isize;
    let shape = analyze_foot_shape(dem, r0, c0, half_z, false, max_rad);
    let (kind, angle_deg) = classify_hill_kind(&shape);
    Some(KnollPoint { kind, x: cx, y: cy, z: zc, angle_deg })
}

struct ClosedLoopRef<'a> {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    points: &'a [[f64; 2]],
}

fn collect_enclosing_loops<'a>(
    contours: &'a [ContourLine],
    formlines: &'a [ContourLine],
    max_area_m2: f64,
) -> Vec<ClosedLoopRef<'a>> {
    contours
        .iter()
        .chain(formlines.iter())
        .filter(|l| l.closed && l.points.len() >= 3 && signed_area(&l.points).abs() <= max_area_m2)
        .map(|l| {
            let (mut min_x, mut max_x) = (f64::INFINITY, f64::NEG_INFINITY);
            let (mut min_y, mut max_y) = (f64::INFINITY, f64::NEG_INFINITY);
            for &[x, y] in &l.points {
                min_x = min_x.min(x);
                max_x = max_x.max(x);
                min_y = min_y.min(y);
                max_y = max_y.max(y);
            }
            ClosedLoopRef { min_x, max_x, min_y, max_y, points: &l.points }
        })
        .collect()
}

fn is_enclosed(x: f64, y: f64, loops: &[ClosedLoopRef<'_>]) -> bool {
    loops.iter().any(|lp| {
        x >= lp.min_x && x <= lp.max_x && y >= lp.min_y && y <= lp.max_y && point_in_ring([x, y], lp.points)
    })
}

/// Detects sub-interval knolls (`109` round, `110` elongated) and small pits (`111`) directly
/// on `raw_z` not already represented by a closed `101`/`102`/`103` loop, and merges them
/// with promoted tiny-contour knolls.
pub fn detect_knolls_and_pits(
    dem: &PreparedDem,
    contours: &[ContourLine],
    formlines: &[ContourLine],
    promoted: &[KnollPoint],
    config: &EngineConfig,
) -> Vec<KnollPoint> {
    let (w, h, cell) = (dem.width, dem.height, dem.world.cell);
    let sprint = config.interval <= 3.0;
    let r_top = ((if sprint { 2.0 } else { 3.0 }) / cell).round().max(1.0) as isize;
    let ring_r = if sprint { 5.5 } else { 7.0 };
    let pit_ring_r = if sprint { 4.5 } else { 6.0 };
    let max_rad = (7.0 / cell).round().max(5.0) as isize;
    let margin = (ring_r / cell).ceil() as usize + 2;
    if w <= 2 * margin || h <= 2 * margin {
        return promoted.to_vec();
    }

    let enclose_max = if sprint { 220.0 } else { 550.0 };
    let loops = collect_enclosing_loops(contours, formlines, enclose_max);
    // Distance grid to all drawn 101/102 contours so knolls never sit directly on top of a contour line.
    let dist_contour = build_line_distance_grid(dem, contours);
    let contour_touch_m = if sprint { 1.1f32 } else { 2.2f32 };
    let min_foot_m2 = if sprint { 8.0 } else { 15.0 };
    let max_foot_m2 = config.knoll_max_foot_m2;
    let min_rise = config.knoll_min_rise_m;
    let min_share = config.knoll_lower_share;
    let pit_min_depth = if sprint { 0.50 } else { 0.68 };
    let pit_max_foot = if sprint { 45.0 } else { 85.0 };

    let mut hill_cands: Vec<(f64, KnollPoint)> = promoted
        .iter()
        .filter(|k| !k.is_depression() && !is_enclosed(k.x, k.y, &loops))
        .map(|&k| (10.0 + k.z * 1e-4, k))
        .collect();
    let mut pit_cands: Vec<(f64, KnollPoint)> = promoted
        .iter()
        .filter(|k| k.is_depression() && !is_enclosed(k.x, k.y, &loops))
        .map(|&k| (10.0 - k.z * 1e-4, k))
        .collect();

    for r in margin..(h - margin) {
        for c in margin..(w - margin) {
            let idx = r * w + c;
            if dem.drawable[idx] == 0 {
                continue;
            }
            let here = dem.raw_z[idx];
            if !here.is_finite() {
                continue;
            }

            // Single neighborhood scan simultaneously tests local maximum (hill) and local minimum (pit).
            let mut is_max = true;
            let mut is_min = true;
            'nbr: for dr in -r_top..=r_top {
                let nr = (r as isize + dr) as usize;
                let base = nr * w;
                for dc in -r_top..=r_top {
                    if dr == 0 && dc == 0 {
                        continue;
                    }
                    let nc = (c as isize + dc) as usize;
                    let v = dem.raw_z[base + nc];
                    let tie = dr > 0 || (dr == 0 && dc > 0);
                    if v > here || (v == here && tie) {
                        is_max = false;
                    }
                    if v < here || (v == here && tie) {
                        is_min = false;
                    }
                    if !is_max && !is_min {
                        break 'nbr;
                    }
                }
            }

            if is_max {
                let x = dem.world.col_to_x(c as f64);
                let y = dem.world.row_to_y(r as f64);
                let mut ring = [0.0f32; 16];
                let mut n_ok = 0usize;
                for k in 0..16 {
                    let ang = k as f64 * std::f64::consts::TAU / 16.0;
                    if let Some(zr) = dem.sample_raw(x + ring_r * ang.cos(), y + ring_r * ang.sin()) {
                        ring[n_ok] = zr;
                        n_ok += 1;
                    }
                }
                if n_ok >= 12 {
                    let ring_s = &mut ring[..n_ok];
                    ring_s.sort_by(|a, b| a.total_cmp(b));
                    let med = ring_s[n_ok / 2];
                    let rise = f64::from(here - med);
                    let wet = dem.wet[idx] != 0;
                    let req_rise = if wet { MARSH_MIN_RISE_M.max(min_rise) } else { min_rise };
                    if rise >= req_rise {
                        let drop_tol = (rise * 0.25).max(0.15) as f32;
                        let lower = ring_s.iter().filter(|&&zr| zr <= here - drop_tol).count() as f64 / n_ok as f64;
                        if lower >= min_share {
                            let half_z = med + (here - med) * 0.5;
                            let shape = analyze_foot_shape(dem, r, c, half_z, false, max_rad);
                            if shape.area_m2 >= min_foot_m2 && shape.area_m2 <= max_foot_m2 {
                                // Reject sharp steep-sided boulders (tiny foot + >= 72% drop within 2 m).
                                let mut is_boulder = false;
                                if shape.area_m2 <= 20.0 {
                                    let mut near = [0.0f32; 8];
                                    let mut nn = 0usize;
                                    for k in 0..8 {
                                        let ang = k as f64 * std::f64::consts::TAU / 8.0;
                                        if let Some(zn) = dem.sample_raw(x + 2.0 * ang.cos(), y + 2.0 * ang.sin()) {
                                            near[nn] = zn;
                                            nn += 1;
                                        }
                                    }
                                    if nn >= 6 {
                                        let ns = &mut near[..nn];
                                        ns.sort_by(|a, b| a.total_cmp(b));
                                        if f64::from(here - ns[nn / 2]) >= 0.72 * rise {
                                            is_boulder = true;
                                        }
                                    }
                                }
                                if !is_boulder
                                    && dist_contour[idx] >= contour_touch_m
                                    && !is_enclosed(x, y, &loops)
                                {
                                    let (kind, angle_deg) = classify_hill_kind(&shape);
                                    hill_cands.push((
                                        rise,
                                        KnollPoint { kind, x, y, z: f64::from(here), angle_deg },
                                    ));
                                }
                            }
                        }
                    }
                }
            } else if is_min && dem.wet[idx] == 0 && dem.slope_deg[idx] < 12.0 {
                let x = dem.world.col_to_x(c as f64);
                let y = dem.world.row_to_y(r as f64);
                let mut ring = [0.0f32; 16];
                let mut n_ok = 0usize;
                for k in 0..16 {
                    let ang = k as f64 * std::f64::consts::TAU / 16.0;
                    if let Some(zr) = dem.sample_raw(x + pit_ring_r * ang.cos(), y + pit_ring_r * ang.sin()) {
                        ring[n_ok] = zr;
                        n_ok += 1;
                    }
                }
                if n_ok >= 14 {
                    let ring_s = &mut ring[..n_ok];
                    ring_s.sort_by(|a, b| a.total_cmp(b));
                    let med = ring_s[n_ok / 2];
                    let rim_min = ring_s[0];
                    let depth = f64::from(med - here);
                    // Require a true closed depression rim (not an open gully or concave slope):
                    // lowest rim point still above bottom, and >= 93% of ring clearly higher.
                    if depth >= pit_min_depth && f64::from(rim_min - here) >= 0.12 {
                        let rise_tol = (depth * 0.25).max(0.14) as f32;
                        let higher = ring_s.iter().filter(|&&zr| zr >= here + rise_tol).count() as f64 / n_ok as f64;
                        if higher >= 0.93 {
                            let half_z = med - (med - here) * 0.5;
                            let shape = analyze_foot_shape(dem, r, c, half_z, true, max_rad);
                            if shape.area_m2 >= 6.0
                                && shape.area_m2 <= pit_max_foot
                                && dist_contour[idx] >= contour_touch_m
                                && !is_enclosed(x, y, &loops)
                            {
                                pit_cands.push((
                                    depth,
                                    KnollPoint { kind: KnollKind::Pit, x, y, z: f64::from(here), angle_deg: None },
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    let spacing = config.knoll_spacing_m;
    let mut out = deduplicate_ranked(hill_cands, spacing);
    out.extend(deduplicate_ranked(pit_cands, spacing));
    out
}

fn deduplicate_ranked(mut cands: Vec<(f64, KnollPoint)>, spacing_m: f64) -> Vec<KnollPoint> {
    cands.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut kept: Vec<KnollPoint> = Vec::new();
    for (_, k) in cands {
        if !kept.iter().any(|o| (o.x - k.x).hypot(o.y - k.y) < spacing_m) {
            kept.push(k);
        }
    }
    kept
}
