//! Fast low-RAM streaming LiDAR (`.laz` / `.las`) ingestion.
//!
//! - For compressed `.laz` (up to 10M points): single decompression pass with compact
//!   8-byte point records sorted in-place (zero duplicate buffer!) to compute exact p90
//!   vegetation height and 2 m vertical stratum statistics.
//! - For uncompressed `.las` (or huge point clouds > 10M points): zero-buffer 2-pass
//!   streaming so peak RAM stays minimal even on multi-km² maps.
//! - Builds seamless 1 m whole-area DEM (class 2 ground, flat water on class 9,
//!   lake laser-absorption dropout fill along shorelines, 0 tile seams).

use crate::dem::fill_dem_gaps;
use crate::types::{DemGrid, VegFeatures, WorldTransform};
use las::{PointDataBuilder, Reader};
use rayon::prelude::*;
use std::path::PathBuf;

const CHUNK: u64 = 200_000;
const CLASS_GROUND: u8 = 2;
const CLASS_LOW_NOISE: u8 = 7;
const CLASS_WATER: u8 = 9;
const CLASS_HIGH_NOISE: u8 = 18;
const SINGLE_PASS_MAX_POINTS: u64 = 10_000_000;

/// Compact 8-byte point record for single-pass compressed `.laz` ingestion.
#[repr(C)]
#[derive(Clone, Copy)]
struct CompactPoint {
    cell_1m: u32,
    /// Height relative to `z_origin` in 2 cm units (covers 0..1310 m).
    z_2cm: u16,
    /// Bit 0: ground (class 2), Bit 1: multi-return.
    flags: u8,
    /// Quantized intensity (`intensity >> 8`).
    inten_hi: u8,
}

#[derive(Clone, Copy)]
struct GridBounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
    w1: usize,
    h1: usize,
    w2: usize,
    h2: usize,
    z_origin: f64,
}

fn determine_bounds(inputs: &[PathBuf], clip: Option<[f64; 4]>) -> Result<(GridBounds, u64, bool), String> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut min_z = f64::INFINITY;
    let mut total_pts = 0u64;
    let mut any_compressed = false;

    for path in inputs {
        let reader = Reader::from_path(path)
            .map_err(|e| format!("Failed to open LiDAR file {}: {e}", path.display()))?;
        let hdr = reader.header();
        let b = hdr.bounds();
        total_pts += hdr.number_of_points();
        if hdr.point_format().is_compressed {
            any_compressed = true;
        }
        if b.min.x.is_finite() && b.max.x.is_finite() && b.min.x <= b.max.x {
            min_x = min_x.min(b.min.x);
            max_x = max_x.max(b.max.x);
            min_y = min_y.min(b.min.y);
            max_y = max_y.max(b.max.y);
            min_z = min_z.min(b.min.z);
        }
    }

    if let Some([cx0, cy0, cx1, cy1]) = clip {
        if !(cx0 < cx1 && cy0 < cy1) {
            return Err("Invalid --bbox: min must be less than max".into());
        }
        min_x = cx0;
        min_y = cy0;
        max_x = cx1;
        max_y = cy1;
    }

    if !(min_x.is_finite() && max_x.is_finite() && min_x < max_x && min_y < max_y) {
        return Err("Empty or invalid LiDAR bounds".into());
    }

    let snap_min_x = (min_x / 2.0).floor() * 2.0;
    let snap_min_y = (min_y / 2.0).floor() * 2.0;
    let snap_max_x = (max_x / 2.0).ceil() * 2.0;
    let snap_max_y = (max_y / 2.0).ceil() * 2.0;
    let w1 = ((snap_max_x - snap_min_x).round() as usize).max(2);
    let h1 = ((snap_max_y - snap_min_y).round() as usize).max(2);
    let w2 = (w1 / 2).max(1);
    let h2 = (h1 / 2).max(1);

    if w1 * h1 > 80_000_000 {
        return Err(format!("Area too large for 1 m grid: {w1}x{h1} cells"));
    }

    Ok((
        GridBounds {
            min_x: snap_min_x,
            min_y: snap_min_y,
            max_x: snap_max_x,
            max_y: snap_max_y,
            w1,
            h1,
            w2,
            h2,
            z_origin: if min_z.is_finite() { min_z - 5.0 } else { -50.0 },
        },
        total_pts,
        any_compressed,
    ))
}

