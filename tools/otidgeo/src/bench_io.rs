//! Benchmark-map I/O (`otidgeo bench-map --dir <map_dir>`).
//!
//! Reads O-Tid's pre-exported benchmark rasters (`hojd.png`, `lasveg.png`,
//! `lasmark.png`, `laskron.png`, `fuktdjup.png` + `.pgw` world files) and
//! constructs the exact same `DemGrid` and `VegFeatures` structures produced
//! by the LiDAR reader.

use crate::types::{DemGrid, VegFeatures, WorldTransform};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

/// Decoded RGBA8 PNG image.
pub struct RgbaImage {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

/// Reads any 8-bit PNG (RGB, RGBA, Gray, GrayAlpha) and normalizes to RGBA8.
pub fn read_rgba_png(path: &Path) -> Result<RgbaImage, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    let mut decoder = png::Decoder::new(BufReader::new(file));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("Failed to decode PNG header {}: {e}", path.display()))?;
    let mut buf = vec![0u8; reader.output_buffer_size().ok_or("PNG buffer size overflow")?];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|e| format!("Failed to decode PNG frame {}: {e}", path.display()))?;
    let src = &buf[..info.buffer_size()];
    let w = info.width as usize;
    let h = info.height as usize;
    let mut rgba = vec![0u8; w * h * 4];
    match info.color_type {
        png::ColorType::Rgba => rgba.copy_from_slice(src),
        png::ColorType::Rgb => {
            for (dst, px) in rgba.chunks_exact_mut(4).zip(src.chunks_exact(3)) {
                dst[0] = px[0];
                dst[1] = px[1];
                dst[2] = px[2];
                dst[3] = 255;
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for (dst, px) in rgba.chunks_exact_mut(4).zip(src.chunks_exact(2)) {
                dst[0] = px[0];
                dst[1] = px[0];
                dst[2] = px[0];
                dst[3] = px[1];
            }
        }
        png::ColorType::Grayscale => {
            for (dst, &g) in rgba.chunks_exact_mut(4).zip(src.iter()) {
                dst[0] = g;
                dst[1] = g;
                dst[2] = g;
                dst[3] = 255;
            }
        }
        other => return Err(format!("Unsupported PNG color type {other:?} in {}", path.display())),
    }
    Ok(RgbaImage { width: w, height: h, data: rgba })
}

/// Writes an RGBA8 PNG image to disk (fast compression for speed).
pub fn write_rgba_png(path: &Path, width: usize, height: usize, data: &[u8]) -> Result<(), String> {
    let file = File::create(path).map_err(|e| format!("Failed to create {}: {e}", path.display()))?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width as u32, height as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|e| format!("PNG header error: {e}"))?;
    writer.write_image_data(data).map_err(|e| format!("PNG write error: {e}"))
}

fn read_world(path: &Path) -> Result<WorldTransform, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read world file {}: {e}", path.display()))?;
    WorldTransform::from_pgw(&text)
}

#[inline]
fn sample_rgba<'a>(img: &'a RgbaImage, w: &WorldTransform, x: f64, y: f64) -> Option<&'a [u8]> {
    let col = w.x_to_col_f(x).round() as isize;
    let row = w.y_to_row_f(y).round() as isize;
    if col < 0 || row < 0 || (col as usize) >= img.width || (row as usize) >= img.height {
        return None;
    }
    let off = (row as usize * img.width + col as usize) * 4;
    Some(&img.data[off..off + 4])
}

