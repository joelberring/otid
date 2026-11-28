//! Clean-room MIT hydrology & soil moisture engine (exact port of `scripts/geo-moisture.ts`):
//! 1 m -> 2 m downsampling, Barnes 2014 Priority-Flood + epsilon with FIFO pit queue,
//! D8 steepest flow directions, Kahn topological flow accumulation, HAND (height above nearest drainage),
//! slope & open-ground suppression with 30 m shore-marsh exemption, hole-preserving `clean_mask`,
//! channel vectorization, Sub-filtered `fukt.png` + `fuktdjup.png` + `.pgw`, and `fukt.dxf`.

use crate::bench_io::read_rgba_png;
use crate::rasters::geom::{clean_mask, mask_rings, ring_area, simplify};
use crate::rasters::grid_io::{
    js_round, world_file_center, write_moisture_dxf, write_sub_png, DxfLayer, GroundGrid,
    PointStats, WaterData,
};
use crate::types::WorldTransform;
use crate::vegetation::{LAB_OPEN, TALL_DENSE_CANOPY_BIT};
use rayon::prelude::*;
use std::path::Path;

pub const DEPTH_STEP_METERS: f64 = 0.02;
pub const SLOPE_STEP_DEGREES: f64 = 0.1;
pub const WET_SLOPE_DEGREES: f32 = 3.0;
pub const MOIST_SLOPE_DEGREES: f32 = 4.0;
pub const OPEN_GROUND_SHARE: f64 = 0.8;
pub const TALL_TIMBER_MIN_VEGH_M: f64 = 16.0;
pub const TALL_TIMBER_MAX_GROUND_SHARE: f64 = 0.26;
pub const SHORE_MARSH_METERS: f64 = 30.0;
pub const DEFAULT_CHANNEL_HA: f64 = 1.0;
pub const DEFAULT_WET_METERS: f64 = 0.25;
pub const DEFAULT_MOIST_METERS: f64 = 0.4;
pub const DEFAULT_CHANNEL_LINE_HA: f64 = 5.0;

const DX: [isize; 8] = [1, 1, 0, -1, -1, -1, 0, 1];
const DY: [isize; 8] = [0, 1, 1, 1, 0, -1, -1, -1];

#[derive(Clone, Copy, Debug)]
pub struct MoistureSettings {
    pub channel_ha: f64,
    pub wet_meters: f64,
    pub moist_meters: f64,
    pub channel_line_ha: f64,
}

impl Default for MoistureSettings {
    fn default() -> Self {
        Self {
            channel_ha: DEFAULT_CHANNEL_HA,
            wet_meters: DEFAULT_WET_METERS,
            moist_meters: DEFAULT_MOIST_METERS,
            channel_line_ha: DEFAULT_CHANNEL_LINE_HA,
        }
    }
}

/// 2 m cell-center grid (`min_x`, `min_y` = center of cell `(0, 0)`, column-major `x * height + y`).
pub struct Grid2m {
    pub min_x: f64,
    pub min_y: f64,
    pub cell: f64,
    pub width: usize,
    pub height: usize,
    pub z: Vec<f64>,
}

/// Summary & 1 m `wet_mask` produced by the moisture step.
pub struct MoistureResult {
    pub wet_ha: f64,
    pub moist_ha: f64,
    pub wet_areas: usize,
    pub moist_areas: usize,
    pub channels: usize,
    /// 1 m mask aligned to `ground`: 1 where 2 m HAND <= `moist_meters` (for ditches, tracks, knolls).
    pub wet_mask_1m: Vec<u8>,
}

/// Downsamples a 1 m `GroundGrid` to a 2 m `Grid2m` (exact `downsampleGroundTo2m`).
pub fn downsample_ground_to_2m(ground: &GroundGrid) -> Grid2m {
    if ground.cell >= 2.0 {
        let z: Vec<f64> = ground
            .z
            .iter()
            .map(|&v| {
                let d = f64::from(v);
                if d.is_finite() && d > -1000.0 && d < 10_000.0 { d } else { f64::NAN }
            })
            .collect();
        return Grid2m {
            min_x: ground.min_x + ground.cell * 0.5,
            min_y: ground.min_y + ground.cell * 0.5,
            cell: ground.cell,
            width: ground.width,
            height: ground.height,
            z,
        };
    }
    let factor = js_round(2.0 / ground.cell).max(1.0) as usize;
    let target_cell = ground.cell * factor as f64;
    let width = ground.width.div_ceil(factor);
    let height = ground.height.div_ceil(factor);
    let mut z = vec![f64::NAN; width * height];
    let gh = ground.height;
    let gw = ground.width;

    z.par_chunks_mut(height).enumerate().for_each(|(cx, dst_col)| {
        let x0 = cx * factor;
        let x1 = gw.min(x0 + factor);
        for (cy, dst) in dst_col.iter_mut().enumerate() {
            let y0 = cy * factor;
            let y1 = gh.min(y0 + factor);
            let mut sum = 0.0f64;
            let mut n = 0u32;
            for x in x0..x1 {
                let base = x * gh;
                for y in y0..y1 {
                    let v = f64::from(ground.z[base + y]);
                    if v.is_finite() && v > -1000.0 && v < 10_000.0 {
                        sum += v;
                        n += 1;
                    }
                }
            }
            *dst = if n > 0 { sum / f64::from(n) } else { f64::NAN };
        }
    });

    Grid2m {
        min_x: ground.min_x + target_cell * 0.5,
        min_y: ground.min_y + target_cell * 0.5,
        cell: target_cell,
        width,
        height,
        z,
    }
}