/// Reads all input `.laz`/`.las` files into a seamless 1 m `DemGrid` + 2 m `VegFeatures`.
pub fn ingest_lidar(inputs: &[PathBuf], clip: Option<[f64; 4]>) -> Result<(DemGrid, VegFeatures, u64), String> {
    if inputs.is_empty() {
        return Err("At least one --input LAZ/LAS file is required".into());
    }
    let (gb, est_pts, any_compressed) = determine_bounds(inputs, clip)?;
    let n1 = gb.w1 * gb.h1;
    let n2 = gb.w2 * gb.h2;

    let mut dem_sum = vec![0.0f32; n1];
    let mut dem_cnt = vec![0u32; n1];
    // Allocate water accumulators lazily so land-only tiles spend 0 bytes on them.
    let mut water_sum: Vec<f32> = Vec::new();
    let mut water_cnt: Vec<u32> = Vec::new();
    let mut water_2m = vec![0u8; n2];

    // Buffer compact 8-byte points only for compressed LAZ (avoids 2nd decompression).
    // Uncompressed LAS streams in 2 ultra-fast passes with 0 point buffer RAM!
    let single_pass = any_compressed && est_pts <= SINGLE_PASS_MAX_POINTS;
    let mut compact: Vec<CompactPoint> = if single_pass {
        Vec::with_capacity(est_pts.min(4_000_000) as usize)
    } else {
        Vec::new()
    };

    let mut kept_points = 0u64;
    let world_1m = WorldTransform {
        cell: 1.0,
        x0: gb.min_x + 0.5,
        y0: gb.max_y - 0.5,
    };
    let world_2m = WorldTransform {
        cell: 2.0,
        x0: gb.min_x + 1.0,
        y0: gb.max_y - 1.0,
    };

    for path in inputs {
        let mut reader = Reader::from_path(path)
            .map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
        let mut data = PointDataBuilder::new().for_header(reader.header()).build();
        loop {
            let n = reader
                .fill_points(CHUNK, &mut data)
                .map_err(|e| format!("Error reading {}: {e}", path.display()))?;
            if n == 0 {
                break;
            }
            for pt in data.points() {
                let pt = pt.map_err(|e| format!("Corrupt LiDAR point: {e}"))?;
                if pt.x < gb.min_x || pt.x >= gb.max_x || pt.y < gb.min_y || pt.y >= gb.max_y {
                    continue;
                }
                let cls = u8::from(pt.classification);
                if cls == CLASS_LOW_NOISE || cls == CLASS_HIGH_NOISE {
                    continue;
                }
                let col1 = ((pt.x - gb.min_x) as usize).min(gb.w1 - 1);
                let row1 = ((gb.max_y - pt.y).floor().max(0.0) as usize).min(gb.h1 - 1);
                let idx1 = row1 * gb.w1 + col1;
                kept_points += 1;
                let z_rel = (pt.z - gb.z_origin) as f32;

                if cls == CLASS_WATER {
                    if water_cnt.is_empty() {
                        water_sum = vec![0.0f32; n1];
                        water_cnt = vec![0u32; n1];
                    }
                    water_sum[idx1] += z_rel;
                    water_cnt[idx1] += 1;
                    let idx2 = (row1 / 2).min(gb.h2 - 1) * gb.w2 + (col1 / 2).min(gb.w2 - 1);
                    water_2m[idx2] = 1;
                    continue;
                }

                if cls == CLASS_GROUND {
                    dem_sum[idx1] += z_rel;
                    dem_cnt[idx1] += 1;
                }

                if single_pass {
                    let flags = u8::from(cls == CLASS_GROUND)
                        | (u8::from(pt.number_of_returns > 1 && pt.return_number < pt.number_of_returns) << 1);
                    let z_2cm = ((pt.z - gb.z_origin) * 50.0).round().clamp(0.0, 65535.0) as u16;
                    compact.push(CompactPoint {
                        cell_1m: idx1 as u32,
                        z_2cm,
                        flags,
                        inten_hi: (pt.intensity >> 8) as u8,
                    });
                }
            }
        }
    }

    let mut z = vec![f32::NAN; n1];
    let mut valid1 = vec![0u8; n1];
    let mut water1 = vec![0u8; n1];
    let has_water = !water_cnt.is_empty();
    for i in 0..n1 {
        if dem_cnt[i] > 0 {
            z[i] = (gb.z_origin + f64::from(dem_sum[i]) / f64::from(dem_cnt[i])) as f32;
            valid1[i] = 1;
        } else if has_water && water_cnt[i] > 0 {
            z[i] = (gb.z_origin + f64::from(water_sum[i]) / f64::from(water_cnt[i])) as f32;
            water1[i] = 1;
        }
    }
    drop(dem_sum);
    drop(dem_cnt);
    drop(water_sum);
    drop(water_cnt);

    if has_water {
        flatten_and_expand_water(&mut z, &valid1, &mut water1, &mut water_2m, gb.w1, gb.h1, gb.w2, gb.h2);
    }

    let mut dem = DemGrid {
        width: gb.w1,
        height: gb.h1,
        world: world_1m,
        z,
        valid: valid1,
        water: water1,
        wet: vec![0u8; n1],
    };
    let filled_for_veg = fill_dem_gaps(&dem);

    // Also mark dark-water laser-absorption voids adjacent to water where filled_z sits at lake level.
    if has_water {
        flood_water_dropouts(&filled_for_veg, &dem.valid, &mut dem.water, &mut water_2m, gb);
    }

    let veg = if single_pass {
        build_veg_from_compact(&mut compact, &filled_for_veg, &water_2m, gb, world_2m)
    } else {
        build_veg_second_pass(inputs, &filled_for_veg, &water_2m, gb, world_2m)?
    };
    drop(compact);

    dem.z = filled_for_veg;

    Ok((dem, veg, kept_points))
}

