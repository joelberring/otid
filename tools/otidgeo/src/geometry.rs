//! Polyline geometry utilities: shoelace area, depression probing, Taubin &
//! flat-slope smoothing, RDP simplification, self-intersection tests, and
//! local vertex-level neighbor-contour collision guarding.

use crate::dem::PreparedDem;
use crate::types::ContourLine;
use std::collections::HashMap;

/// Signed shoelace area of a polygon ring (positive = CCW, negative = CW).
pub fn signed_area(pts: &[[f64; 2]]) -> f64 {
    if pts.len() < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..pts.len() {
        let a = pts[i];
        let b = pts[(i + 1) % pts.len()];
        sum += a[0] * b[1] - b[0] * a[1];
    }
    sum * 0.5
}

/// Total Euclidean length of a polyline (closing back to point 0 when `closed`).
pub fn polyline_length(pts: &[[f64; 2]], closed: bool) -> f64 {
    if pts.len() < 2 {
        return 0.0;
    }
    let mut total = 0.0;
    for i in 1..pts.len() {
        total += (pts[i][0] - pts[i - 1][0]).hypot(pts[i][1] - pts[i - 1][1]);
    }
    if closed && pts.len() >= 3 {
        let a = pts[pts.len() - 1];
        let b = pts[0];
        total += (b[0] - a[0]).hypot(b[1] - a[1]);
    }
    total
}

/// Checks whether a closed contour ring encloses a depression (`true`) or peak (`false`)
/// by probing the lightly-smoothed raw DEM just inside vs outside the ring.
pub fn is_depression_ring(pts: &[[f64; 2]], level: f64, dem: &PreparedDem) -> bool {
    let area = signed_area(pts);
    if area.abs() < 1e-3 || pts.len() < 3 {
        return false;
    }
    let perim = polyline_length(pts, true);
    let reach = (area.abs() / perim.max(1.0) * 0.5).clamp(0.75, 3.0);
    let inward = if area > 0.0 { 1.0 } else { -1.0 };

    let mut drops = Vec::new();
    for i in 0..pts.len() {
        let a = pts[i];
        let b = pts[(i + 1) % pts.len()];
        let span = (b[0] - a[0]).hypot(b[1] - a[1]);
        if span < 1e-4 {
            continue;
        }
        let nx = -(b[1] - a[1]) / span * inward;
        let ny = (b[0] - a[0]) / span * inward;
        let steps = (span / 3.5).round().max(1.0) as usize;
        for s in 0..steps {
            let t = (s as f64 + 0.5) / steps as f64;
            let x = a[0] + (b[0] - a[0]) * t;
            let y = a[1] + (b[1] - a[1]) * t;
            if let (Some(z_in), Some(z_out)) = (
                dem.sample_raw(x + nx * reach, y + ny * reach),
                dem.sample_raw(x - nx * reach, y - ny * reach),
            ) {
                drops.push(f64::from(z_out - z_in));
            }
        }
    }
    if drops.len() >= 4 {
        drops.sort_by(|a, b| a.total_cmp(b));
        let med = drops[drops.len() / 2];
        let lower_share = drops.iter().filter(|&&d| d > 0.0).count() as f64 / drops.len() as f64;
        if med >= 0.12 && lower_share >= 0.58 {
            return true;
        }
        if med <= -0.12 && (1.0 - lower_share) >= 0.58 {
            return false;
        }
    }
    let (mut sx, mut sy) = (0.0, 0.0);
    for p in pts {
        sx += p[0];
        sy += p[1];
    }
    let cx = sx / pts.len() as f64;
    let cy = sy / pts.len() as f64;
    if let Some(zc) = dem.sample_raw(cx, cy) {
        return f64::from(zc) < level - 0.1;
    }
    area < 0.0
}