/// Binary min-heap keyed by `f64` elevation (exact tie-breaking match to `geo-moisture.ts` `Heap`).
struct MinHeap {
    items: Vec<u32>,
    keys: Vec<f64>,
}

impl MinHeap {
    fn with_capacity(cap: usize) -> Self {
        Self { items: Vec::with_capacity(cap.max(16)), keys: Vec::with_capacity(cap.max(16)) }
    }

    #[inline]
    fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    #[inline]
    fn peek_key(&self) -> f64 {
        self.keys[0]
    }

    #[inline]
    fn push(&mut self, item: u32, key: f64) {
        let mut i = self.items.len();
        self.items.push(item);
        self.keys.push(key);
        while i > 0 {
            let parent = (i - 1) >> 1;
            if self.keys[parent] <= key {
                break;
            }
            self.items[i] = self.items[parent];
            self.keys[i] = self.keys[parent];
            i = parent;
        }
        self.items[i] = item;
        self.keys[i] = key;
    }

    #[inline]
    fn pop(&mut self) -> u32 {
        let top = self.items[0];
        let item = self.items.pop().unwrap();
        let key = self.keys.pop().unwrap();
        let size = self.items.len();
        if size > 0 {
            let mut i = 0usize;
            loop {
                let mut child = i * 2 + 1;
                if child >= size {
                    break;
                }
                if child + 1 < size && self.keys[child + 1] < self.keys[child] {
                    child += 1;
                }
                if self.keys[child] >= key {
                    break;
                }
                self.items[i] = self.items[child];
                self.keys[i] = self.keys[child];
                i = child;
            }
            self.items[i] = item;
            self.keys[i] = key;
        }
        top
    }
}

/// Barnes et al. (2014) Priority-Flood + epsilon with FIFO pit queue (`geo-moisture.ts` `fillDepressions`).
pub fn fill_depressions(grid: &Grid2m, epsilon: f64) -> Vec<f64> {
    let (w, h) = (grid.width, grid.height);
    let len = w * h;
    let mut filled = vec![f64::NAN; len];
    let mut done = vec![0u8; len];
    let mut heap = MinHeap::with_capacity(2 * (w + h));

    for x in 0..w {
        let xi = x as isize;
        for y in 0..h {
            let yi = y as isize;
            let i = x * h + y;
            let zi = grid.z[i];
            if zi.is_nan() {
                done[i] = 1;
                continue;
            }
            let mut edge = x == 0 || y == 0 || x + 1 == w || y + 1 == h;
            if !edge {
                for k in 0..8 {
                    let nx = (xi + DX[k]) as usize;
                    let ny = (yi + DY[k]) as usize;
                    if grid.z[nx * h + ny].is_nan() {
                        edge = true;
                        break;
                    }
                }
            }
            if edge {
                filled[i] = zi;
                done[i] = 1;
                heap.push(i as u32, zi);
            }
        }
    }

    let mut pit = vec![0u32; len];
    let mut pit_head = 0usize;
    let mut pit_tail = 0usize;
    let wi = w as isize;
    let hi = h as isize;

    while !heap.is_empty() || pit_head < pit_tail {
        let i = if pit_head < pit_tail && (heap.is_empty() || filled[pit[pit_head] as usize] <= heap.peek_key()) {
            let v = pit[pit_head] as usize;
            pit_head += 1;
            v
        } else {
            heap.pop() as usize
        };
        let level = filled[i] + epsilon;
        let x = (i / h) as isize;
        let y = (i - x as usize * h) as isize;
        for k in 0..8 {
            let nx = x + DX[k];
            let ny = y + DY[k];
            if nx < 0 || ny < 0 || nx >= wi || ny >= hi {
                continue;
            }
            let n = nx as usize * h + ny as usize;
            if done[n] != 0 {
                continue;
            }
            done[n] = 1;
            let elev = grid.z[n];
            if elev <= level {
                filled[n] = level;
                pit[pit_tail] = n as u32;
                pit_tail += 1;
            } else {
                filled[n] = elev;
                heap.push(n as u32, elev);
            }
        }
    }
    filled
}

/// D8 steepest downstream neighbor per cell, or -1 at edges (`geo-moisture.ts` `flowDirections`).
pub fn flow_directions(grid: &Grid2m, filled: &[f64]) -> Vec<i32> {
    let (w, h) = (grid.width, grid.height);
    let wi = w as isize;
    let hi = h as isize;
    let mut down = vec![-1i32; w * h];
    down.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
        let xi = x as isize;
        for (y, dst) in col.iter_mut().enumerate() {
            let i = x * h + y;
            let here = filled[i];
            if here.is_nan() {
                continue;
            }
            let yi = y as isize;
            let mut best = 0.0f64;
            let mut target = -1i32;
            for k in 0..8 {
                let nx = xi + DX[k];
                let ny = yi + DY[k];
                if nx < 0 || ny < 0 || nx >= wi || ny >= hi {
                    continue;
                }
                let n = nx as usize * h + ny as usize;
                let there = filled[n];
                if there.is_nan() {
                    continue;
                }
                let slope = (here - there) / if k % 2 == 1 { std::f64::consts::SQRT_2 } else { 1.0 };
                if slope > best {
                    best = slope;
                    target = n as i32;
                }
            }
            *dst = target;
        }
    });
    down
}