/// Replaces each connected water body's elevation with its median height (flat water surface).
fn flatten_and_expand_water(
    z: &mut [f32],
    _valid: &[u8],
    water1: &mut [u8],
    water_2m: &mut [u8],
    w1: usize,
    h1: usize,
    w2: usize,
    h2: usize,
) {
    let mut seen = vec![0u8; w1 * h1];
    let mut stack = Vec::new();
    let mut cells = Vec::new();
    let mut vals = Vec::new();
    for start in 0..(w1 * h1) {
        if water1[start] == 0 || seen[start] != 0 || !z[start].is_finite() {
            continue;
        }
        seen[start] = 1;
        stack.push(start);
        cells.clear();
        vals.clear();
        while let Some(i) = stack.pop() {
            cells.push(i);
            vals.push(z[i]);
            let r = i / w1;
            let c = i - r * w1;
            let nbrs = [
                (c > 0).then(|| i - 1),
                (c + 1 < w1).then(|| i + 1),
                (r > 0).then(|| i - w1),
                (r + 1 < h1).then(|| i + w1),
            ];
            for n in nbrs.into_iter().flatten() {
                if water1[n] != 0 && seen[n] == 0 && z[n].is_finite() {
                    seen[n] = 1;
                    stack.push(n);
                }
            }
        }
        vals.sort_by(|a, b| a.total_cmp(b));
        let med = vals[vals.len() / 2];
        for &i in &cells {
            z[i] = med;
            let r = i / w1;
            let c = i - r * w1;
            water_2m[(r / 2).min(h2 - 1) * w2 + (c / 2).min(w2 - 1)] = 1;
        }
    }
}

