//! Clean-room MIT ditch & terrain-channel extraction (`scripts/geo-ditches.ts` `ditchLines`).

use crate::rasters::geom::simplify;
use crate::rasters::grid_io::{js_round, GroundGrid};
use crate::rasters::skeleton::{paths, thin};
use rayon::prelude::*;

const DITCH_DEPTH: f64 = 0.3;
const DITCH_MAX_WIDTH: f64 = 4.0;
const DITCH_MIN_LENGTH: f64 = 15.0;
const DITCH_STRAIGHT: f64 = 0.85;
const DITCH_MAX_NETWORK_CELLS: usize = 20_000;

fn line_length(points: &[[f64; 2]]) -> f64 {
    let mut sum = 0.0f64;
    for k in 1..points.len() {
        sum += (points[k][0] - points[k - 1][0]).hypot(points[k][1] - points[k - 1][1]);
    }
    sum
}

fn integral_u8(values: &[u8], width: usize, height: usize) -> Vec<u32> {
    let stride = height + 1;
    let mut table = vec![0u32; (width + 1) * stride];
    for x in 0..width {
        let src = x * height;
        let dst = (x + 1) * stride;
        let left = x * stride;
        for y in 0..height {
            table[dst + y + 1] = u32::from(values[src + y]) + table[left + y + 1] + table[dst + y] - table[left + y];
        }
    }
    table
}

#[inline]
fn box_sum_u32(table: &[u32], width: usize, height: usize, x: usize, y: usize, reach: usize) -> u32 {
    let stride = height + 1;
    let x0 = x.saturating_sub(reach);
    let x1 = (x + reach + 1).min(width);
    let y0 = y.saturating_sub(reach);
    let y1 = (y + reach + 1).min(height);
    (table[x1 * stride + y1] + table[x0 * stride + y0]) - table[x0 * stride + y1] - table[x1 * stride + y0]
}

/// Extracts ditches (`dike`) and terrain channels (`fuktstrak_terrang`) from 4 m local relief.
pub fn ditch_lines(
    ground: &GroundGrid,
    relief: &[f32],
    wet_mask: Option<&[u8]>,
    water_mask: Option<&[u8]>,
) -> (Vec<Vec<[f64; 2]>>, Vec<Vec<[f64; 2]>>) {
    let (w, h, cell) = (ground.width, ground.height, ground.cell);
    let side = (DITCH_MAX_WIDTH / 2.0 / cell).ceil().max(1.0) as isize;
    let wi = w as isize;
    let hi = h as isize;
    let at = |x: isize, y: isize| -> f64 {
        if x < 0 || y < 0 || x >= wi || y >= hi {
            f64::NAN
        } else {
            f64::from(ground.z[x as usize * h + y as usize])
        }
    };

    let mut mask = vec![0u8; w * h];
    mask.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
        let xi = x as isize;
        let base = x * h;
        for (y, dst) in col.iter_mut().enumerate() {
            let i = base + y;
            if !(f64::from(relief[i]) < -DITCH_DEPTH / 2.0) {
                continue;
            }
            if water_mask.is_some_and(|wm| wm[i] != 0) {
                continue;
            }
            let here = f64::from(ground.z[i]);
            if !here.is_finite() {
                continue;
            }
            let yi = y as isize;
            let thresh = here + DITCH_DEPTH;
            let dirs = [(1isize, 0isize), (0, 1), (1, 1), (1, -1)];
            let valley = dirs.iter().any(|&(dx, dy)| {
                at(xi + dx * side, yi + dy * side) > thresh && at(xi - dx * side, yi - dy * side) > thresh
            });
            if valley {
                *dst = 1;
            }
        }
    });

    let half = (DITCH_MAX_WIDTH / 2.0 / cell).ceil().max(1.0) as usize;
    let table = integral_u8(&mask, w, h);
    let mut eroded = vec![0u8; w * h];
    eroded.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
        let dx_len = (x + half + 1).min(w) - x.saturating_sub(half);
        let base = x * h;
        for (y, dst) in col.iter_mut().enumerate() {
            if mask[base + y] == 0 {
                continue;
            }
            let dy_len = (y + half + 1).min(h) - y.saturating_sub(half);
            if box_sum_u32(&table, w, h, x, y, half) == (dx_len * dy_len) as u32 {
                *dst = 1;
            }
        }
    });
    let wide = integral_u8(&eroded, w, h);
    mask.par_chunks_mut(h).enumerate().for_each(|(x, col)| {
        for (y, dst) in col.iter_mut().enumerate() {
            if *dst != 0 && box_sum_u32(&wide, w, h, x, y, half) > 0 {
                *dst = 0;
            }
        }
    });

    let skeleton = thin(&mask, w, h);
    let min_cells = js_round(DITCH_MIN_LENGTH / cell / std::f64::consts::SQRT_2).max(3.0) as usize;
    let mut ditches = Vec::new();
    let mut terrain_channels = Vec::new();

    for path in paths(&skeleton, w, h, min_cells, DITCH_MAX_NETWORK_CELLS) {
        let points: Vec<[f64; 2]> = path
            .iter()
            .map(|&i| {
                let x = i / h;
                ground.cell_center(x, i - x * h)
            })
            .collect();
        let len = line_length(&points);
        if len < DITCH_MIN_LENGTH {
            continue;
        }
        let Some(wm) = wet_mask else {
            continue;
        };
        let wet_cnt = points.iter().filter(|&&[px, py]| ground.lookup_mask(wm, px, py)).count();
        if wet_cnt * 2 < points.len() {
            continue;
        }
        let first = points[0];
        let last = *points.last().unwrap();
        let chord = (last[0] - first[0]).hypot(last[1] - first[1]);
        let simp = simplify(&points, cell * 0.75);
        if chord / len >= DITCH_STRAIGHT {
            ditches.push(simp);
        } else {
            terrain_channels.push(simp);
        }
    }
    (ditches, terrain_channels)
}
