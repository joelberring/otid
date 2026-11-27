//! Shared raster geometry helpers: Douglas–Peucker `simplify`, signed `ring_area`,
//! hole-preserving `clean_mask`, boundary `mask_rings`, polygon hole nesting,
//! `vatten.geojson` writer, and O(1) 2D integral `local_relief`.

use crate::rasters::grid_io::{js_round, GroundGrid};
use rayon::prelude::*;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

/// Douglas–Peucker polyline simplification (exact `geo-moisture.ts` `simplify`).
pub fn simplify(points: &[[f64; 2]], tolerance: f64) -> Vec<[f64; 2]> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let mut keep = vec![0u8; points.len()];
    keep[0] = 1;
    keep[points.len() - 1] = 1;
    let mut stack = vec![(0usize, points.len() - 1)];
    while let Some((a, b)) = stack.pop() {
        let [ax, ay] = points[a];
        let [bx, by] = points[b];
        let len = (bx - ax).hypot(by - ay);
        let mut worst = -1.0f64;
        let mut index = 0usize;
        for i in (a + 1)..b {
            let [px, py] = points[i];
            let dist = if len == 0.0 {
                (px - ax).hypot(py - ay)
            } else {
                ((by - ay) * px - (bx - ax) * py + bx * ay - by * ax).abs() / len
            };
            if dist > worst {
                worst = dist;
                index = i;
            }
        }
        if worst > tolerance && index > 0 {
            keep[index] = 1;
            stack.push((a, index));
            stack.push((index, b));
        }
    }
    points.iter().enumerate().filter_map(|(i, &p)| (keep[i] == 1).then_some(p)).collect()
}

/// Signed area of a ring (> 0 for CCW outer rings, < 0 for CW holes).
pub fn ring_area(ring: &[[f64; 2]]) -> f64 {
    let n = ring.len();
    if n < 3 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    for i in 0..n {
        let [x, y] = ring[i];
        let [nx, ny] = ring[(i + 1) % n];
        sum += x * ny - nx * y;
    }
    sum * 0.5
}

/// Removes small islands (`< min_cells`) and fills only small interior holes (`< min_hole_cells`)
/// that do not reach the border or `blocked` (water). Exact 4-neighbor `geo-moisture.ts` `cleanMask`.
pub fn clean_mask(
    mask: &[u8],
    width: usize,
    height: usize,
    min_cells: usize,
    min_hole_cells: usize,
    blocked: Option<&[u8]>,
) -> Vec<u8> {
    let size = width * height;
    let mut out = vec![0u8; size];
    let mut seen = vec![0u8; size];
    let mut queue = vec![0usize; size];

    let component = |start: usize, seen: &mut [u8], queue: &mut [usize], inside: &dyn Fn(usize) -> bool| -> usize {
        let mut head = 0usize;
        let mut tail = 1usize;
        queue[0] = start;
        seen[start] = 1;
        while head < tail {
            let i = queue[head];
            head += 1;
            let x = i / height;
            let y = i - x * height;
            if x + 1 < width {
                let n = i + height;
                if seen[n] == 0 && inside(n) { seen[n] = 1; queue[tail] = n; tail += 1; }
            }
            if x > 0 {
                let n = i - height;
                if seen[n] == 0 && inside(n) { seen[n] = 1; queue[tail] = n; tail += 1; }
            }
            if y + 1 < height {
                let n = i + 1;
                if seen[n] == 0 && inside(n) { seen[n] = 1; queue[tail] = n; tail += 1; }
            }
            if y > 0 {
                let n = i - 1;
                if seen[n] == 0 && inside(n) { seen[n] = 1; queue[tail] = n; tail += 1; }
            }
        }
        tail
    };

    for i in 0..size {
        if mask[i] == 0 || seen[i] != 0 {
            continue;
        }
        let count = component(i, &mut seen, &mut queue, &|n| mask[n] == 1);
        if count >= min_cells {
            for &idx in &queue[..count] {
                out[idx] = 1;
            }
        }
    }

    if min_hole_cells > 0 {
        seen.fill(0);
        for x in 0..width {
            for y in [0usize, height - 1] {
                let i = x * height + y;
                if out[i] == 0 && seen[i] == 0 {
                    component(i, &mut seen, &mut queue, &|n| out[n] == 0);
                }
            }
        }
        for y in 0..height {
            for x in [0usize, width - 1] {
                let i = x * height + y;
                if out[i] == 0 && seen[i] == 0 {
                    component(i, &mut seen, &mut queue, &|n| out[n] == 0);
                }
            }
        }
        if let Some(blk) = blocked {
            for i in 0..size {
                if blk[i] != 0 && out[i] == 0 && seen[i] == 0 {
                    component(i, &mut seen, &mut queue, &|n| out[n] == 0);
                }
            }
        }
        for i in 0..size {
            if out[i] != 0 || seen[i] != 0 {
                continue;
            }
            let count = component(i, &mut seen, &mut queue, &|n| out[n] == 0);
            if count < min_hole_cells {
                for &idx in &queue[..count] {
                    out[idx] = 1;
                }
            }
        }
    }
    out
}