/// Kahn topological sort flow accumulation (`geo-moisture.ts` `flowAccumulation`).
pub fn flow_accumulation(down: &[i32], filled: &[f64]) -> (Vec<f64>, Vec<u32>) {
    let n = down.len();
    let mut inflow = vec![0u32; n];
    for &next in down {
        if next >= 0 {
            inflow[next as usize] += 1;
        }
    }
    let mut acc = vec![0.0f64; n];
    let mut order = Vec::<u32>::with_capacity(n);
    for i in 0..n {
        if filled[i].is_nan() {
            continue;
        }
        acc[i] = 1.0;
        if inflow[i] == 0 {
            order.push(i as u32);
        }
    }
    let mut head = 0usize;
    while head < order.len() {
        let i = order[head] as usize;
        head += 1;
        let next = down[i];
        if next < 0 {
            continue;
        }
        let nu = next as usize;
        acc[nu] += acc[i];
        inflow[nu] -= 1;
        if inflow[nu] == 0 {
            order.push(nu as u32);
        }
    }
    (acc, order)
}

/// Height Above Nearest Drainage (HAND) in meters (`geo-moisture.ts` `heightAboveDrainage`).
pub fn height_above_drainage(
    grid: &Grid2m,
    down: &[i32],
    acc: &[f64],
    order: &[u32],
    channel_cells: f64,
) -> Vec<f32> {
    let n = down.len();
    let mut nearest = vec![-1i32; n];
    let mut hand = vec![f32::NAN; n];
    for &idx in order.iter().rev() {
        let i = idx as usize;
        let nr = if acc[i] >= channel_cells {
            i as i32
        } else if down[i] >= 0 {
            nearest[down[i] as usize]
        } else {
            -1
        };
        nearest[i] = nr;
        if nr >= 0 {
            hand[i] = (grid.z[i] - grid.z[nr as usize]).max(0.0) as f32;
        }
    }
    hand
}

/// Slope in degrees over +/- 2 cells (`geo-moisture.ts` `slopeDegrees`).
pub fn slope_degrees(grid: &Grid2m) -> Vec<f32> {
    let (w, h, cell) = (grid.width, grid.height, grid.cell);
    let mut out = vec![f32::NAN; w * h];
    let at = |x: isize, y: isize| -> f64 {
        let cx = x.clamp(0, w as isize - 1) as usize;
        let cy = y.clamp(0, h as isize - 1) as usize;
        grid.z[cx * h + cy]
    };
    out.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
        let xi = x as isize;
        for (y, dst) in col.iter_mut().enumerate() {
            let yi = y as isize;
            let dx = (at(xi + 2, yi) - at(xi - 2, yi)) / (4.0 * cell);
            let dy = (at(xi, yi + 2) - at(xi, yi - 2)) / (4.0 * cell);
            let val = dx.hypot(dy).atan() * 180.0 / std::f64::consts::PI;
            if val.is_finite() {
                *dst = val as f32;
            }
        }
    });
    out
}

/// 4-neighbor BFS dilation within Manhattan distance `reach` (`geo-moisture.ts` `nearCells`).
pub fn near_cells(mask: &[u8], width: usize, height: usize, reach: usize) -> Vec<u8> {
    let mut dist = vec![-1i32; width * height];
    let mut queue = Vec::<usize>::with_capacity(width * height);
    for (i, &v) in mask.iter().enumerate() {
        if v != 0 { dist[i] = 0; queue.push(i); }
    }
    let (mut head, reach_i) = (0usize, reach as i32);
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        let d = dist[i];
        if d >= reach_i { continue; }
        let x = i / height;
        let y = i - x * height;
        if x > 0 && dist[i - height] == -1 { dist[i - height] = d + 1; queue.push(i - height); }
        if x + 1 < width && dist[i + height] == -1 { dist[i + height] = d + 1; queue.push(i + height); }
        if y > 0 && dist[i - 1] == -1 { dist[i - 1] = d + 1; queue.push(i - 1); }
        if y + 1 < height && dist[i + 1] == -1 { dist[i + 1] = d + 1; queue.push(i + 1); }
    }
    dist.into_iter().map(|d| u8::from(d >= 0)).collect()
}

fn channel_lines(
    grid: &Grid2m,
    down: &[i32],
    acc: &[f64],
    channel_cells: f64,
    min_length_m: f64,
    blocked: Option<&[u8]>,
) -> Vec<Vec<[f64; 2]>> {
    let is_ch = |i: usize| acc[i] >= channel_cells && blocked.is_none_or(|b| b[i] == 0);
    let n = down.len();
    let mut fed = vec![0u8; n];
    for i in 0..n {
        if is_ch(i) && down[i] >= 0 {
            fed[down[i] as usize] = 1;
        }
    }
    let mut visited = vec![0u8; n];
    let mut lines = Vec::new();
    let point = |i: usize| -> [f64; 2] {
        let x = i / grid.height;
        let y = i - x * grid.height;
        [grid.min_x + x as f64 * grid.cell, grid.min_y + y as f64 * grid.cell]
    };
    for head in 0..n {
        if !is_ch(head) || fed[head] != 0 {
            continue;
        }
        let mut line = Vec::new();
        let mut cur = head as i32;
        while cur >= 0 && is_ch(cur as usize) {
            let cu = cur as usize;
            line.push(point(cu));
            if visited[cu] != 0 {
                break;
            }
            visited[cu] = 1;
            cur = down[cu];
        }
        if line.len() >= 2 && ((line.len() - 1) as f64) * grid.cell >= min_length_m {
            lines.push(simplify(&line, grid.cell * 0.5));
        }
    }
    lines
}

