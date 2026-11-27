//! Compact, O-Tid-compatible ASCII DXF writer (`LWPOLYLINE` + `POINT`).
//!
//! Writes clean minimal R14-style ASCII DXF with `$EXTMIN`/`$EXTMAX` header,
//! group 8 layer names (`contour`, `contour_index`, `depression`,
//! `depression_index`, `formline`, `dotknoll`, `dotknoll_avlang`, `udepression`),
//! group 38 elevation, group 50 rotation (degrees CCW from East for `dotknoll_avlang`),
//! group 70 closed flag, and centimeter-precision coordinates.

use crate::types::{ContourLine, KnollPoint};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

fn write_header<W: Write>(w: &mut W, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> std::io::Result<()> {
    writeln!(w, "0\nSECTION\n2\nHEADER")?;
    if min_x.is_finite() && max_x.is_finite() {
        writeln!(w, "9\n$EXTMIN\n10\n{min_x:.2}\n20\n{min_y:.2}")?;
        writeln!(w, "9\n$EXTMAX\n10\n{max_x:.2}\n20\n{max_y:.2}")?;
    }
    writeln!(w, "0\nENDSEC\n0\nSECTION\n2\nENTITIES")
}

/// Writes contour or formline polylines as compact `LWPOLYLINE` entities.
pub fn write_contours_dxf(path: &Path, lines: &[ContourLine]) -> std::io::Result<()> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for line in lines {
        for &[x, y] in &line.points {
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }

    let file = File::create(path)?;
    let mut w = BufWriter::with_capacity(256 * 1024, file);
    write_header(&mut w, min_x, min_y, max_x, max_y)?;

    for line in lines {
        let pts = if line.closed && line.points.len() > 2 {
            let first = line.points[0];
            let last = *line.points.last().unwrap();
            if (first[0] - last[0]).hypot(first[1] - last[1]) < 1e-4 {
                &line.points[..line.points.len() - 1]
            } else {
                &line.points[..]
            }
        } else {
            &line.points[..]
        };
        let min_pts = if line.closed { 3 } else { 2 };
        if pts.len() < min_pts {
            continue;
        }
        let layer = line.layer.dxf_name();
        let flag = if line.closed { 1 } else { 0 };
        writeln!(
            w,
            "0\nLWPOLYLINE\n8\n{layer}\n38\n{:.2}\n90\n{}\n70\n{flag}",
            line.elevation,
            pts.len()
        )?;
        for &[x, y] in pts {
            writeln!(w, "10\n{x:.2}\n20\n{y:.2}")?;
        }
    }

    writeln!(w, "0\nENDSEC\n0\nEOF")?;
    w.flush()
}

/// Writes knoll (`dotknoll`, `dotknoll_avlang`) and pit (`udepression`) points as DXF `POINT` entities.
/// For elongated knolls (`dotknoll_avlang`), writes DXF group `50` as major-axis degrees CCW from East `[0, 180)`.
pub fn write_knolls_dxf(path: &Path, knolls: &[KnollPoint]) -> std::io::Result<()> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for k in knolls {
        min_x = min_x.min(k.x);
        min_y = min_y.min(k.y);
        max_x = max_x.max(k.x);
        max_y = max_y.max(k.y);
    }

    let file = File::create(path)?;
    let mut w = BufWriter::with_capacity(64 * 1024, file);
    write_header(&mut w, min_x, min_y, max_x, max_y)?;

    for k in knolls {
        writeln!(
            w,
            "0\nPOINT\n8\n{}\n10\n{:.2}\n20\n{:.2}\n30\n{:.2}",
            k.dxf_layer(),
            k.x,
            k.y,
            k.z
        )?;
        if let Some(ang) = k.angle_deg {
            writeln!(w, "50\n{:.1}", ang.rem_euclid(180.0))?;
        }
    }

    writeln!(w, "0\nENDSEC\n0\nEOF")?;
    w.flush()
}