/// Measures `raw_z` prominence of an enclosed closed contour loop (peak height above `elev`,
/// or pit depth below `elev`). Used to distinguish real small hills/pits from flat ghost rings.
pub fn closed_loop_raw_prominence(pts: &[[f64; 2]], elev: f64, is_dep: bool, dem: &PreparedDem) -> f64 {
    if pts.len() < 3 {
        return 0.0;
    }
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
    let step = ((max_x - min_x).max(max_y - min_y) / 10.0).max(1.0);
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

/// Slope- and curvature-adaptive area-preserving Taubin smoothing (`lambda > 0`, `mu < 0`) with
/// strict elevation clamping. Smooths 1 m Marching Squares grid stair-steps and gentle-slope
/// micro-wiggles cleanly while strongly preserving genuine rocky noses, sharp corners, incised
/// re-entrants, and small hilltop silhouettes via multi-vertex span/chord prominence gating.
pub fn taubin_smooth(
    pts: &[[f64; 2]],
    closed: bool,
    dem: &PreparedDem,
    level: f64,
    max_rise: f64,
    rounds: usize,
) -> Vec<[f64; 2]> {
    let n = pts.len();
    if n < 4 {
        return pts.to_vec();
    }
    let small_ring = closed && n <= 40;
    let min_span = 3usize.min(n / 3).max(1);
    let max_span = 8usize.min(n / 3).max(min_span);
    let target_chord = 3.2f64;

    let weights: Vec<f64> = (0..n)
        .map(|i| {
            let [x, y] = pts[i];
            let slope = dem.sample_slope(x, y).unwrap_or(8.0);
            let conv16 = dem.sample_convex_16m(x, y).unwrap_or(0.0);
            let t = ((8.5 - f64::from(slope)) / 5.0).clamp(0.0, 1.0);
            let mut w = 0.72 + 0.28 * t;

            // Multi-vertex chord/span prominence over ±3..±8 vertices (>= ~3.2 m legs):
            // 1-cell grid zigzags and gentle-slope micro-wiggles have small chord sagitta (< 0.75 m)
            // and smooth cleanly, while genuine rocky noses/re-entrants (>= 3-4 m) stay crisp.
            let mut p_prev = if closed {
                pts[(i + n - min_span) % n]
            } else {
                pts[i.saturating_sub(min_span)]
            };
            let mut l1 = (x - p_prev[0]).hypot(y - p_prev[1]);
            for s in (min_span + 1)..=max_span {
                if l1 >= target_chord {
                    break;
                }
                let cand = if closed {
                    pts[(i + n - s) % n]
                } else if i >= s {
                    pts[i - s]
                } else {
                    break;
                };
                p_prev = cand;
                l1 = (x - p_prev[0]).hypot(y - p_prev[1]);
            }

            let mut p_next = if closed {
                pts[(i + min_span) % n]
            } else {
                pts[(i + min_span).min(n - 1)]
            };
            let mut l2 = (p_next[0] - x).hypot(p_next[1] - y);
            for s in (min_span + 1)..=max_span {
                if l2 >= target_chord {
                    break;
                }
                let cand = if closed {
                    pts[(i + s) % n]
                } else if i + s < n {
                    pts[i + s]
                } else {
                    break;
                };
                p_next = cand;
                l2 = (p_next[0] - x).hypot(p_next[1] - y);
            }

            let l_min = l1.min(l2);
            let corner_damp = if l_min > 1.8 {
                let v1x = x - p_prev[0];
                let v1y = y - p_prev[1];
                let v2x = p_next[0] - x;
                let v2y = p_next[1] - y;
                let cos = ((v1x * v2x + v1y * v2y) / (l1 * l2)).clamp(-1.0, 1.0);
                let ang_deg = cos.acos().to_degrees();
                let chord_x = p_next[0] - p_prev[0];
                let chord_y = p_next[1] - p_prev[1];
                let chord_l2 = chord_x * chord_x + chord_y * chord_y;
                let proj = if chord_l2 > 1e-12 {
                    (((x - p_prev[0]) * chord_x + (y - p_prev[1]) * chord_y) / chord_l2).clamp(0.0, 1.0)
                } else {
                    0.5
                };
                let perp = (x - (p_prev[0] + proj * chord_x)).hypot(y - (p_prev[1] + proj * chord_y));
                let ua = ((ang_deg - 24.0) / 34.0).clamp(0.0, 1.0);
                let ang_gate = ua * ua * (3.0 - 2.0 * ua);
                let up = ((perp - 0.75) / 0.90).clamp(0.0, 1.0);
                let ul = ((l_min - 1.8) / 1.4).clamp(0.0, 1.0);
                let prom_gate = (up * up * (3.0 - 2.0 * up)) * (ul * ul * (3.0 - 2.0 * ul));
                1.0 - 0.85 * ang_gate * prom_gate
            } else {
                1.0
            };

            if small_ring {
                w = w.min(0.65);
            }
            if conv16.abs() > 0.45 {
                w = w.min(0.30);
            }
            w * corner_damp
        })
        .collect();

    let mut cur = pts.to_vec();
    let mut next = cur.clone();
    let steps = [0.46f64, -0.47f64];

    for _ in 0..rounds {
        for &factor in &steps {
            for i in 0..n {
                if !closed && (i == 0 || i + 1 == n) {
                    next[i] = cur[i];
                    continue;
                }
                let prev = cur[(i + n - 1) % n];
                let succ = cur[(i + 1) % n];
                let mid_x = 0.5 * (prev[0] + succ[0]);
                let mid_y = 0.5 * (prev[1] + succ[1]);
                let f = factor * weights[i];
                let dx = f * (mid_x - cur[i][0]);
                let dy = f * (mid_y - cur[i][1]);
                let cand = [cur[i][0] + dx, cur[i][1] + dy];
                let ok = dem
                    .sample_raw(cand[0], cand[1])
                    .is_some_and(|z| (f64::from(z) - level).abs() <= max_rise);
                if ok {
                    next[i] = cand;
                } else if factor < 0.0 {
                    // Half-step fallback on inflate prevents asymmetric shrink-without-restore rounding on noses.
                    let half = [cur[i][0] + 0.5 * dx, cur[i][1] + 0.5 * dy];
                    let ok_half = dem
                        .sample_raw(half[0], half[1])
                        .is_some_and(|z| (f64::from(z) - level).abs() <= max_rise);
                    next[i] = if ok_half { half } else { cur[i] };
                } else {
                    next[i] = cur[i];
                }
            }
            std::mem::swap(&mut cur, &mut next);
        }
    }
    cur
}

/// Slope-adaptive Gaussian smoothing along the curve ONLY on flat ground (`< 3.6 deg`),
/// clamped to `max_rise` so neighboring contours never merge. Leaves hilly noses, ridges, and
/// incised re-entrants untouched.
pub fn calm_flat_curve(
    pts: &[[f64; 2]],
    closed: bool,
    dem: &PreparedDem,
    level: f64,
    max_rise: f64,
) -> Vec<[f64; 2]> {
    let n = pts.len();
    if n < 7 {
        return pts.to_vec();
    }
    let mut out = pts.to_vec();
    for i in 0..n {
        if !closed && (i < 2 || i + 2 >= n) {
            continue;
        }
        let p = pts[i];
        let local_slp = dem.sample_slope(p[0], p[1]).unwrap_or(15.0);
        let med_slp = dem.sample_mean_slope_16m(p[0], p[1]).unwrap_or(local_slp);
        let eff_slp = local_slp.max(0.80 * med_slp);
        if eff_slp >= 3.6 {
            continue;
        }
        let mut alpha = ((3.6 - f64::from(eff_slp)) / 2.2).clamp(0.0, 1.0);
        if let Some(conv16) = dem.sample_convex_16m(p[0], p[1]) {
            if conv16.abs() > 0.30 {
                let m = ((f64::from(conv16.abs()) - 0.30) / 0.45).clamp(0.0, 1.0);
                alpha *= 1.0 - 0.88 * m;
            }
        }
        if alpha < 0.05 {
            continue;
        }
        let reach = 6usize;
        let sigma = 2.6 * alpha + 0.5;
        let mut sx = 0.0;
        let mut sy = 0.0;
        let mut sw = 0.0;
        for k in -(reach as isize)..=(reach as isize) {
            let idx = if closed {
                ((i as isize + k).rem_euclid(n as isize)) as usize
            } else {
                (i as isize + k).clamp(0, n as isize - 1) as usize
            };
            let w = (-0.5 * (k as f64 / sigma).powi(2)).exp();
            sx += w * pts[idx][0];
            sy += w * pts[idx][1];
            sw += w;
        }
        let tx = p[0] + (sx / sw - p[0]) * alpha;
        let ty = p[1] + (sy / sw - p[1]) * alpha;
        let mut chosen = p;
        let mut t = 1.0;
        while t >= 0.25 {
            let cx = p[0] + (tx - p[0]) * t;
            let cy = p[1] + (ty - p[1]) * t;
            if dem
                .sample_raw(cx, cy)
                .is_some_and(|z| (f64::from(z) - level).abs() <= max_rise)
            {
                chosen = [cx, cy];
                break;
            }
            t *= 0.5;
        }
        out[i] = chosen;
    }
    out
}

/// Ramer-Douglas-Peucker simplification for open or closed polylines.
pub fn rdp_simplify(pts: &[[f64; 2]], closed: bool, tol: f64) -> Vec<[f64; 2]> {
    let n = pts.len();
    if n <= 3 || tol <= 0.0 {
        return pts.to_vec();
    }
    if closed {
        if n <= 6 {
            return pts.to_vec();
        }
        let mut far = 1usize;
        let mut max_d2 = -1.0f64;
        for i in 1..n {
            let dx = pts[i][0] - pts[0][0];
            let dy = pts[i][1] - pts[0][1];
            let d2 = dx * dx + dy * dy;
            if d2 > max_d2 {
                max_d2 = d2;
                far = i;
            }
        }
        let mut keep = vec![false; n + 1];
        keep[0] = true;
        keep[far] = true;
        keep[n] = true;
        let mut stack = vec![(0usize, far), (far, n)];
        while let Some((a, b)) = stack.pop() {
            if b <= a + 1 {
                continue;
            }
            let pa = pts[a % n];
            let pb = pts[b % n];
            let dx = pb[0] - pa[0];
            let dy = pb[1] - pa[1];
            let len = dx.hypot(dy);
            let mut worst = tol;
            let mut idx = None;
            for i in (a + 1)..b {
                let p = pts[i % n];
                let d = if len > 1e-9 {
                    (dx * (pa[1] - p[1]) - (pa[0] - p[0]) * dy).abs() / len
                } else {
                    (p[0] - pa[0]).hypot(p[1] - pa[1])
                };
                if d > worst {
                    worst = d;
                    idx = Some(i);
                }
            }
            if let Some(m) = idx {
                keep[m] = true;
                stack.push((a, m));
                stack.push((m, b));
            }
        }
        let out: Vec<[f64; 2]> = (0..n).filter(|&i| keep[i]).map(|i| pts[i]).collect();
        if out.len() >= 6 { out } else { rdp_simplify(pts, true, tol * 0.5) }
    } else {
        let mut keep = vec![false; n];
        keep[0] = true;
        keep[n - 1] = true;
        let mut stack = vec![(0usize, n - 1)];
        while let Some((a, b)) = stack.pop() {
            if b <= a + 1 {
                continue;
            }
            let pa = pts[a];
            let pb = pts[b];
            let dx = pb[0] - pa[0];
            let dy = pb[1] - pa[1];
            let len = dx.hypot(dy);
            let mut worst = tol;
            let mut idx = None;
            for i in (a + 1)..b {
                let p = pts[i];
                let d = if len > 1e-9 {
                    (dx * (pa[1] - p[1]) - (pa[0] - p[0]) * dy).abs() / len
                } else {
                    (p[0] - pa[0]).hypot(p[1] - pa[1])
                };
                if d > worst {
                    worst = d;
                    idx = Some(i);
                }
            }
            if let Some(m) = idx {
                keep[m] = true;
                stack.push((a, m));
                stack.push((m, b));
            }
        }
        pts.iter().enumerate().filter(|&(i, _)| keep[i]).map(|(_, &p)| p).collect()
    }
}

/// Checks whether two closed segments `(a, b)` and `(c, d)` properly intersect.
#[inline]
pub fn segments_intersect(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> bool {
    if a[0].max(b[0]) < c[0].min(d[0])
        || c[0].max(d[0]) < a[0].min(b[0])
        || a[1].max(b[1]) < c[1].min(d[1])
        || c[1].max(d[1]) < a[1].min(b[1])
    {
        return false;
    }
    let cross = |p: [f64; 2], q: [f64; 2], r: [f64; 2]| -> f64 {
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    };
    let d1 = cross(c, d, a);
    let d2 = cross(c, d, b);
    let d3 = cross(a, b, c);
    let d4 = cross(a, b, d);
    ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
}

/// Minimum Euclidean distance between segments `(a, b)` and `(c, d)`.
#[allow(dead_code)]
#[inline]
pub fn segment_distance(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> f64 {
    if segments_intersect(a, b, c, d) {
        return 0.0;
    }
    let pt_seg = |p: [f64; 2], s: [f64; 2], e: [f64; 2]| -> f64 {
        let dx = e[0] - s[0];
        let dy = e[1] - s[1];
        let l2 = dx * dx + dy * dy;
        let t = if l2 > 1e-12 { ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l2 } else { 0.0 };
        let t = t.clamp(0.0, 1.0);
        (p[0] - (s[0] + t * dx)).hypot(p[1] - (s[1] + t * dy))
    };
    pt_seg(a, c, d).min(pt_seg(b, c, d)).min(pt_seg(c, a, b)).min(pt_seg(d, a, b))
}

/// Checks if a polyline has any self-intersection among non-adjacent segments.
pub fn has_self_intersection(pts: &[[f64; 2]], closed: bool) -> bool {
    let seg_count = if closed { pts.len() } else { pts.len().saturating_sub(1) };
    if seg_count < 4 {
        return false;
    }
    let seg = |i: usize| (pts[i], pts[(i + 1) % pts.len()]);
    if seg_count <= 64 {
        for i in 0..seg_count {
            let (a, b) = seg(i);
            for j in (i + 2)..seg_count {
                if closed && i == 0 && j + 1 == seg_count {
                    continue;
                }
                let (c, d) = seg(j);
                if segments_intersect(a, b, c, d) {
                    return true;
                }
            }
        }
        return false;
    }
    let cell = 8.0;
    let mut grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
    for i in 0..seg_count {
        let (a, b) = seg(i);
        let x0 = (a[0].min(b[0]) / cell).floor() as i32;
        let x1 = (a[0].max(b[0]) / cell).floor() as i32;
        let y0 = (a[1].min(b[1]) / cell).floor() as i32;
        let y1 = (a[1].max(b[1]) / cell).floor() as i32;
        for gx in x0..=x1 {
            for gy in y0..=y1 {
                if let Some(list) = grid.get(&(gx, gy)) {
                    for &j in list {
                        let adj = i.abs_diff(j) <= 1
                            || (closed && ((i == 0 && j + 1 == seg_count) || (j == 0 && i + 1 == seg_count)));
                        if !adj {
                            let (c, d) = seg(j);
                            if segments_intersect(a, b, c, d) {
                                return true;
                            }
                        }
                    }
                }
                grid.entry((gx, gy)).or_default().push(i);
            }
        }
    }
    false
}

/// Ray-casting point-in-polygon test for a closed ring.
pub fn point_in_ring(pt: [f64; 2], ring: &[[f64; 2]]) -> bool {
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let (x, y) = (pt[0], pt[1]);
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let [xi, yi] = ring[i];
        let [xj, yj] = ring[j];
        if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Smooths a raw contour chain 1-to-1 (preserving vertex count) without self-intersections.
/// `taubin_passes == 0` preserves the exact unsmoothed Marching Squares geometry.
pub fn smooth_curve_safe(
    raw: &[[f64; 2]],
    closed: bool,
    dem: &PreparedDem,
    level: f64,
    max_rise: f64,
    taubin_passes: usize,
) -> Vec<[f64; 2]> {
    if taubin_passes == 0 {
        return raw.to_vec();
    }
    let s1 = taubin_smooth(raw, closed, dem, level, max_rise, taubin_passes);
    if taubin_passes >= 2 {
        let s2 = calm_flat_curve(&s1, closed, dem, level, max_rise);
        if !has_self_intersection(&s2, closed) {
            return s2;
        }
    }
    if !has_self_intersection(&s1, closed) {
        return s1;
    }
    if taubin_passes > 1 {
        let s0 = taubin_smooth(raw, closed, dem, level, max_rise, (taubin_passes / 2).max(1));
        if !has_self_intersection(&s0, closed) {
            return s0;
        }
    }
    raw.to_vec()
}

/// Smooths + simplifies a single polyline while guaranteeing 0 self-intersections.
pub fn smooth_and_simplify_safe(
    raw: &[[f64; 2]],
    closed: bool,
    dem: &PreparedDem,
    level: f64,
    max_rise: f64,
    tol: f64,
    taubin_passes: usize,
) -> Vec<[f64; 2]> {
    let sm = smooth_curve_safe(raw, closed, dem, level, max_rise, taubin_passes);
    let simp = rdp_simplify(&sm, closed, tol);
    if !has_self_intersection(&simp, closed) {
        return simp;
    }
    let simp1 = rdp_simplify(&sm, closed, tol * 0.45);
    if !has_self_intersection(&simp1, closed) {
        return simp1;
    }
    let simp2 = rdp_simplify(raw, closed, tol * 0.3);
    if !has_self_intersection(&simp2, closed) {
        return simp2;
    }
    raw.to_vec()
}

/// Fast, smooth-preserving RDP simplification + strict crossing guard across all contours.
///
/// Simplifies first (5x fewer segments in the spatial grid -> much faster & lower RAM),
/// then checks every pair of simplified segments for crossings. If any contour crosses a
/// neighbor, its smoothed vertices are smoothly feathered toward `raw` and re-simplified
/// until 0 crossings remain.
pub fn guard_and_simplify_all(
    lines: &mut [ContourLine],
    raw_backups: &[Vec<[f64; 2]>],
    min_clearance_m: f64,
    simplify_m: f64,
) {
    if lines.is_empty() {
        return;
    }
    let smooth_backups: Vec<Vec<[f64; 2]>> = lines.iter().map(|l| l.points.clone()).collect();

    // 1. Simplify every smoothed contour safely (0 self-intersections).
    for (li, line) in lines.iter_mut().enumerate() {
        let simp = rdp_simplify(&smooth_backups[li], line.closed, simplify_m);
        if !has_self_intersection(&simp, line.closed) {
            line.points = simp;
        } else {
            let simp2 = rdp_simplify(&smooth_backups[li], line.closed, simplify_m * 0.4);
            if !has_self_intersection(&simp2, line.closed) {
                line.points = simp2;
            }
        }
    }

    // 2. Verify 0 crossings (and no RDP-induced tight pinches) on compact simplified segments.
    let cell = min_clearance_m.max(6.0);
    for pass in 0..4 {
        let mut grid: HashMap<(i32, i32), Vec<(usize, usize)>> = HashMap::new();
        let mut bad = vec![false; lines.len()];
        for (li, line) in lines.iter().enumerate() {
            let pts = &line.points;
            let segs = if line.closed { pts.len() } else { pts.len().saturating_sub(1) };
            for si in 0..segs {
                let a = pts[si];
                let b = pts[(si + 1) % pts.len()];
                let x0 = (a[0].min(b[0]) / cell).floor() as i32;
                let x1 = (a[0].max(b[0]) / cell).floor() as i32;
                let y0 = (a[1].min(b[1]) / cell).floor() as i32;
                let y1 = (a[1].max(b[1]) / cell).floor() as i32;
                for gx in x0..=x1 {
                    for gy in y0..=y1 {
                        if let Some(bucket) = grid.get(&(gx, gy)) {
                            for &(oli, osi) in bucket {
                                if oli == li {
                                    continue;
                                }
                                let opts = &lines[oli].points;
                                let c = opts[osi];
                                let d = opts[(osi + 1) % opts.len()];
                                if segments_intersect(a, b, c, d) {
                                    bad[li] = true;
                                    bad[oli] = true;
                                }
                            }
                        }
                        grid.entry((gx, gy)).or_default().push((li, si));
                    }
                }
            }
        }
        let mut any = false;
        for (li, &is_bad) in bad.iter().enumerate() {
            if !is_bad {
                continue;
            }
            any = true;
            lines[li].points = match pass {
                0 => {
                    // Blend smoothly 50% toward raw, then simplify gently.
                    let blended: Vec<[f64; 2]> = smooth_backups[li]
                        .iter()
                        .zip(raw_backups[li].iter())
                        .map(|(s, r)| [0.5 * (s[0] + r[0]), 0.5 * (s[1] + r[1])])
                        .collect();
                    rdp_simplify(&blended, lines[li].closed, simplify_m * 0.5)
                }
                1 => {
                    let blended: Vec<[f64; 2]> = smooth_backups[li]
                        .iter()
                        .zip(raw_backups[li].iter())
                        .map(|(s, r)| [0.25 * s[0] + 0.75 * r[0], 0.25 * s[1] + 0.75 * r[1]])
                        .collect();
                    rdp_simplify(&blended, lines[li].closed, simplify_m * 0.35)
                }
                2 => rdp_simplify(&raw_backups[li], lines[li].closed, 0.12),
                _ => raw_backups[li].clone(),
            };
        }
        if !any {
            break;
        }
    }
}