/// Loads `DemGrid` (1 m) and `VegFeatures` (2 m) from a benchmark map directory.
pub fn load_bench_map(dir: &Path) -> Result<(DemGrid, VegFeatures), String> {
    let hojd = read_rgba_png(&dir.join("hojd.png"))?;
    let hojd_w = read_world(&dir.join("hojd.pgw"))?;

    let lasveg = read_rgba_png(&dir.join("lasveg.png"))?;
    let lasveg_w = read_world(&dir.join("lasveg.pgw"))?;
    let lasmark = read_rgba_png(&dir.join("lasmark.png"))?;
    let lasmark_w = read_world(&dir.join("lasmark.pgw"))?;
    let laskron = read_rgba_png(&dir.join("laskron.png"))?;
    let laskron_w = read_world(&dir.join("laskron.pgw"))?;
    let fukt_path = dir.join("fuktdjup.png");
    let fukt = if fukt_path.exists() {
        Some((read_rgba_png(&fukt_path)?, read_world(&dir.join("fuktdjup.pgw"))?))
    } else {
        None
    };

    // Build 1 m DEM from hojd.png: ((R*65536 + G*256 + B) - 10000) / 100.0, alpha==0 -> NaN.
    let n1 = hojd.width * hojd.height;
    let mut z = vec![f32::NAN; n1];
    let mut valid1 = vec![0u8; n1];
    let mut water1 = vec![0u8; n1];
    let mut wet1 = vec![0u8; n1];
    for row in 0..hojd.height {
        let y = hojd_w.row_to_y(row as f64);
        for col in 0..hojd.width {
            let i = row * hojd.width + col;
            let px = &hojd.data[i * 4..i * 4 + 4];
            let x = hojd_w.col_to_x(col as f64);
            let fpx = fukt.as_ref().and_then(|(img, fw)| sample_rgba(img, fw, x, y));
            if px[3] >= 128 {
                let raw = (px[0] as i64) * 65536 + (px[1] as i64) * 256 + (px[2] as i64) - 10_000;
                z[i] = (raw as f64 / 100.0) as f32;
                valid1[i] = 1;
                if let Some(fp) = fpx {
                    if fp[3] >= 128 {
                        let hand_m = fp[0] as f32 * 0.02;
                        let slope_ok = fp[2] >= 255 || (fp[2] as f32 * 0.1) <= 6.0;
                        if hand_m <= 0.40 && slope_ok {
                            wet1[i] = 1;
                        }
                    }
                }
            } else {
                // Distinguish water from minor building holes: water has transparent fuktdjup & lasveg.
                let veg_empty = sample_rgba(&lasveg, &lasveg_w, x, y).is_none_or(|p| p[3] < 128);
                let fukt_empty = fukt.is_some() && fpx.is_none_or(|p| p[3] < 128);
                if veg_empty && fukt_empty {
                    water1[i] = 1;
                }
            }
        }
    }

    let dem = DemGrid {
        width: hojd.width,
        height: hojd.height,
        world: hojd_w,
        z,
        valid: valid1,
        water: water1,
        wet: wet1,
    };

    // Align 2 m vegetation grid to exact 2 m half-pixel centers covering hojd.png
    // (matches O-Tid's labels.pgw alignment: x0 = hojd.x0 + 0.5, y0 = hojd.y0 - 0.5).
    let w2 = (hojd.width / 2).max(1);
    let h2 = (hojd.height / 2).max(1);
    let veg_w = WorldTransform {
        cell: hojd_w.cell * 2.0,
        x0: hojd_w.x0 + 0.5 * hojd_w.cell,
        y0: hojd_w.y0 - 0.5 * hojd_w.cell,
    };
    let n2 = w2 * h2;
    let mut valid = vec![0u8; n2];
    let mut water = vec![0u8; n2];
    let mut vegh = vec![0.0f32; n2];
    let mut ground_share = vec![0.0f32; n2];
    let mut low_share = vec![0.0f32; n2];
    let mut mid_share = vec![0.0f32; n2];
    let mut high_share = vec![0.0f32; n2];
    let mut return_ratio = vec![0.0f32; n2];
    let mut npts = vec![0.0f32; n2];
    let mut ground_intensity = vec![0.0f32; n2];
    let mut spread = vec![0.0f32; n2];
    let mut slope_deg = vec![f32::NAN; n2];

    for row in 0..h2 {
        let y = veg_w.row_to_y(row as f64);
        for col in 0..w2 {
            let x = veg_w.col_to_x(col as f64);
            let i = row * w2 + col;
            let vpx = sample_rgba(&lasveg, &lasveg_w, x, y);
            let fpx = fukt.as_ref().and_then(|(img, fw)| sample_rgba(img, fw, x, y));

            if let Some(p) = fpx {
                if p[3] >= 128 && p[2] < 255 {
                    slope_deg[i] = p[2] as f32 * 0.1;
                }
            }

            let veg_ok = vpx.is_some_and(|p| p[3] >= 128);
            let fukt_missing = fukt.is_some() && fpx.is_none_or(|p| p[3] < 128);
            if !veg_ok {
                if fukt_missing {
                    water[i] = 1;
                }
                continue;
            }
            let vp = vpx.unwrap();
            valid[i] = 1;
            vegh[i] = vp[0] as f32 * 0.2;
            ground_share[i] = vp[1] as f32 / 255.0;
            mid_share[i] = vp[2] as f32 / 255.0;
            return_ratio[i] = (1.0 - ground_share[i]).clamp(0.0, 1.0);

            if let Some(mp) = sample_rgba(&lasmark, &lasmark_w, x, y) {
                if mp[3] >= 128 {
                    low_share[i] = mp[0] as f32 / 255.0;
                    ground_intensity[i] = mp[1] as f32 * 64.0;
                    spread[i] = if mp[2] < 255 { mp[2] as f32 / 100.0 } else { 0.0 };
                }
            }
            if let Some(kp) = sample_rgba(&laskron, &laskron_w, x, y) {
                if kp[3] >= 128 {
                    high_share[i] = kp[0] as f32 / 255.0;
                    npts[i] = kp[1] as f32;
                }
            }
            if fukt_missing && dem.sample_bilinear(x, y).is_none() {
                water[i] = 1;
                valid[i] = 0;
            }
        }
    }

    let veg = VegFeatures {
        width: w2,
        height: h2,
        world: veg_w,
        valid,
        water,
        vegh,
        ground_share,
        low_share,
        mid_share,
        high_share,
        return_ratio,
        npts,
        ground_intensity,
        spread,
        slope_deg,
    };

    Ok((dem, veg))
}