/// Traces boundary rings of a binary column-major mask (`min_x_center`/`min_y_center` = center of cell 0,0).
/// Exact match to `scripts/geo-moisture.ts` `maskRings`.
pub fn mask_rings(
    mask: &[u8],
    min_x_center: f64,
    min_y_center: f64,
    cell: f64,
    width: usize,
    height: usize,
) -> Vec<Vec<[f64; 2]>> {
    let at = |x: isize, y: isize| -> bool {
        x >= 0 && y >= 0 && (x as usize) < width && (y as usize) < height && mask[x as usize * height + y as usize] == 1
    };
    let h1 = height + 1;
    let corners = (width + 1) * h1;
    let mut first = vec![-1i32; corners];
    let mut second = vec![-1i32; corners];
    let mut known = vec![0u8; corners];
    let mut order = Vec::<usize>::with_capacity(1024);

    let mut add = |x1: usize, y1: usize, x2: usize, y2: usize| {
        let from = x1 * h1 + y1;
        let to = (x2 * h1 + y2) as i32;
        if known[from] == 0 {
            known[from] = 1;
            order.push(from);
        }
        if first[from] < 0 {
            first[from] = to;
        } else if second[from] < 0 {
            second[from] = to;
        }
    };

    for x in 0..width {
        let xi = x as isize;
        for y in 0..height {
            let yi = y as isize;
            if !at(xi, yi) {
                continue;
            }
            if !at(xi, yi - 1) { add(x, y, x + 1, y); }
            if !at(xi + 1, yi) { add(x + 1, y, x + 1, y + 1); }
            if !at(xi, yi + 1) { add(x + 1, y + 1, x, y + 1); }
            if !at(xi - 1, yi) { add(x, y + 1, x, y); }
        }
    }

    let point = |k: usize| -> [f64; 2] {
        let x = k / h1;
        let y = k - x * h1;
        [min_x_center + (x as f64 - 0.5) * cell, min_y_center + (y as f64 - 0.5) * cell]
    };

    let mut rings = Vec::new();
    for &start in &order {
        while first[start] >= 0 {
            let mut ring = vec![start];
            let mut current = if second[start] >= 0 {
                let to = second[start] as usize;
                second[start] = -1;
                to
            } else {
                let to = first[start] as usize;
                first[start] = -1;
                to
            };
            let mut previous = start;
            while current != start {
                ring.push(current);
                if first[current] < 0 {
                    break;
                }
                let mut choice = 0usize;
                if second[current] >= 0 {
                    let [px, py] = point(previous);
                    let [cx, cy] = point(current);
                    let heading = (cy - py).atan2(cx - px);
                    let mut best = f64::INFINITY;
                    let opts = [first[current] as usize, second[current] as usize];
                    for (idx, opt) in opts.into_iter().enumerate() {
                        let [ox, oy] = point(opt);
                        let mut turn = (oy - cy).atan2(ox - cx) - heading;
                        while turn <= -std::f64::consts::PI { turn += std::f64::consts::TAU; }
                        while turn > std::f64::consts::PI { turn -= std::f64::consts::TAU; }
                        if -turn < best {
                            best = -turn;
                            choice = idx;
                        }
                    }
                }
                previous = current;
                current = if choice == 0 {
                    let next = first[current] as usize;
                    first[current] = second[current];
                    second[current] = -1;
                    next
                } else {
                    let next = second[current] as usize;
                    second[current] = -1;
                    next
                };
            }
            if current == start && ring.len() >= 4 {
                rings.push(ring.into_iter().map(point).collect());
            }
        }
    }
    rings
}

fn point_in_ring(ring: &[[f64; 2]], p: [f64; 2]) -> bool {
    let mut hit = false;
    let mut j = ring.len().saturating_sub(1);
    for i in 0..ring.len() {
        let [x1, y1] = ring[i];
        let [x2, y2] = ring[j];
        if ((y1 > p[1]) != (y2 > p[1])) && (p[0] < (x2 - x1) * (p[1] - y1) / (y2 - y1) + x1) {
            hit = !hit;
        }
        j = i;
    }
    hit
}