/// 2 m (1-cell 4-neighbor) morphological opening on a column-major binary mask (`x * height + y`),
/// removing 1-cell stairstep spikes and narrow hairlines while respecting `blocked` (water).
fn open_mask_4(mask: &[u8], width: usize, height: usize, blocked: Option<&[u8]>) -> Vec<u8> {
    if width < 3 || height < 3 {
        return mask.to_vec();
    }
    let n = width * height;
    let mut eroded = vec![0u8; n];
    for x in 0..width {
        let base = x * height;
        for y in 0..height {
            let i = base + y;
            if mask[i] == 0 {
                continue;
            }
            let keep = x > 0
                && x + 1 < width
                && y > 0
                && y + 1 < height
                && mask[i - height] != 0
                && mask[i + height] != 0
                && mask[i - 1] != 0
                && mask[i + 1] != 0;
            if keep {
                eroded[i] = 1;
            }
        }
    }
    let mut out = vec![0u8; n];
    for x in 0..width {
        let base = x * height;
        for y in 0..height {
            let i = base + y;
            if blocked.is_some_and(|b| b[i] != 0) {
                continue;
            }
            if eroded[i] != 0
                || (x > 0 && eroded[i - height] != 0)
                || (x + 1 < width && eroded[i + height] != 0)
                || (y > 0 && eroded[i - 1] != 0)
                || (y + 1 < height && eroded[i + 1] != 0)
            {
                out[i] = 1;
            }
        }
    }
    out
}

/// Closed-ring Chaikin corner-cutting (`rounds` passes; ring has no duplicated closing vertex).
fn chaikin_closed(ring: &[[f64; 2]], rounds: usize) -> Vec<[f64; 2]> {
    let mut cur = ring.to_vec();
    for _ in 0..rounds {
        let m = cur.len();
        if m < 3 {
            return cur;
        }
        let mut next = Vec::with_capacity(m * 2);
        for i in 0..m {
            let a = cur[i];
            let b = cur[(i + 1) % m];
            next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
            next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
        }
        cur = next;
    }
    cur
}

/// Closed-ring Douglas–Peucker simplification split at the vertex farthest from `ring[0]`.
fn simplify_closed(ring: &[[f64; 2]], tol: f64) -> Vec<[f64; 2]> {
    let n = ring.len();
    if n <= 4 {
        return ring.to_vec();
    }
    let [x0, y0] = ring[0];
    let mut far = 1usize;
    let mut far_d2 = -1.0f64;
    for (i, &[x, y]) in ring.iter().enumerate().skip(1) {
        let d2 = (x - x0) * (x - x0) + (y - y0) * (y - y0);
        if d2 > far_d2 {
            far_d2 = d2;
            far = i;
        }
    }
    let first = simplify(&ring[..=far], tol);
    let mut second_in = Vec::with_capacity(n - far + 1);
    second_in.extend_from_slice(&ring[far..]);
    second_in.push(ring[0]);
    let second = simplify(&second_in, tol);
    let mut out = Vec::with_capacity(first.len() + second.len());
    out.extend_from_slice(&first);
    if second.len() > 2 {
        out.extend_from_slice(&second[1..second.len() - 1]);
    }
    out
}

/// Suppresses non-shore marsh (`classes[i] = 0`) on `LAB_OPEN`, `LAB_SEMI` (semi-open urban parks/lawns),
/// and drained tall closed-canopy timber (`TALL_DENSE_CANOPY_BIT` in B) from `vegetationsklasser.png`.
fn suppress_open_veg_marsh(
    grid: &Grid2m,
    png_path: &Path,
    pgw_override: Option<&Path>,
    shore: Option<&[u8]>,
    classes: &mut [u8],
) -> Result<(), String> {
    let pgw_path = pgw_override.map_or_else(|| png_path.with_extension("pgw"), Path::to_path_buf);
    let img = read_rgba_png(png_path)?;
    let pgw_text = std::fs::read_to_string(&pgw_path)
        .map_err(|e| format!("Failed reading {}: {e}", pgw_path.display()))?;
    let world = WorldTransform::from_pgw(&pgw_text)?;
    let min_y_center = world.y0 - (img.height as f64 - 1.0) * world.cell;
    let (w, h, cell) = (grid.width, grid.height, grid.cell);

    for col in 0..w {
        let wx = grid.min_x + col as f64 * cell;
        let vcol = js_round((wx - world.x0) / world.cell) as isize;
        if vcol < 0 || (vcol as usize) >= img.width {
            continue;
        }
        let base = col * h;
        for row in 0..h {
            let i = base + row;
            if classes[i] == 0 || shore.is_some_and(|s| s[i] != 0) {
                continue;
            }
            let wy = grid.min_y + row as f64 * cell;
            let row_south = js_round((wy - min_y_center) / world.cell) as isize;
            if row_south < 0 || (row_south as usize) >= img.height {
                continue;
            }
            let off = ((img.height - 1 - row_south as usize) * img.width + vcol as usize) * 4;
            let (r, b, a) = (img.data[off], img.data[off + 2], img.data[off + 3]);
            // Suppress open (`LAB_OPEN`, a=255), semi-open (`LAB_SEMI`, a=SEMI_ALPHA=200),
            // and drained tall closed-canopy spruce (`TALL_DENSE_CANOPY_BIT` in B) outside the 30 m shore buffer.
            if a >= 128 && ((r & 15) == LAB_OPEN || (b & TALL_DENSE_CANOPY_BIT) != 0) {
                classes[i] = 0;
            }
        }
    }
    Ok(())
}