/// Flood-fills laser-absorption dropouts over open water: cells without ground returns
/// that are adjacent to class-9 water and sit within 0.45 m of the water surface.
fn flood_water_dropouts(
    filled_z: &[f32],
    valid1: &[u8],
    water1: &mut [u8],
    water_2m: &mut [u8],
    gb: GridBounds,
) {
    let (w1, h1) = (gb.w1, gb.h1);
    let mut queue = Vec::new();
    for i in 0..(w1 * h1) {
        if water1[i] != 0 {
            queue.push((i, filled_z[i]));
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let (i, wz) = queue[head];
        head += 1;
        let r = i / w1;
        let c = i - r * w1;
        let nbrs = [
            (c > 0).then(|| i - 1),
            (c + 1 < w1).then(|| i + 1),
            (r > 0).then(|| i - w1),
            (r + 1 < h1).then(|| i + w1),
        ];
        for n in nbrs.into_iter().flatten() {
            if water1[n] == 0 && valid1[n] == 0 && (filled_z[n] - wz).abs() <= 0.45 {
                water1[n] = 1;
                let nr = n / w1;
                let nc = n - nr * w1;
                water_2m[(nr / 2).min(gb.h2 - 1) * gb.w2 + (nc / 2).min(gb.w2 - 1)] = 1;
                queue.push((n, wz));
            }
        }
    }
    // Also mark 2 m cells as water when >= 2 of their 4 underlying 1 m cells are water.
    for r2 in 0..gb.h2 {
        for c2 in 0..gb.w2 {
            let mut wcnt = 0u8;
            for dr in 0..2 {
                let r1 = (r2 * 2 + dr).min(h1 - 1);
                for dc in 0..2 {
                    let c1 = (c2 * 2 + dc).min(w1 - 1);
                    wcnt += water1[r1 * w1 + c1];
                }
            }
            if wcnt >= 2 {
                water_2m[r2 * gb.w2 + c2] = 1;
            }
        }
    }
}

/// In-place cell-bucketed vegetation statistics from compact 8-byte points (zero duplicate Vec!).
fn build_veg_from_compact(
    compact: &mut [CompactPoint],
    filled_z: &[f32],
    water_2m: &[u8],
    gb: GridBounds,
    world_2m: WorldTransform,
) -> VegFeatures {
    let cell2_of = |cell_1m: u32| -> usize {
        let idx1 = cell_1m as usize;
        let r1 = idx1 / gb.w1;
        let c1 = idx1 - r1 * gb.w1;
        (r1 / 2).min(gb.h2 - 1) * gb.w2 + (c1 / 2).min(gb.w2 - 1)
    };
    compact.par_sort_unstable_by_key(|p| cell2_of(p.cell_1m));

    let n2 = gb.w2 * gb.h2;
    let mut valid = vec![0u8; n2];
    let mut vegh = vec![0.0f32; n2];
    let mut ground_share = vec![0.0f32; n2];
    let mut low_share = vec![0.0f32; n2];
    let mut mid_share = vec![0.0f32; n2];
    let mut high_share = vec![0.0f32; n2];
    let mut return_ratio = vec![0.0f32; n2];
    let mut npts = vec![0.0f32; n2];
    let mut ground_intensity = vec![0.0f32; n2];
    let mut spread = vec![0.0f32; n2];

    let mut heights = Vec::<f32>::with_capacity(64);
    let mut pos = 0usize;
    while pos < compact.len() {
        let idx2 = cell2_of(compact[pos].cell_1m);
        let mut end = pos + 1;
        while end < compact.len() && cell2_of(compact[end].cell_1m) == idx2 {
            end += 1;
        }
        let slice = &compact[pos..end];
        pos = end;

        if water_2m[idx2] != 0 {
            continue;
        }
        heights.clear();
        let mut cnt = 0u32;
        let mut gnd = 0u32;
        let mut low = 0u32;
        let mut mid = 0u32;
        let mut high = 0u32;
        let mut multiret = 0u32;
        let mut inten_sum = 0.0f64;
        let mut spread_sq = 0.0f64;

        for p in slice {
            let gz = filled_z[p.cell_1m as usize];
            if !gz.is_finite() {
                continue;
            }
            let pz = gb.z_origin + f64::from(p.z_2cm) * 0.02;
            let above = pz - f64::from(gz);
            if above > 60.0 || above < -5.0 {
                continue;
            }
            cnt += 1;
            if (p.flags & 2) != 0 {
                multiret += 1;
            }
            if (p.flags & 1) != 0 {
                gnd += 1;
                inten_sum += f64::from(p.inten_hi) * 256.0;
                spread_sq += above * above;
                heights.push(0.0);
            } else {
                let h = above.max(0.0) as f32;
                heights.push(h);
                if (0.3..1.0).contains(&above) {
                    low += 1;
                } else if (1.0..3.0).contains(&above) {
                    mid += 1;
                } else if above >= 3.0 {
                    high += 1;
                }
            }
        }
        if cnt == 0 {
            continue;
        }
        heights.sort_by(|a, b| a.total_cmp(b));
        let p90_idx = ((heights.len() * 9) / 10).min(heights.len() - 1);
        let inv = 1.0 / cnt as f32;
        valid[idx2] = 1;
        vegh[idx2] = heights[p90_idx];
        ground_share[idx2] = gnd as f32 * inv;
        low_share[idx2] = low as f32 * inv;
        mid_share[idx2] = mid as f32 * inv;
        high_share[idx2] = high as f32 * inv;
        return_ratio[idx2] = if multiret > 0 { multiret as f32 * inv } else { (1.0 - ground_share[idx2]).max(0.0) };
        npts[idx2] = cnt as f32;
        if gnd > 0 {
            ground_intensity[idx2] = (inten_sum / f64::from(gnd)) as f32;
            spread[idx2] = (spread_sq / f64::from(gnd)).sqrt() as f32;
        }
    }

    VegFeatures {
        width: gb.w2,
        height: gb.h2,
        world: world_2m,
        valid,
        water: water_2m.to_vec(),
        vegh,
        ground_share,
        low_share,
        mid_share,
        high_share,
        return_ratio,
        npts,
        ground_intensity,
        spread,
        slope_deg: vec![f32::NAN; n2],
    }
}

/// Zero-buffer streaming pass 2 for uncompressed `.las` or very large point clouds.
fn build_veg_second_pass(
    inputs: &[PathBuf],
    filled_z: &[f32],
    water_2m: &[u8],
    gb: GridBounds,
    world_2m: WorldTransform,
) -> Result<VegFeatures, String> {
    let n2 = gb.w2 * gb.h2;
    let mut top = vec![0.0f32; n2];
    let mut cnt = vec![0u32; n2];
    let mut gnd = vec![0u32; n2];
    let mut low = vec![0u32; n2];
    let mut mid = vec![0u32; n2];
    let mut high = vec![0u32; n2];
    let mut mret = vec![0u32; n2];
    let mut inten = vec![0.0f32; n2];
    let mut sp_sq = vec![0.0f32; n2];

    for path in inputs {
        let mut reader = Reader::from_path(path).map_err(|e| format!("Pass 2 open error: {e}"))?;
        let mut data = PointDataBuilder::new().for_header(reader.header()).build();
        while reader.fill_points(CHUNK, &mut data).map_err(|e| format!("Pass 2 read error: {e}"))? > 0 {
            for pt in data.points() {
                let pt = pt.map_err(|e| format!("Pass 2 point error: {e}"))?;
                if pt.x < gb.min_x || pt.x >= gb.max_x || pt.y < gb.min_y || pt.y >= gb.max_y {
                    continue;
                }
                let cls = u8::from(pt.classification);
                if cls == CLASS_LOW_NOISE || cls == CLASS_HIGH_NOISE || cls == CLASS_WATER {
                    continue;
                }
                let col1 = ((pt.x - gb.min_x) as usize).min(gb.w1 - 1);
                let row1 = ((gb.max_y - pt.y).floor().max(0.0) as usize).min(gb.h1 - 1);
                let gz = filled_z[row1 * gb.w1 + col1];
                if !gz.is_finite() {
                    continue;
                }
                let above = pt.z - f64::from(gz);
                if above > 60.0 || above < -5.0 {
                    continue;
                }
                let idx2 = (row1 / 2).min(gb.h2 - 1) * gb.w2 + (col1 / 2).min(gb.w2 - 1);
                if water_2m[idx2] != 0 {
                    continue;
                }
                cnt[idx2] += 1;
                if pt.number_of_returns > 1 && pt.return_number < pt.number_of_returns {
                    mret[idx2] += 1;
                }
                if cls == CLASS_GROUND {
                    gnd[idx2] += 1;
                    inten[idx2] += pt.intensity as f32;
                    sp_sq[idx2] += (above * above) as f32;
                } else {
                    top[idx2] = top[idx2].max(above.max(0.0) as f32);
                    if (0.3..1.0).contains(&above) {
                        low[idx2] += 1;
                    } else if (1.0..3.0).contains(&above) {
                        mid[idx2] += 1;
                    } else if above >= 3.0 {
                        high[idx2] += 1;
                    }
                }
            }
        }
    }

    let mut valid = vec![0u8; n2];
    let mut ground_share = vec![0.0f32; n2];
    let mut low_share = vec![0.0f32; n2];
    let mut mid_share = vec![0.0f32; n2];
    let mut high_share = vec![0.0f32; n2];
    let mut return_ratio = vec![0.0f32; n2];
    let mut npts = vec![0.0f32; n2];
    let mut ground_intensity = vec![0.0f32; n2];
    let mut spread = vec![0.0f32; n2];

    for i in 0..n2 {
        if cnt[i] == 0 || water_2m[i] != 0 {
            continue;
        }
        valid[i] = 1;
        let inv = 1.0 / cnt[i] as f32;
        ground_share[i] = gnd[i] as f32 * inv;
        low_share[i] = low[i] as f32 * inv;
        mid_share[i] = mid[i] as f32 * inv;
        high_share[i] = high[i] as f32 * inv;
        return_ratio[i] = if mret[i] > 0 { mret[i] as f32 * inv } else { 1.0 - ground_share[i] };
        npts[i] = cnt[i] as f32;
        if gnd[i] > 0 {
            ground_intensity[i] = inten[i] / gnd[i] as f32;
            spread[i] = (sp_sq[i] / gnd[i] as f32).sqrt();
        }
    }

    Ok(VegFeatures {
        width: gb.w2,
        height: gb.h2,
        world: world_2m,
        valid,
        water: water_2m.to_vec(),
        vegh: top,
        ground_share,
        low_share,
        mid_share,
        high_share,
        return_ratio,
        npts,
        ground_intensity,
        spread,
        slope_deg: vec![f32::NAN; n2],
    })
}