/// Groups outer CCW rings with their enclosed CW hole rings (`scripts/geo-water.ts` `polygonsOf`).
pub fn nest_polygons(rings: &[Vec<[f64; 2]>]) -> Vec<Vec<Vec<[f64; 2]>>> {
    let mut outers: Vec<(f64, Vec<Vec<[f64; 2]>>)> = rings
        .iter()
        .filter_map(|r| {
            let a = ring_area(r);
            (a > 0.0).then(|| (a, vec![r.clone()]))
        })
        .collect();
    for hole in rings.iter().filter(|r| ring_area(r) < 0.0) {
        if let Some(best) = outers
            .iter_mut()
            .filter(|(_, poly)| point_in_ring(&poly[0], hole[0]))
            .min_by(|a, b| a.0.total_cmp(&b.0))
        {
            best.1.push(hole.clone());
        }
    }
    outers.into_iter().map(|(_, poly)| poly).collect()
}

/// Writes `vatten.geojson` FeatureCollection (`scripts/geo-water.ts` `waterFromGrids`).
pub fn write_water_geojson(path: &Path, polygons: &[Vec<Vec<[f64; 2]>>]) -> Result<(), String> {
    let file = File::create(path).map_err(|e| format!("Failed creating {}: {e}", path.display()))?;
    let mut w = BufWriter::with_capacity(64 * 1024, file);
    write!(w, "{{\"type\":\"FeatureCollection\",\"features\":[").map_err(|e| e.to_string())?;
    for (pi, poly) in polygons.iter().enumerate() {
        if pi > 0 { write!(w, ",").map_err(|e| e.to_string())?; }
        write!(
            w,
            "{{\"type\":\"Feature\",\"properties\":{{\"layer\":\"vatten\"}},\"geometry\":{{\"type\":\"Polygon\",\"coordinates\":["
        )
        .map_err(|e| e.to_string())?;
        for (ri, ring) in poly.iter().enumerate() {
            if ri > 0 { write!(w, ",").map_err(|e| e.to_string())?; }
            write!(w, "[").map_err(|e| e.to_string())?;
            for (vi, &[x, y]) in ring.iter().enumerate() {
                if vi > 0 { write!(w, ",").map_err(|e| e.to_string())?; }
                let rx = js_round(x * 100.0) / 100.0;
                let ry = js_round(y * 100.0) / 100.0;
                write!(w, "[{rx},{ry}]").map_err(|e| e.to_string())?;
            }
            write!(w, "]").map_err(|e| e.to_string())?;
        }
        write!(w, "]}}}}").map_err(|e| e.to_string())?;
    }
    write!(w, "]}}").map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

/// Elevation minus local mean within `radius_m` meters via O(1) 2D integral tables (`geo-ditches.ts` `localRelief`).
pub fn local_relief(ground: &GroundGrid, radius_m: f64) -> Vec<f32> {
    let (w, h) = (ground.width, ground.height);
    let reach = js_round(radius_m / ground.cell).max(1.0) as usize;
    let stride = h + 1;
    let table_len = (w + 1) * stride;
    let mut sum_tbl = vec![0.0f64; table_len];
    let mut cnt_tbl = vec![0u32; table_len];

    for x in 0..w {
        let src_col = x * h;
        let dst_col = (x + 1) * stride;
        let left_col = x * stride;
        for y in 0..h {
            let v = ground.z[src_col + y];
            let fin = v.is_finite();
            let i = dst_col + y + 1;
            sum_tbl[i] = (if fin { f64::from(v) } else { 0.0 })
                + sum_tbl[left_col + y + 1]
                + sum_tbl[dst_col + y]
                - sum_tbl[left_col + y];
            cnt_tbl[i] = u32::from(fin) + cnt_tbl[left_col + y + 1] + cnt_tbl[dst_col + y] - cnt_tbl[left_col + y];
        }
    }

    let mut relief = vec![f32::NAN; w * h];
    relief.par_chunks_mut(h).enumerate().for_each(|(x, dst_col)| {
        let x0 = x.saturating_sub(reach) * stride;
        let x1 = (x + reach + 1).min(w) * stride;
        let z_col = &ground.z[x * h..(x + 1) * h];
        for y in 0..h {
            let zv = z_col[y];
            if !zv.is_finite() {
                continue;
            }
            let y0 = y.saturating_sub(reach);
            let y1 = (y + reach + 1).min(h);
            let n = (cnt_tbl[x1 + y1] + cnt_tbl[x0 + y0]) - cnt_tbl[x0 + y1] - cnt_tbl[x1 + y0];
            if n >= 4 {
                let s = sum_tbl[x1 + y1] - sum_tbl[x0 + y1] - sum_tbl[x1 + y0] + sum_tbl[x0 + y0];
                dst_col[y] = (f64::from(zv) - s / f64::from(n)) as f32;
            }
        }
    });
    relief
}