/// Runs the complete moisture pipeline and writes `fukt.png`, `fukt.pgw`, `fuktdjup.png`, `fuktdjup.pgw`, `fukt.dxf`.
pub fn run_moisture(
    ground: &GroundGrid,
    settings: MoistureSettings,
    water: Option<&WaterData>,
    points: Option<&PointStats>,
    veg_png: Option<(&Path, Option<&Path>)>,
    out_dir: &Path,
) -> Result<MoistureResult, String> {
    let grid = downsample_ground_to_2m(ground);
    let (w, h, cell) = (grid.width, grid.height, grid.cell);
    let n = w * h;

    let blocked: Option<Vec<u8>> = water.map(|wd| {
        let mut b = vec![0u8; n];
        b.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
            let wx = grid.min_x + x as f64 * cell;
            for (y, dst) in col.iter_mut().enumerate() {
                let wy = grid.min_y + y as f64 * cell;
                if wd.is_water(wx, wy) {
                    *dst = 1;
                }
            }
        });
        b
    });

    let filled = fill_depressions(&grid, 1e-4);
    let down = flow_directions(&grid, &filled);
    let (acc, order) = flow_accumulation(&down, &filled);
    let channel_cells = js_round(settings.channel_ha * 10_000.0 / (cell * cell)).max(2.0);
    let (hand, slope) = rayon::join(
        || height_above_drainage(&grid, &down, &acc, &order, channel_cells),
        || slope_degrees(&grid),
    );

    let mut classes = vec![0u8; n];
    for i in 0..n {
        let v = hand[i];
        if v.is_nan() {
            continue;
        }
        let steep = slope[i];
        classes[i] = if f64::from(v) <= settings.wet_meters && !(steep > WET_SLOPE_DEGREES) {
            2
        } else if f64::from(v) <= settings.moist_meters && !(steep > MOIST_SLOPE_DEGREES) {
            1
        } else {
            0
        };
    }

    let mut share = vec![255u8; n];
    let shore = blocked.as_ref().map(|b| near_cells(b, w, h, js_round(SHORE_MARSH_METERS / cell) as usize));
    if let Some(pts) = points {
        for col in 0..w {
            let wx = grid.min_x + col as f64 * cell;
            for row in 0..h {
                let wy = grid.min_y + row as f64 * cell;
                if let Some(val) = pts.ground_share_at(wx, wy) {
                    let i = col * h + row;
                    share[i] = js_round(val * 254.0).clamp(0.0, 254.0) as u8;
                    if shore.as_ref().is_none_or(|s| s[i] == 0) {
                        let tall_dense = val <= TALL_TIMBER_MAX_GROUND_SHARE
                            && pts.vegh_at(wx, wy).is_some_and(|vh| vh >= TALL_TIMBER_MIN_VEGH_M);
                        if val >= OPEN_GROUND_SHARE || tall_dense {
                            classes[i] = 0;
                        }
                    }
                }
            }
        }
    }
    if let Some((png_path, pgw_override)) = veg_png {
        suppress_open_veg_marsh(&grid, png_path, pgw_override, shore.as_deref(), &mut classes)?;
    }

    let min_cells = js_round(400.0 / (cell * cell)).max(4.0) as usize;
    let min_hole_cells = js_round(300.0 / (cell * cell)).max(4.0).max(min_cells as f64) as usize;
    let blk_slice = blocked.as_deref();
    let (wet_mask, mut moist_mask) = rayon::join(
        || {
            let mut m: Vec<u8> = classes.iter().map(|&v| u8::from(v == 2)).collect();
            if let Some(b) = blk_slice {
                for i in 0..n {
                    if b[i] != 0 {
                        m[i] = 0;
                    }
                }
            }
            // Keep narrow natural bog corridors connected on `wet_mask` (no 4 m erosion; hole-fill + 2-pass Chaikin smooths edges).
            clean_mask(&m, w, h, min_cells, min_hole_cells, blk_slice)
        },
        || {
            let mut m: Vec<u8> = classes.iter().map(|&v| u8::from(v >= 1)).collect();
            if let Some(b) = blk_slice {
                for i in 0..n {
                    if b[i] != 0 {
                        m[i] = 0;
                    }
                }
            }
            let opened = open_mask_4(&m, w, h, blk_slice);
            clean_mask(&opened, w, h, min_cells, min_hole_cells, blk_slice)
        },
    );
    for i in 0..n {
        if wet_mask[i] != 0 {
            moist_mask[i] = 1;
        }
    }

    let tol = cell * 0.25;
    let line_cells = js_round(settings.channel_line_ha * 10_000.0 / (cell * cell)).max(channel_cells);
    let ((wet_rings, moist_rings), channels) = rayon::join(
        || {
            rayon::join(
                || {
                    mask_rings(&wet_mask, grid.min_x, grid.min_y, cell, w, h)
                        .into_iter()
                        .map(|r| simplify_closed(&chaikin_closed(&r, 2), tol))
                        .filter(|r| r.len() >= 4)
                        .collect::<Vec<_>>()
                },
                || {
                    mask_rings(&moist_mask, grid.min_x, grid.min_y, cell, w, h)
                        .into_iter()
                        .map(|r| simplify_closed(&chaikin_closed(&r, 2), tol))
                        .filter(|r| r.len() >= 4)
                        .collect::<Vec<_>>()
                },
            )
        },
        || channel_lines(&grid, &down, &acc, line_cells, 50.0, blk_slice),
    );

    let has_points = points.is_some();
    let world = world_file_center(grid.min_x, grid.min_y, cell, h);

    // Write fukt.png, fuktdjup.png, and fukt.dxf in parallel.
    let fukt_png_res = std::sync::Mutex::new(Ok(()));
    let depth_png_res = std::sync::Mutex::new(Ok(()));
    let dxf_res = std::sync::Mutex::new(Ok(()));
    rayon::scope(|s| {
        s.spawn(|_| {
            let r = write_sub_png(&out_dir.join("fukt.png"), w, h, |line, row_buf| {
                let y = h - 1 - line;
                for col in 0..w {
                    let i = col * h + y;
                    let o = col * 4;
                    let is_ch = acc[i] >= channel_cells && blk_slice.is_none_or(|b| b[i] == 0);
                    let px = if is_ch {
                        [10, 40, 160, 230]
                    } else if wet_mask[i] != 0 {
                        [40, 110, 230, 170]
                    } else if moist_mask[i] != 0 {
                        [120, 180, 240, 110]
                    } else {
                        [0, 0, 0, 0]
                    };
                    row_buf[o..o + 4].copy_from_slice(&px);
                }
            });
            *fukt_png_res.lock().unwrap() = r;
        });
        s.spawn(|_| {
            let r = write_sub_png(&out_dir.join("fuktdjup.png"), w, h, |line, row_buf| {
                let y = h - 1 - line;
                for col in 0..w {
                    let i = col * h + y;
                    let o = col * 4;
                    let val = hand[i];
                    if !val.is_finite() || blk_slice.is_some_and(|b| b[i] != 0) {
                        row_buf[o..o + 4].fill(0);
                        continue;
                    }
                    let step = js_round(f64::from(val) / DEPTH_STEP_METERS).clamp(0.0, 254.0) as u8;
                    let steep = slope[i];
                    row_buf[o..o + 4].copy_from_slice(&[
                        step,
                        if has_points { share[i] } else { step },
                        if steep.is_finite() { js_round(f64::from(steep) / SLOPE_STEP_DEGREES).clamp(0.0, 254.0) as u8 } else { 255 },
                        255,
                    ]);
                }
            });
            *depth_png_res.lock().unwrap() = r;
        });
        s.spawn(|_| {
            let layers = [
                DxfLayer { name: "blott", closed: true, parts: &wet_rings, points: &[] },
                DxfLayer { name: "fuktigt", closed: true, parts: &moist_rings, points: &[] },
                DxfLayer { name: "fuktstrak", closed: false, parts: &channels, points: &[] },
            ];
            *dxf_res.lock().unwrap() = write_moisture_dxf(&out_dir.join("fukt.dxf"), &layers);
        });
    });
    fukt_png_res.into_inner().unwrap()?;
    depth_png_res.into_inner().unwrap()?;
    dxf_res.into_inner().unwrap()?;
    std::fs::write(out_dir.join("fukt.pgw"), &world)
        .map_err(|e| format!("Failed writing fukt.pgw: {e}"))?;
    std::fs::write(out_dir.join("fuktdjup.pgw"), &world)
        .map_err(|e| format!("Failed writing fuktdjup.pgw: {e}"))?;

    let wet_cnt: usize = wet_mask.iter().map(|&v| v as usize).sum();
    let moist_cnt: usize = moist_mask.iter().map(|&v| v as usize).sum();
    let wet_ha = js_round(wet_cnt as f64 * cell * cell / 100.0) / 100.0;
    let moist_ha = js_round(moist_cnt as f64 * cell * cell / 100.0) / 100.0;
    let wet_areas = wet_rings.iter().filter(|r| ring_area(r) > 0.0).count();
    let moist_areas = moist_rings.iter().filter(|r| ring_area(r) > 0.0).count();

    let wet_mask_1m = ground.mask_of(|x, y| {
        let col = js_round((x - grid.min_x) / cell) as isize;
        let row = js_round((y - grid.min_y) / cell) as isize;
        col >= 0
            && row >= 0
            && (col as usize) < w
            && (row as usize) < h
            && f64::from(hand[col as usize * h + row as usize]) <= settings.moist_meters
    });

    Ok(MoistureResult {
        wet_ha,
        moist_ha,
        wet_areas,
        moist_areas,
        channels: channels.len(),
        wet_mask_1m,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rasters::grid_io::{load_point_stats, POINT_BANDS};
    use crate::vegetation::SEMI_ALPHA;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("otidgeo-moisture-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_points_bin(path: &Path, min_x: f64, min_y: f64, cell: f64, w: usize, h: usize, vegh: f32, gnd_share: f32) {
        let mut f = std::fs::File::create(path).unwrap();
        for v in [min_x, min_y, cell] {
            f.write_all(&v.to_le_bytes()).unwrap();
        }
        for v in [w as u64, h as u64] {
            f.write_all(&v.to_le_bytes()).unwrap();
        }
        let total = 20.0f32;
        let gnd = total * gnd_share;
        let high = total - gnd;
        let cell_vals = [vegh, total, gnd, 0.0, 0.0, high, 4000.0, 0.05];
        assert_eq!(cell_vals.len(), POINT_BANDS);
        for _ in 0..(w * h) {
            for v in cell_vals {
                f.write_all(&v.to_le_bytes()).unwrap();
            }
        }
    }

    #[test]
    fn veg_png_open_semi_and_tall_timber_suppress_non_shore_marsh_when_points_absent() {
        // Flat 100x100 m basin draining gently southward (y = 0) so the flat floor accumulates flow -> HAND <= 0.25 m.
        let (w, h) = (100, 100);
        let mut z = vec![0.0f32; w * h];
        for x in 0..w {
            for y in 0..h {
                let dx = (x as f64 - 50.0).abs();
                // Very gentle valley floor (slope < 1 deg) across x=15..85 so wide marsh forms.
                let cross = if dx <= 35.0 { 0.002 * dx } else { 0.07 + 0.08 * (dx - 35.0) };
                z[x * h + y] = (10.0 + 0.002 * y as f64 + cross) as f32;
            }
        }
        let ground = GroundGrid { min_x: 660_000.0, min_y: 6_570_000.0, cell: 1.0, width: w, height: h, z };
        let settings = MoistureSettings { channel_ha: 0.1, wet_meters: 0.25, moist_meters: 0.4, channel_line_ha: 0.5 };

        let dir = tmp_dir("veg-open-marsh");
        let pgw_text = "2\n0\n0\n-2\n660001\n6570099\n";

        // 1. Regular forest veg PNG (low=2, no tall_dense bit, alpha=255): marsh MUST form.
        let forest_png = dir.join("veg_forest.png");
        write_sub_png(&forest_png, 50, 50, |_r, row| {
            for px in row.chunks_exact_mut(4) {
                px.copy_from_slice(&[2, 160, 2, 255]);
            }
        })
        .unwrap();
        std::fs::write(forest_png.with_extension("pgw"), pgw_text).unwrap();
        let res_forest = run_moisture(&ground, settings, None, None, Some((&forest_png, None)), &dir).unwrap();
        assert!(res_forest.moist_ha > 0.2, "Expected marsh in flat forest basin, got {}", res_forest.moist_ha);

        // 2. Pure LAB_OPEN veg PNG (low=1, alpha=255) without water: non-shore marsh MUST be suppressed!
        let open_png = dir.join("veg_open.png");
        write_sub_png(&open_png, 50, 50, |_r, row| {
            for px in row.chunks_exact_mut(4) {
                px.copy_from_slice(&[LAB_OPEN, 160, LAB_OPEN, 255]);
            }
        })
        .unwrap();
        std::fs::write(open_png.with_extension("pgw"), pgw_text).unwrap();
        let res_open = run_moisture(&ground, settings, None, None, Some((&open_png, None)), &dir).unwrap();
        assert_eq!(res_open.wet_ha, 0.0, "Non-shore LAB_OPEN wet marsh must be suppressed");
        assert_eq!(res_open.moist_ha, 0.0, "Non-shore LAB_OPEN moist marsh must be suppressed");

        // 3. LAB_SEMI veg PNG (low=1, alpha=SEMI_ALPHA=200, urban parks/lawns): non-shore marsh MUST be suppressed!
        let semi_png = dir.join("veg_semi.png");
        write_sub_png(&semi_png, 50, 50, |_r, row| {
            for px in row.chunks_exact_mut(4) {
                px.copy_from_slice(&[LAB_OPEN, 160, LAB_OPEN, SEMI_ALPHA]);
            }
        })
        .unwrap();
        std::fs::write(semi_png.with_extension("pgw"), pgw_text).unwrap();
        let res_semi = run_moisture(&ground, settings, None, None, Some((&semi_png, None)), &dir).unwrap();
        assert_eq!(res_semi.wet_ha, 0.0, "Non-shore LAB_SEMI wet marsh must be suppressed");
        assert_eq!(res_semi.moist_ha, 0.0, "Non-shore LAB_SEMI moist marsh must be suppressed");

        // 4. Tall closed-canopy spruce (`TALL_DENSE_CANOPY_BIT` in B) without water: non-shore marsh MUST be suppressed!
        let tall_png = dir.join("veg_tall.png");
        write_sub_png(&tall_png, 50, 50, |_r, row| {
            for px in row.chunks_exact_mut(4) {
                px.copy_from_slice(&[2, 160, 2 | TALL_DENSE_CANOPY_BIT, 255]);
            }
        })
        .unwrap();
        std::fs::write(tall_png.with_extension("pgw"), pgw_text).unwrap();
        let res_tall = run_moisture(&ground, settings, None, None, Some((&tall_png, None)), &dir).unwrap();
        assert_eq!(res_tall.wet_ha, 0.0, "Non-shore drained tall-spruce wet marsh must be suppressed");
        assert_eq!(res_tall.moist_ha, 0.0, "Non-shore drained tall-spruce moist marsh must be suppressed");

        // 5. Shore buffer (within SHORE_MARSH_METERS = 30 m of water): marsh MUST remain on open, semi, and tall timber!
        let mut wmask = vec![0u8; 50 * 50];
        for x in 0..50 {
            for y in 0..5 {
                wmask[x * 50 + y] = 1;
            }
        }
        let water = WaterData {
            min_x: 660_000.0,
            min_y: 6_570_000.0,
            cell: 2.0,
            width: 50,
            height: 50,
            mask: wmask,
            water_ha: 0.1,
            water_areas: 1,
        };
        let res_shore_open = run_moisture(&ground, settings, Some(&water), None, Some((&open_png, None)), &dir).unwrap();
        assert!(res_shore_open.moist_ha > 0.0, "Shore marsh within 30 m of water must remain on LAB_OPEN");
        let res_shore_tall = run_moisture(&ground, settings, Some(&water), None, Some((&tall_png, None)), &dir).unwrap();
        assert!(res_shore_tall.moist_ha > 0.0, "Shore marsh within 30 m of water must remain under tall canopy");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tighter_slope_caps_points_tall_timber_and_smooth_hole_free_masks() {
        assert!((WET_SLOPE_DEGREES - 3.0).abs() < 1e-6);
        assert!((MOIST_SLOPE_DEGREES - 4.0).abs() < 1e-6);

        let dir = tmp_dir("slope-points-holes");
        let (w, h) = (100, 100);
        let settings = MoistureSettings { channel_ha: 0.1, wet_meters: 0.25, moist_meters: 0.4, channel_line_ha: 0.5 };

        // 1. 4.5 deg inclined plane (> 4.0 deg MOIST_SLOPE_DEGREES, < old 6.0 deg): must emit 0 marsh!
        let tan45 = (4.5_f64).to_radians().tan();
        let mut z_sloped = vec![0.0f32; w * h];
        for x in 0..w {
            for y in 0..h {
                let dx = (x as f64 - 50.0).abs();
                z_sloped[x * h + y] = (10.0 + y as f64 * tan45 + 0.002 * dx) as f32;
            }
        }
        let g_sloped = GroundGrid { min_x: 660_000.0, min_y: 6_570_000.0, cell: 1.0, width: w, height: h, z: z_sloped };
        let res_sloped = run_moisture(&g_sloped, settings, None, None, None, &dir).unwrap();
        assert_eq!(res_sloped.wet_ha, 0.0, "4.5 deg slope must not form wet marsh (>3.0 deg)");
        assert_eq!(res_sloped.moist_ha, 0.0, "4.5 deg slope must not form moist marsh (>4.0 deg)");

        // 2. Flat basin with PointStats (`punkter.bin`): drained tall spruce (vegh=18.4 m, gnd=0.20) suppresses marsh,
        //    whereas wooded bog (vegh=16.5 m, gnd=0.35) keeps marsh!
        let mut z_flat = vec![0.0f32; w * h];
        for x in 0..w {
            for y in 0..h {
                let dx = (x as f64 - 50.0).abs();
                let cross = if dx <= 35.0 { 0.002 * dx } else { 0.07 + 0.08 * (dx - 35.0) };
                z_flat[x * h + y] = (10.0 + 0.002 * y as f64 + cross) as f32;
            }
        }
        let g_flat = GroundGrid { min_x: 660_000.0, min_y: 6_570_000.0, cell: 1.0, width: w, height: h, z: z_flat.clone() };
        let pts_tall_path = dir.join("punkter_tall.bin");
        write_points_bin(&pts_tall_path, 660_000.0, 6_570_000.0, 2.0, 50, 50, 18.4, 0.20);
        let pts_tall = load_point_stats(&[&pts_tall_path]).unwrap();
        let res_pts_tall = run_moisture(&g_flat, settings, None, Some(&pts_tall), None, &dir).unwrap();
        assert_eq!(res_pts_tall.wet_ha, 0.0, "PointStats tall dense spruce must suppress wet marsh");
        assert_eq!(res_pts_tall.moist_ha, 0.0, "PointStats tall dense spruce must suppress moist marsh");

        let pts_bog_path = dir.join("punkter_bog.bin");
        write_points_bin(&pts_bog_path, 660_000.0, 6_570_000.0, 2.0, 50, 50, 16.5, 0.35);
        let pts_bog = load_point_stats(&[&pts_bog_path]).unwrap();
        let res_pts_bog = run_moisture(&g_flat, settings, None, Some(&pts_bog), None, &dir).unwrap();
        assert!(res_pts_bog.moist_ha > 0.2, "Wooded bog (vegh=16.5, gnd=0.35) must keep marsh, got {}", res_pts_bog.moist_ha);

        // 3. Interior small dry bump (< 300 m², 6x6 m = 36 m² elevated by +2 m) inside flat basin:
        //    hole filling must eliminate the tiny interior hole, and Chaikin smoothing must round corners.
        for x in 47..53 {
            for y in 47..53 {
                z_flat[x * h + y] += 2.0;
            }
        }
        let g_hole = GroundGrid { min_x: 660_000.0, min_y: 6_570_000.0, cell: 1.0, width: w, height: h, z: z_flat };
        let res_hole = run_moisture(&g_hole, settings, None, None, None, &dir).unwrap();
        assert!(res_hole.moist_areas >= 1);
        let dxf = std::fs::read_to_string(dir.join("fukt.dxf")).unwrap();
        let moist_polys = dxf.matches("\n8\nfuktigt\n66\n1\n70\n1").count();
        assert_eq!(moist_polys, res_hole.moist_areas, "Small <300 m² interior dry hole must be filled (no hole ring in fukt.dxf)");

        // 4. Verify Chaikin + simplify_closed removes 90-degree corners from a square ring.
        let sq = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        let smooth_sq = simplify_closed(&chaikin_closed(&sq, 2), 0.5);
        assert!(smooth_sq.len() >= 8, "Chaikin-smoothed square must have rounded corners, got {} verts", smooth_sq.len());
        let m = smooth_sq.len();
        for i in 0..m {
            let p0 = smooth_sq[(i + m - 1) % m];
            let p1 = smooth_sq[i];
            let p2 = smooth_sq[(i + 1) % m];
            let dx1 = p1[0] - p0[0];
            let dy1 = p1[1] - p0[1];
            let dx2 = p2[0] - p1[0];
            let dy2 = p2[1] - p1[1];
            let deg = ((dx1 * dx2 + dy1 * dy2) / (dx1.hypot(dy1) * dx2.hypot(dy2))).clamp(-1.0, 1.0).acos().to_degrees();
            assert!(deg < 60.0, "Expected smooth Chaikin corner < 60 deg, got {deg:.1} deg");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
