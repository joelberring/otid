//! `otidgeo` — Clean-room MIT Rust terrain, contour, formline, and vegetation engine for O-Tid.
//!
//! Subcommands:
//! - `otidgeo run --input <file.laz|.las> [--input ...] --out <dir> [flags]`
//! - `otidgeo veg --input <file.laz|.las> [--input ...] --out <dir> [veg flags]`
//! - `otidgeo rasters --ground <mark.bin> --out <dir> [raster flags]`
//! - `otidgeo bench-map --dir <map_dir> --out <dir> [flags]`

mod bench_io;
mod cli;
mod contours;
mod dem;
mod dxf;
mod formlines;
mod geometry;
mod knolls;
mod lidar;
mod overview;
mod rasters;
mod types;
mod vegetation;

use crate::bench_io::load_bench_map;
use crate::cli::{parse_args, CliArgs, Mode};
use crate::contours::extract_contours;
use crate::dem::{compute_slope_2m_fast, prepare_dem, sample_slope_to_2m};
use crate::dxf::{write_contours_dxf, write_knolls_dxf};
use crate::formlines::extract_formlines;
use crate::knolls::detect_knolls_and_pits;
use crate::lidar::ingest_lidar;
use crate::overview::write_overview;
use crate::types::{ContourLayer, KnollKind, RunSummary};
use crate::vegetation::{classify_vegetation, write_vegetation_png};
use std::process::ExitCode;
use std::time::Instant;

fn execute(cli: CliArgs) -> Result<RunSummary, String> {
    let t_total = Instant::now();
    std::fs::create_dir_all(&cli.out_dir)
        .map_err(|e| format!("Failed to create output directory {}: {e}", cli.out_dir.display()))?;

    let round1 = |v: f64| (v * 10.0).round() / 10.0;

    // Fast path: `otidgeo veg` skips full DEM smoothing, contours, formlines, knolls, and overview.
    if let Mode::Veg { inputs } = cli.mode {
        let t_io = Instant::now();
        let (dem_raw, mut veg_feat, points_read) = ingest_lidar(&inputs, cli.config.bbox)?;
        let ms_lidar = t_io.elapsed().as_secs_f64() * 1000.0;

        let t_veg = Instant::now();
        veg_feat.slope_deg = compute_slope_2m_fast(
            &dem_raw.z,
            dem_raw.width,
            dem_raw.height,
            &dem_raw.world,
            veg_feat.width,
            veg_feat.height,
            &veg_feat.world,
        );
        let area_ha = (dem_raw.width as f64 * dem_raw.height as f64 * dem_raw.world.cell * dem_raw.world.cell) / 10_000.0;
        let (dem_w, dem_h, dem_cell) = (dem_raw.width, dem_raw.height, dem_raw.world.cell);
        drop(dem_raw);

        let veg_res = classify_vegetation(&veg_feat, &cli.config);
        write_vegetation_png(&cli.out_dir, &veg_res)?;
        let ms_vegetation = t_veg.elapsed().as_secs_f64() * 1000.0;
        let ms_total = t_total.elapsed().as_secs_f64() * 1000.0;

        let summary = RunSummary {
            mode: "veg".to_string(),
            profile: cli.config.profile,
            area_ha: (area_ha * 100.0).round() / 100.0,
            dem_width: dem_w,
            dem_height: dem_h,
            dem_cell_m: dem_cell,
            points_read,
            contour_interval_m: cli.config.interval,
            contours: 0,
            index_contours: 0,
            depressions: 0,
            contour_vertices: 0,
            formlines: 0,
            formline_vertices: 0,
            knolls: 0,
            elongated_knolls: 0,
            pits: 0,
            veg_ha_white: veg_res.ha_white,
            veg_ha_open: veg_res.ha_open,
            veg_ha_semi: veg_res.ha_semi,
            veg_ha_green406: veg_res.ha_green406,
            veg_ha_green408: veg_res.ha_green408,
            veg_ha_green410: veg_res.ha_green410,
            veg_ha_undergrowth407: veg_res.ha_und407,
            veg_ha_undergrowth409: veg_res.ha_und409,
            ms_lidar: round1(ms_lidar),
            ms_dem: 0.0,
            ms_contours: 0.0,
            ms_formlines: 0.0,
            ms_vegetation: round1(ms_vegetation),
            ms_overview: 0.0,
            ms_total: round1(ms_total),
        };
        let json = serde_json::to_string_pretty(&summary)
            .map_err(|e| format!("Failed serializing summary.json: {e}"))?;
        std::fs::write(cli.out_dir.join("summary.json"), format!("{json}\n"))
            .map_err(|e| format!("Failed writing summary.json: {e}"))?;
        return Ok(summary);
    }

    let t_io = Instant::now();
    let (mode_name, dem_raw, mut veg_feat, points_read) = match cli.mode {
        Mode::Run { inputs } => {
            let (d, v, pts) = ingest_lidar(&inputs, cli.config.bbox)?;
            ("run".to_string(), d, v, pts)
        }
        Mode::BenchMap { dir } => {
            let (d, v) = load_bench_map(&dir)?;
            ("bench-map".to_string(), d, v, 0)
        }
        Mode::Veg { .. } | Mode::Rasters(_) => unreachable!(),
    };
    let ms_lidar = t_io.elapsed().as_secs_f64() * 1000.0;

    let t_dem = Instant::now();
    let prepared = prepare_dem(&dem_raw, &cli.config);
    drop(dem_raw);
    if veg_feat.slope_deg.iter().any(|v| !v.is_finite()) {
        let slope2 = sample_slope_to_2m(
            &prepared.slope_deg,
            prepared.width,
            prepared.height,
            &prepared.world,
            veg_feat.width,
            veg_feat.height,
            &veg_feat.world,
        );
        for (dst, src) in veg_feat.slope_deg.iter_mut().zip(slope2.iter()) {
            if !dst.is_finite() {
                *dst = *src;
            }
        }
    }
    let ms_dem = t_dem.elapsed().as_secs_f64() * 1000.0;

    let t_contours = Instant::now();
    let (contours_vec, promoted_knolls) = extract_contours(&prepared, &cli.config);
    write_contours_dxf(&cli.out_dir.join("kurvor.dxf"), &contours_vec)
        .map_err(|e| format!("Failed writing kurvor.dxf: {e}"))?;
    let ms_contours = t_contours.elapsed().as_secs_f64() * 1000.0;

    let t_form = Instant::now();
    let formlines_vec = extract_formlines(&prepared, &contours_vec, &cli.config);
    write_contours_dxf(&cli.out_dir.join("formlinjer.dxf"), &formlines_vec)
        .map_err(|e| format!("Failed writing formlinjer.dxf: {e}"))?;
    let knolls_vec = detect_knolls_and_pits(
        &prepared,
        &contours_vec,
        &formlines_vec,
        &promoted_knolls,
        &cli.config,
    );
    write_knolls_dxf(&cli.out_dir.join("knollar.dxf"), &knolls_vec)
        .map_err(|e| format!("Failed writing knollar.dxf: {e}"))?;
    let ms_formlines = t_form.elapsed().as_secs_f64() * 1000.0;

    let t_veg = Instant::now();
    let veg_res = classify_vegetation(&veg_feat, &cli.config);
    write_vegetation_png(&cli.out_dir, &veg_res)?;
    let ms_vegetation = t_veg.elapsed().as_secs_f64() * 1000.0;

    let t_ov = Instant::now();
    if cli.config.overview {
        write_overview(
            &cli.out_dir,
            &prepared,
            &veg_feat,
            &veg_res,
            &contours_vec,
            &formlines_vec,
            &knolls_vec,
        )?;
    }
    let ms_overview = if cli.config.overview { t_ov.elapsed().as_secs_f64() * 1000.0 } else { 0.0 };
    let ms_total = t_total.elapsed().as_secs_f64() * 1000.0;

    let index_contours = contours_vec
        .iter()
        .filter(|l| matches!(l.layer, ContourLayer::ContourIndex | ContourLayer::DepressionIndex))
        .count();
    let depressions = contours_vec
        .iter()
        .filter(|l| matches!(l.layer, ContourLayer::Depression | ContourLayer::DepressionIndex))
        .count();
    let contour_vertices: usize = contours_vec.iter().map(|l| l.points.len()).sum();
    let formline_vertices: usize = formlines_vec.iter().map(|l| l.points.len()).sum();
    let knolls = knolls_vec.iter().filter(|k| !k.is_depression()).count();
    let elongated_knolls = knolls_vec.iter().filter(|k| k.kind == KnollKind::Elongated).count();
    let pits = knolls_vec.iter().filter(|k| k.is_depression()).count();
    let area_ha = (prepared.width as f64 * prepared.height as f64 * prepared.world.cell * prepared.world.cell) / 10_000.0;

    let summary = RunSummary {
        mode: mode_name,
        profile: cli.config.profile,
        area_ha: (area_ha * 100.0).round() / 100.0,
        dem_width: prepared.width,
        dem_height: prepared.height,
        dem_cell_m: prepared.world.cell,
        points_read,
        contour_interval_m: cli.config.interval,
        contours: contours_vec.len(),
        index_contours,
        depressions,
        contour_vertices,
        formlines: formlines_vec.len(),
        formline_vertices,
        knolls,
        elongated_knolls,
        pits,
        veg_ha_white: veg_res.ha_white,
        veg_ha_open: veg_res.ha_open,
        veg_ha_semi: veg_res.ha_semi,
        veg_ha_green406: veg_res.ha_green406,
        veg_ha_green408: veg_res.ha_green408,
        veg_ha_green410: veg_res.ha_green410,
        veg_ha_undergrowth407: veg_res.ha_und407,
        veg_ha_undergrowth409: veg_res.ha_und409,
        ms_lidar: round1(ms_lidar),
        ms_dem: round1(ms_dem),
        ms_contours: round1(ms_contours),
        ms_formlines: round1(ms_formlines),
        ms_vegetation: round1(ms_vegetation),
        ms_overview: round1(ms_overview),
        ms_total: round1(ms_total),
    };

    let json = serde_json::to_string_pretty(&summary)
        .map_err(|e| format!("Failed serializing summary.json: {e}"))?;
    std::fs::write(cli.out_dir.join("summary.json"), format!("{json}\n"))
        .map_err(|e| format!("Failed writing summary.json: {e}"))?;
    Ok(summary)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cli = match parse_args(&args) {
        Ok(c) => c,
        Err(err) => { eprintln!("otidgeo error: {err}"); return ExitCode::FAILURE; }
    };
    if let Mode::Rasters(cfg) = cli.mode {
        return match crate::rasters::execute_rasters(&cfg) {
            Ok(s) => {
                println!("otidgeo rasters: wet {:.2} ha, cliffs {}/{}, ditches {}, tracks {}, boulders {}, knolls {}, rock {}, {:.0} ms total",
                    s.wet_ha, s.cliffs201, s.cliffs202, s.ditches, s.tracks, s.boulders, s.knolls, s.bare_rock_areas, s.ms_total);
                ExitCode::SUCCESS
            }
            Err(err) => { eprintln!("otidgeo error: {err}"); ExitCode::FAILURE }
        };
    }
    match execute(cli) {
        Ok(s) => {
            println!("otidgeo {}: {:.1} ha, {} contours ({} index, {} depr), {} formlines, {} knolls ({} elong, {} pits), {:.0} ms total",
                s.mode, s.area_ha, s.contours, s.index_contours, s.depressions, s.formlines, s.knolls, s.elongated_knolls, s.pits, s.ms_total);
            ExitCode::SUCCESS
        }
        Err(err) => { eprintln!("otidgeo error: {err}"); ExitCode::FAILURE }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contours::{is_index_level, qualifies_closed_index_ring, qualifies_open_index_line};
    use crate::geometry::{has_self_intersection, segments_intersect, signed_area, smooth_curve_safe};
    use crate::types::{ContourProfile, DemGrid, EngineConfig, FormlineMode, VegFeatures, WorldTransform};
    use crate::vegetation::{LAB_FOREST, LAB_GREEN_406, LAB_NONE, LAB_OPEN};
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_out(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("otidgeo-test-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn count_crossings(lines: &[crate::types::ContourLine]) -> usize {
        let mut crossings = 0usize;
        for i in 0..lines.len() {
            let a = &lines[i];
            let sa = if a.closed { a.points.len() } else { a.points.len().saturating_sub(1) };
            for j in (i + 1)..lines.len() {
                let b = &lines[j];
                let sb = if b.closed { b.points.len() } else { b.points.len().saturating_sub(1) };
                for ia in 0..sa {
                    let p0 = a.points[ia];
                    let p1 = a.points[(ia + 1) % a.points.len()];
                    for ib in 0..sb {
                        let q0 = b.points[ib];
                        let q1 = b.points[(ib + 1) % b.points.len()];
                        if segments_intersect(p0, p1, q0, q1) {
                            crossings += 1;
                        }
                    }
                }
            }
        }
        crossings
    }

    /// Synthetic terrain with Gaussian hills, a depression, a saddle, and a micro-knoll.
    fn synthetic_dem(w: usize, h: usize) -> DemGrid {
        let mut z = vec![0.0f32; w * h];
        for r in 0..h {
            for c in 0..w {
                let x = c as f64;
                let y = r as f64;
                let hill = 18.0 * (-(((x - 45.0).powi(2) + (y - 45.0).powi(2)) / (2.0 * 16.0 * 16.0))).exp();
                let hill2 = 14.0 * (-(((x - 85.0).powi(2) + (y - 45.0).powi(2)) / (2.0 * 14.0 * 14.0))).exp();
                let pit = -12.0 * (-(((x - 65.0).powi(2) + (y - 90.0).powi(2)) / (2.0 * 14.0 * 14.0))).exp();
                let micro = 6.5 * (-(((x - 115.0).powi(2) + (y - 95.0).powi(2)) / (2.0 * 3.0 * 3.0))).exp();
                z[r * w + c] = (50.0 + 0.04 * x + hill + hill2 + pit + micro) as f32;
            }
        }
        DemGrid {
            width: w,
            height: h,
            world: WorldTransform { cell: 1.0, x0: 500_000.5, y0: 6_500_000.0 + h as f64 - 0.5 },
            z,
            valid: vec![1u8; w * h],
            water: vec![0u8; w * h],
            wet: vec![0u8; w * h],
        }
    }

    #[test]
    fn profiles_and_flag_override_precedence_work() {
        let cases = [
            ("very-detailed", ContourProfile::VeryDetailed, 0.62, 1, 0.34, 15.0, 0.85, 0.11, 0.65, 3.0, 20.5),
            ("detailed", ContourProfile::Detailed, 0.76, 1, 0.29, 22.0, 1.15, 0.14, 0.65, 3.5, 19.0),
            ("normal", ContourProfile::Normal, 0.92, 2, 0.24, 30.0, 1.45, 0.16, 1.05, 4.0, 17.5),
            ("generalized", ContourProfile::Generalized, 1.42, 3, 0.14, 58.0, 1.95, 0.24, 1.35, 5.5, 14.5),
            ("very-generalized", ContourProfile::VeryGeneralized, 2.10, 4, 0.08, 100.0, 2.40, 0.32, 1.60, 7.6, 11.5),
        ];
        for (name, prof, sm, tb, cv, area, clr, simp, vs, fgap, fmax) in cases {
            let args: Vec<String> = vec![
                "run", "--input", "a.laz", "--out", "/tmp/o", "--profile", name,
            ]
            .into_iter()
            .map(String::from)
            .collect();
            let c = parse_args(&args).unwrap().config;
            assert_eq!(c.profile, prof);
            assert!((c.smooth_m - sm).abs() < 1e-9, "{name} smooth_m");
            assert_eq!(c.taubin_passes, tb, "{name} taubin");
            assert!((c.curviness - cv).abs() < 1e-9, "{name} curviness");
            assert!((c.min_loop_area_m2 - area).abs() < 1e-9, "{name} min_loop_area");
            assert!((c.min_clearance_m - clr).abs() < 1e-9, "{name} min_clearance");
            assert!((c.simplify_m - simp).abs() < 1e-9, "{name} simplify");
            assert!((c.veg_smooth - vs).abs() < 1e-9, "{name} veg_smooth");
            assert!((c.formline_min_gap_m - fgap).abs() < 1e-9, "{name} formline_min_gap_m");
            assert!((c.formline_max_slope_deg - fmax).abs() < 1e-9, "{name} formline_max_slope_deg");
        }
        // Verify strict 5-profile sprint formline_max_slope_deg table too.
        let sprint_fmax = [
            ("very-detailed", 20.0),
            ("detailed", 18.5),
            ("normal", 17.0),
            ("generalized", 14.0),
            ("very-generalized", 11.0),
        ];
        let mut prev_smax = f64::INFINITY;
        for (name, expected_fmax) in sprint_fmax {
            let args: Vec<String> = vec![
                "run", "--input", "a.laz", "--out", "/tmp/o", "--interval", "2.5", "--profile", name,
            ]
            .into_iter()
            .map(String::from)
            .collect();
            let c = parse_args(&args).unwrap().config;
            assert!(
                (c.formline_max_slope_deg - expected_fmax).abs() < 1e-9,
                "sprint {name} formline_max_slope_deg: got {}",
                c.formline_max_slope_deg
            );
            assert!(c.formline_max_slope_deg < prev_smax, "sprint formline_max_slope_deg not strictly monotonic");
            prev_smax = c.formline_max_slope_deg;
        }
        // Individual flags specified BEFORE `--profile` must still override the profile!
        let args: Vec<String> = vec![
            "run", "--input", "a.laz", "--out", "/tmp/o",
            "--smooth-m", "0.9", "--taubin-passes", "0", "--open-share", "0.55",
            "--veg-smooth", "0.4", "--knoll-min-rise", "1.1",
            "--profile", "very-generalized", "--interval", "2.5",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let c = parse_args(&args).unwrap().config;
        assert_eq!(c.profile, ContourProfile::VeryGeneralized);
        assert!((c.interval - 2.5).abs() < 1e-9);
        assert!((c.smooth_m - 0.9).abs() < 1e-9);
        assert_eq!(c.taubin_passes, 0);
        assert!((c.open_min_ground_share - 0.55).abs() < 1e-9);
        assert!((c.veg_smooth - 0.4).abs() < 1e-9);
        assert!((c.knoll_min_rise_m - 1.1).abs() < 1e-9);
        // Non-overridden sprint profile fields came from very-generalized @ 2.5m.
        assert!((c.min_loop_area_m2 - 40.0).abs() < 1e-9);
        assert!((c.formline_min_gap_m - 5.8).abs() < 1e-9);
    }

    #[test]
    fn taubin_zero_preserves_raw_marching_squares_geometry() {
        let dem = synthetic_dem(100, 100);
        let mut cfg = EngineConfig::defaults_for_interval(5.0);
        cfg.taubin_passes = 0;
        cfg.simplify_m = 0.0;
        let prepared = prepare_dem(&dem, &cfg);
        let raw = crate::contours::trace_level(&prepared, 55.0);
        assert!(!raw.is_empty());
        let sm0 = smooth_curve_safe(&raw[0].points, raw[0].closed, &prepared, 55.0, 1.25, 0);
        assert_eq!(sm0, raw[0].points, "taubin_passes=0 must return exact Marching Squares points");
        let sm2 = smooth_curve_safe(&raw[0].points, raw[0].closed, &prepared, 55.0, 1.25, 2);
        assert_ne!(sm2, raw[0].points, "taubin_passes=2 should smooth the curve");
    }

    #[test]
    fn index_contour_levels_and_isom_rules() {
        // Strict multiples of 5 * interval from 0 m sea level.
        assert!(is_index_level(0.0, 5.0, 0.0, 5));
        assert!(is_index_level(25.0, 5.0, 0.0, 5));
        assert!(is_index_level(75.0, 5.0, 0.0, 5));
        assert!(!is_index_level(20.0, 5.0, 0.0, 5));
        assert!(is_index_level(12.5, 2.5, 0.0, 5));
        assert!(is_index_level(37.5, 2.5, 0.0, 5));
        assert!(!is_index_level(10.0, 2.5, 0.0, 5));
        assert!(is_index_level(20.0, 2.0, 0.0, 5));
        assert!(!is_index_level(12.0, 2.0, 0.0, 5));
        // Even an interval-multiple level_offset keeps 25/50/75 as index levels.
        assert!(is_index_level(50.0, 5.0, 5.0, 5));
        assert!(!is_index_level(55.0, 5.0, 5.0, 5));

        // ISOM 2017-2 closed ring rules: no small knoll or small depression index blobs.
        assert!(!qualifies_closed_index_ring(80.0, 400.0, false, 5.0));
        assert!(qualifies_closed_index_ring(130.0, 900.0, false, 5.0));
        assert!(qualifies_closed_index_ring(110.0, 1300.0, false, 5.0));
        assert!(!qualifies_closed_index_ring(150.0, 1500.0, true, 5.0), "Small/medium depressions must not be index");
        assert!(qualifies_closed_index_ring(55.0, 180.0, false, 2.5));
        assert!(!qualifies_closed_index_ring(35.0, 120.0, false, 2.5));

        // Open contour rules: reject short interior fragments, allow edge-crossing contours.
        assert!(!qualifies_open_index_line(35.0, false, 5.0));
        assert!(qualifies_open_index_line(65.0, false, 5.0));
        assert!(qualifies_open_index_line(25.0, true, 5.0));
        assert!(!qualifies_open_index_line(18.0, false, 2.5));
        assert!(qualifies_open_index_line(26.0, false, 2.5));
    }

    #[test]
    fn detects_round_elongated_knolls_pits_and_marsh_guard() {
        let (w, h) = (120, 120);
        let mut z = vec![51.2f32; w * h];
        let mut wet = vec![0u8; w * h];
        for r in 0..h {
            for c in 0..w {
                let x = c as f64;
                let y = r as f64;
                // 1. Round sub-interval knoll at (30, 30): rise ~1.8 m, sigma=3.2 m (never crosses 55 m).
                let k_round = 1.8 * (-(((x - 30.0).powi(2) + (y - 30.0).powi(2)) / (2.0 * 3.2 * 3.2))).exp();
                // 2. Elongated NE-SW (45 deg CCW from East) knoll at (80, 35): sigma_long=5.0, sigma_short=1.8.
                let dx = x - 80.0;
                let dy = -(y - 35.0); // world +Y is north = -row
                let u = (dx + dy) * std::f64::consts::FRAC_1_SQRT_2;
                let v = (-dx + dy) * std::f64::consts::FRAC_1_SQRT_2;
                let k_elong = 2.0 * (-(u * u / (2.0 * 5.0 * 5.0) + v * v / (2.0 * 1.9 * 1.9))).exp();
                // 3. Small pit at (35, 85): depth ~1.4 m.
                let k_pit = -1.4 * (-(((x - 35.0).powi(2) + (y - 85.0).powi(2)) / (2.0 * 3.0 * 3.0))).exp();
                // 4. Low ghost bump in marsh at (85, 85): rise ~1.2 m (must be suppressed in wet ground!).
                let k_marsh = 1.2 * (-(((x - 85.0).powi(2) + (y - 85.0).powi(2)) / (2.0 * 3.2 * 3.2))).exp();
                if (x - 85.0).hypot(y - 85.0) < 12.0 {
                    wet[r * w + c] = 1;
                }
                z[r * w + c] = (51.2 + k_round + k_elong + k_pit + k_marsh) as f32;
            }
        }
        let dem = DemGrid {
            width: w,
            height: h,
            world: WorldTransform { cell: 1.0, x0: 500_000.5, y0: 6_500_000.0 + h as f64 - 0.5 },
            z,
            valid: vec![1u8; w * h],
            water: vec![0u8; w * h],
            wet,
        };
        let cfg = EngineConfig::defaults_for_interval(5.0);
        let prepared = prepare_dem(&dem, &cfg);
        let (contours, promoted) = extract_contours(&prepared, &cfg);
        let formlines = extract_formlines(&prepared, &contours, &cfg);
        let knolls = detect_knolls_and_pits(&prepared, &contours, &formlines, &promoted, &cfg);

        let rounds: Vec<_> = knolls.iter().filter(|k| k.kind == KnollKind::Round).collect();
        let elongs: Vec<_> = knolls.iter().filter(|k| k.kind == KnollKind::Elongated).collect();
        let pits: Vec<_> = knolls.iter().filter(|k| k.kind == KnollKind::Pit).collect();
        assert_eq!(rounds.len(), 1, "Expected 1 round knoll (marsh ghost filtered), got {rounds:?}");
        assert_eq!(elongs.len(), 1, "Expected 1 elongated knoll, got {elongs:?}");
        assert_eq!(pits.len(), 1, "Expected 1 pit, got {pits:?}");
        let ang = elongs[0].angle_deg.expect("Elongated knoll must carry angle_deg");
        assert!((ang - 45.0).abs() < 12.0, "Expected ~45 deg NE-SW orientation, got {ang:.1}");

        // Verify DXF output writes 999\notidgeo header marker and dotknoll_avlang with group 50 rotation.
        let out = temp_out("knoll-dxf");
        let dxf_path = out.join("knollar.dxf");
        write_knolls_dxf(&dxf_path, &knolls).unwrap();
        let text = std::fs::read_to_string(&dxf_path).unwrap();
        assert!(text.starts_with("0\nSECTION\n2\nHEADER\n999\notidgeo\n"));
        assert!(text.contains("dotknoll\n"));
        assert!(text.contains("dotknoll_avlang\n"));
        assert!(text.contains("udepression\n"));
        assert!(text.contains("\n50\n"));
        let _ = std::fs::remove_dir_all(&out);
    }

    #[test]
    fn two_scale_dem_calms_flat_ripples_while_keeping_hilly_peaks_crisp() {
        let (w, h) = (160, 120);
        let mut z = vec![50.0f32; w * h];
        for r in 0..h {
            for c in 0..w {
                let x = c as f64;
                let y = r as f64;
                // Left half (x < 75): flat ground (<2° mean slope) with 0.12 m micro-undulations.
                let ripple = if x < 75.0 { 0.12 * (x * 0.70).sin() * (y * 0.70).cos() } else { 0.0 };
                // Right half (x ~ 115): steep hilly terrain with a crisp small ridge/nose.
                let hill = 18.0 * (-(((x - 115.0).powi(2) + (y - 60.0).powi(2)) / (2.0 * 14.0 * 14.0))).exp();
                let nose = 2.5 * (-(((x - 102.0).powi(2) + (y - 60.0).powi(2)) / (2.0 * 2.5 * 2.5))).exp();
                z[r * w + c] = (50.0 + ripple + hill + nose) as f32;
            }
        }
        let dem = DemGrid {
            width: w,
            height: h,
            world: WorldTransform { cell: 1.0, x0: 500_000.5, y0: 6_500_119.5 },
            z,
            valid: vec![1u8; w * h],
            water: vec![0u8; w * h],
            wet: vec![0u8; w * h],
        };
        let cfg = EngineConfig::defaults_for_interval(5.0);
        let prepared = prepare_dem(&dem, &cfg);
        let mut cfg_uniform = cfg.clone();
        cfg_uniform.flat_smooth_m = Some(cfg.smooth_m);
        let prepared_uniform = prepare_dem(&dem, &cfg_uniform);

        // Flat ground ripples should be calmed far more strongly than uniform detail smoothing.
        let mut flat_max_dev = 0.0f32;
        let mut unif_max_dev = 0.0f32;
        for r in 25..95 {
            for c in 20..55 {
                flat_max_dev = flat_max_dev.max((prepared.contour_z[r * w + c] - 50.0).abs());
                unif_max_dev = unif_max_dev.max((prepared_uniform.contour_z[r * w + c] - 50.0).abs());
            }
        }
        assert!(
            flat_max_dev < 0.04 && flat_max_dev < unif_max_dev * 0.25,
            "Flat ripples must be calmed strongly by z_flat: adaptive={flat_max_dev:.3} vs uniform={unif_max_dev:.3}"
        );

        // Hilly peak at (115, 60) should remain just as crisp as uniform z_detail.
        let peak_z = prepared.contour_z[60 * w + 115];
        let peak_unif = prepared_uniform.contour_z[60 * w + 115];
        assert!(
            peak_z > 67.5 && (peak_z - peak_unif).abs() < 0.10,
            "Hilly peak must remain crisp via z_crisp + DoG: adaptive={peak_z:.2} vs uniform={peak_unif:.2}"
        );
    }

    #[test]
    fn taubin_preserves_sharp_rocky_nose_while_smoothing_straight_stairsteps() {
        let (w, h) = (100, 100);
        let mut z = vec![0.0f32; w * h];
        for r in 0..h {
            for c in 0..w {
                // Uniform 12° hill slope so hilly corner preservation applies.
                z[r * w + c] = (50.0 + (r as f64 - 50.0) * 0.21) as f32;
            }
        }
        let dem = DemGrid {
            width: w,
            height: h,
            world: WorldTransform { cell: 1.0, x0: 500_000.5, y0: 6_500_099.5 },
            z,
            valid: vec![1u8; w * h],
            water: vec![0u8; w * h],
            wet: vec![0u8; w * h],
        };
        let cfg = EngineConfig::defaults_for_interval(5.0);
        let prepared = prepare_dem(&dem, &cfg);
        // Synthetic polyline with a 90° rocky nose at index 10 and 1 m stair-step jitter on the straight leg.
        let mut pts: Vec<[f64; 2]> = Vec::new();
        for i in 0..10 {
            let jitter = if i % 2 == 0 { 0.25 } else { -0.25 };
            pts.push([500_020.0 + i as f64 * 1.5, 6_500_050.0 + jitter]);
        }
        let nose_idx = pts.len();
        pts.push([500_035.0, 6_500_050.0]);
        for i in 1..=10 {
            pts.push([500_035.0, 6_500_050.0 - i as f64 * 1.5]);
        }
        let smoothed = crate::geometry::taubin_smooth(&pts, false, &prepared, 50.0, 1.25, 2);
        let nose_shift = (smoothed[nose_idx][0] - pts[nose_idx][0]).hypot(smoothed[nose_idx][1] - pts[nose_idx][1]);
        assert!(
            nose_shift < 0.18,
            "Sharp rocky corner/nose must not round strongly under Taubin, shifted {nose_shift:.3} m"
        );
        // 1-cell stairstep jitter on the straight leg must smooth meaningfully.
        let raw_jitter: f64 = pts[2..8].iter().map(|p| (p[1] - 6_500_050.0).abs()).sum::<f64>() / 6.0;
        let sm_jitter: f64 = smoothed[2..8].iter().map(|p| (p[1] - 6_500_050.0).abs()).sum::<f64>() / 6.0;
        assert!(
            sm_jitter < raw_jitter * 0.65,
            "Straight-leg stairstep jitter must smooth cleanly: raw={raw_jitter:.3}, smoothed={sm_jitter:.3}"
        );
    }

    #[test]
    fn profiles_are_monotonic_on_101_and_103_with_zero_crossings() {
        let dem = synthetic_dem(160, 160);
        let profiles = [
            ContourProfile::VeryDetailed,
            ContourProfile::Detailed,
            ContourProfile::Normal,
            ContourProfile::Generalized,
            ContourProfile::VeryGeneralized,
        ];
        for interval in [5.0, 2.5] {
            let mut prev_c = f64::INFINITY;
            let mut prev_f = f64::INFINITY;
            for prof in profiles {
                let mut cfg = EngineConfig::defaults_for_interval(interval);
                cfg.apply_profile(prof);
                let prepared = prepare_dem(&dem, &cfg);
                let (contours, _) = extract_contours(&prepared, &cfg);
                let formlines = extract_formlines(&prepared, &contours, &cfg);
                assert_eq!(count_crossings(&contours), 0, "Crossings on iv={interval} {prof:?}");
                for l in contours.iter().chain(formlines.iter()) {
                    assert!(!has_self_intersection(&l.points, l.closed), "SelfX on iv={interval} {prof:?}");
                }
                let c_len: f64 = contours.iter().map(|l| crate::geometry::polyline_length(&l.points, l.closed)).sum();
                let f_len: f64 = formlines.iter().map(|l| crate::geometry::polyline_length(&l.points, l.closed)).sum();
                assert!(
                    c_len <= prev_c + 1.0,
                    "101 length not monotonic at iv={interval} {prof:?}: {c_len:.1} > {prev_c:.1}"
                );
                assert!(
                    f_len <= prev_f + 1.0,
                    "103 length not monotonic at iv={interval} {prof:?}: {f_len:.1} > {prev_f:.1}"
                );
                prev_c = c_len;
                prev_f = f_len;
            }
        }
    }

    #[test]
    fn smooth_planar_slope_suppresses_103_while_local_form_survives() {
        let (w, h) = (160, 140);
        // 1. Pure featureless 9° forest planar slope -> 0 formlines.
        let make_plane = |deg: f64| -> DemGrid {
            let slope = deg.to_radians().tan();
            let mut z = vec![0.0f32; w * h];
            for r in 0..h {
                for c in 0..w {
                    z[r * w + c] = (45.0 + (r as f64) * slope) as f32;
                }
            }
            DemGrid {
                width: w,
                height: h,
                world: WorldTransform { cell: 1.0, x0: 500_000.5, y0: 6_500_000.0 + h as f64 - 0.5 },
                z,
                valid: vec![1u8; w * h],
                water: vec![0u8; w * h],
                wet: vec![0u8; w * h],
            }
        };
        for (deg, interval) in [(10.5, 5.0), (6.5, 2.5)] {
            let dem = make_plane(deg);
            let cfg = EngineConfig::defaults_for_interval(interval);
            let prepared = prepare_dem(&dem, &cfg);
            let (contours, _) = extract_contours(&prepared, &cfg);
            let formlines = extract_formlines(&prepared, &contours, &cfg);
            assert!(
                formlines.is_empty(),
                "Featureless {deg}° planar slope (iv={interval}) above selective_slope must emit 0 formlines, got {}",
                formlines.len()
            );
        }

        // Gentle 6° forest slope (< selective_slope 9.0°) stays permissive so gentle forest hills aren't over-pruned.
        {
            let dem = make_plane(6.0);
            let cfg = EngineConfig::defaults_for_interval(5.0);
            let prepared = prepare_dem(&dem, &cfg);
            let (contours, _) = extract_contours(&prepared, &cfg);
            let formlines = extract_formlines(&prepared, &contours, &cfg);
            assert!(
                !formlines.is_empty(),
                "Gentle 6° forest slope (< selective_slope 9.0°) should remain permissive"
            );
        }

        // 2. Same 10.5° forest slope WITH a distinct spur/nose (x=48) and incised re-entrant (x=112) -> both kept!
        let slope = 10.5_f64.to_radians().tan();
        let mut z = vec![0.0f32; w * h];
        for r in 0..h {
            for c in 0..w {
                let x = c as f64;
                let y = r as f64;
                let nose = 2.5 * (-((x - 48.0).powi(2) / (2.0 * 8.0 * 8.0))).exp();
                let reent = -2.8 * (-((x - 112.0).powi(2) / (2.0 * 8.0 * 8.0))).exp();
                z[r * w + c] = (45.0 + y * slope + nose + reent) as f32;
            }
        }
        let dem_form = DemGrid {
            width: w,
            height: h,
            world: WorldTransform { cell: 1.0, x0: 500_000.5, y0: 6_500_000.0 + h as f64 - 0.5 },
            z,
            valid: vec![1u8; w * h],
            water: vec![0u8; w * h],
            wet: vec![0u8; w * h],
        };
        let cfg = EngineConfig::defaults_for_interval(5.0);
        let prepared = prepare_dem(&dem_form, &cfg);
        let (contours, _) = extract_contours(&prepared, &cfg);
        let formlines = extract_formlines(&prepared, &contours, &cfg);
        let has_nose = formlines
            .iter()
            .any(|l| l.points.iter().any(|p| (p[0] - 500_048.5).abs() < 14.0));
        let has_reentrant = formlines
            .iter()
            .any(|l| l.points.iter().any(|p| (p[0] - 500_112.5).abs() < 14.0));
        assert!(has_nose, "Distinct nose on 10.5° slope must retain a 103 formline");
        assert!(has_reentrant, "Distinct re-entrant on 10.5° slope must retain a 103 formline");
    }

    #[test]
    fn formlines_hard_cut_narrow_flat_strip_without_bridging() {
        let (w, h) = (180, 140);
        let mut z = vec![0.0f32; w * h];
        for r in 0..h {
            let dy = r as f64 - 70.0;
            // Convex shoulder right along dy = 0 (gentle upper bench, steeper downhill drop) so
            // 52.5 m formline has strong form on both sides of the narrow flat strip.
            let profile = if dy >= 0.0 { 0.06 * dy } else { 0.22 * dy };
            for c in 0..w {
                let x = c as f64;
                // Narrow ~7 m flat strip (< min_cut_len = 12 m) centered at x = 90.
                let strip = 1.0 - 0.94 * (-((x - 90.0) / 4.2).powi(4)).exp();
                z[r * w + c] = (52.5 + profile * strip) as f32;
            }
        }
        let dem = DemGrid {
            width: w,
            height: h,
            world: WorldTransform { cell: 1.0, x0: 500_000.5, y0: 6_500_000.0 + h as f64 - 0.5 },
            z,
            valid: vec![1u8; w * h],
            water: vec![0u8; w * h],
            wet: vec![0u8; w * h],
        };
        let cfg = EngineConfig::defaults_for_interval(5.0);
        let prepared = prepare_dem(&dem, &cfg);
        let (contours, _) = extract_contours(&prepared, &cfg);
        let formlines = extract_formlines(&prepared, &contours, &cfg);

        let mid_x = 500_090.5;
        let has_left = formlines.iter().any(|l| l.points.iter().all(|p| p[0] < mid_x - 1.5));
        let has_right = formlines.iter().any(|l| l.points.iter().all(|p| p[0] > mid_x + 1.5));
        let bridges_flat = formlines.iter().any(|l| {
            let min_x = l.points.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
            let max_x = l.points.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max);
            min_x < mid_x - 1.0 && max_x > mid_x + 1.0
        });
        assert!(has_left && has_right, "Expected 103 pieces on both sloped shoulders");
        assert!(!bridges_flat, "Narrow flat strip (< min_cut_len) must be hard-cut, never bridged");
    }

    #[test]
    fn verified_closed_depression_retains_intact_103_ring() {
        // Forest (5 m interval): verified depression (raw_prom ~1.3 m >= 0.75 m) on gentle terrain.
        let make_dep_dem = |w: usize, h: usize, base: f64, depth: f64, sigma: f64| -> DemGrid {
            let cx = (w / 2) as f64;
            let cy = (h / 2) as f64;
            let mut z = vec![0.0f32; w * h];
            for r in 0..h {
                for c in 0..w {
                    let dx = c as f64 - cx;
                    let dy = r as f64 - cy;
                    let pit = -depth * (-((dx * dx + dy * dy) / (2.0 * sigma * sigma))).exp();
                    z[r * w + c] = (base + 0.015 * dx + pit) as f32;
                }
            }
            DemGrid {
                width: w,
                height: h,
                world: WorldTransform { cell: 1.0, x0: 500_000.5, y0: 6_500_000.0 + h as f64 - 0.5 },
                z,
                valid: vec![1u8; w * h],
                water: vec![0u8; w * h],
                wet: vec![0u8; w * h],
            }
        };

        let forest_dem = make_dep_dem(120, 120, 53.6, 2.4, 6.0);
        let cfg_f = EngineConfig::defaults_for_interval(5.0);
        let prep_f = prepare_dem(&forest_dem, &cfg_f);
        let (c_f, _) = extract_contours(&prep_f, &cfg_f);
        let fl_f = extract_formlines(&prep_f, &c_f, &cfg_f);
        assert!(
            fl_f.iter().any(|l| l.closed && (l.elevation - 52.5).abs() < 1e-6),
            "Verified forest depression (>= 0.75 m depth) must retain intact closed 103 ring, got {fl_f:?}"
        );

        let sprint_dem = make_dep_dem(100, 100, 51.9, 1.45, 3.5);
        let cfg_s = EngineConfig::defaults_for_interval(2.5);
        let prep_s = prepare_dem(&sprint_dem, &cfg_s);
        let (c_s, _) = extract_contours(&prep_s, &cfg_s);
        let fl_s = extract_formlines(&prep_s, &c_s, &cfg_s);
        assert!(
            fl_s.iter().any(|l| l.closed && (l.elevation - 51.25).abs() < 1e-6),
            "Verified sprint depression (>= 0.55 m depth) must retain intact closed 103 ring, got {fl_s:?}"
        );
    }

    #[test]
    fn knolls_suppress_cliff_rim_fp_while_keeping_isolated_knoll() {
        let (w, h) = (120, 120);
        let mut z = vec![51.2f32; w * h];
        for r in 0..h {
            for c in 0..w {
                let x = c as f64;
                let y = r as f64;
                // 1. Genuine isolated knoll at (30, 60): rise ~1.7 m.
                let real_knoll = 1.7 * (-(((x - 30.0).powi(2) + (y - 60.0).powi(2)) / (2.0 * 3.2 * 3.2))).exp();
                // 2. Steep cliff step at x = 80 (8 m vertical drop over 4 m -> > 55° slope) with a small lip bump at (78, 60).
                let cliff = 8.0 / (1.0 + ((x - 81.0) / 1.4).exp());
                let rim_lip = 0.6 * (-(((x - 77.0).powi(2) + (y - 60.0).powi(2)) / (2.0 * 2.5 * 2.5))).exp();
                z[r * w + c] = (51.2 + real_knoll + cliff + rim_lip) as f32;
            }
        }
        let dem = DemGrid {
            width: w,
            height: h,
            world: WorldTransform { cell: 1.0, x0: 500_000.5, y0: 6_500_119.5 },
            z,
            valid: vec![1u8; w * h],
            water: vec![0u8; w * h],
            wet: vec![0u8; w * h],
        };
        let cfg = EngineConfig::defaults_for_interval(5.0);
        let prepared = prepare_dem(&dem, &cfg);
        let (contours, promoted) = extract_contours(&prepared, &cfg);
        let formlines = extract_formlines(&prepared, &contours, &cfg);
        let knolls = detect_knolls_and_pits(&prepared, &contours, &formlines, &promoted, &cfg);
        let hills: Vec<_> = knolls.iter().filter(|k| !k.is_depression()).collect();
        assert!(
            hills.iter().any(|k| (k.x - 500_030.5).hypot(k.y - 6_500_059.5) < 4.0),
            "Genuine isolated knoll must be preserved, got {hills:?}"
        );
        assert!(
            !hills.iter().any(|k| (k.x - 500_077.5).hypot(k.y - 6_500_059.5) < 6.0),
            "Cliff-rim lip FP must be suppressed, got {hills:?}"
        );
    }

    #[test]
    fn synthetic_contours_have_zero_intersections_and_correct_depressions() {
        let dem = synthetic_dem(140, 140);
        let cfg = EngineConfig::defaults_for_interval(5.0);
        let prepared = prepare_dem(&dem, &cfg);
        let (lines, _knolls) = extract_contours(&prepared, &cfg);

        assert!(!lines.is_empty(), "Expected extracted contours");
        for l in &lines {
            assert!(!has_self_intersection(&l.points, l.closed), "Self-intersection on {:?}", l.layer);
            if l.closed {
                assert!(
                    signed_area(&l.points).abs() >= cfg.min_loop_area_m2 * 0.7,
                    "Closed loop smaller than min_loop_area_m2 survived: {}",
                    signed_area(&l.points).abs()
                );
            }
        }
        assert_eq!(count_crossings(&lines), 0, "Neighbor contours must never cross");

        let n_dep = lines
            .iter()
            .filter(|l| matches!(l.layer, ContourLayer::Depression | ContourLayer::DepressionIndex))
            .count();
        let n_peak = lines
            .iter()
            .filter(|l| l.closed && matches!(l.layer, ContourLayer::Contour | ContourLayer::ContourIndex))
            .count();
        assert!(n_dep >= 1, "Expected at least 1 closed depression contour, got {n_dep}");
        assert!(n_peak >= 2, "Expected at least 2 closed peak contours, got {n_peak}");
    }

    #[test]
    fn formline_modes_control_density_monotonically() {
        let dem = synthetic_dem(140, 140);
        let mut cfg_off = EngineConfig::defaults_for_interval(5.0);
        cfg_off.apply_formline_mode(FormlineMode::Off);
        let mut cfg_sparse = EngineConfig::defaults_for_interval(5.0);
        cfg_sparse.apply_formline_mode(FormlineMode::Sparse);
        let mut cfg_dense = EngineConfig::defaults_for_interval(5.0);
        cfg_dense.apply_formline_mode(FormlineMode::Dense);

        let prepared = prepare_dem(&dem, &cfg_sparse);
        let (main, _) = extract_contours(&prepared, &cfg_sparse);
        let f_off = extract_formlines(&prepared, &main, &cfg_off);
        let f_sparse = extract_formlines(&prepared, &main, &cfg_sparse);
        let f_dense = extract_formlines(&prepared, &main, &cfg_dense);

        assert!(f_off.is_empty(), "Off mode must emit 0 formlines");
        assert!(
            f_dense.len() >= f_sparse.len(),
            "Dense mode ({}) should produce at least as many formlines as sparse ({})",
            f_dense.len(),
            f_sparse.len()
        );
    }

    #[test]
    fn vegetation_respects_steep_water_and_veg_smooth() {
        let (w, h) = (60, 60);
        let n = w * h;
        let mut feat = VegFeatures {
            width: w,
            height: h,
            world: WorldTransform { cell: 2.0, x0: 1001.0, y0: 2119.0 },
            valid: vec![1; n],
            water: vec![0; n],
            vegh: vec![10.0; n],
            ground_share: vec![0.55; n],
            low_share: vec![0.01; n],
            mid_share: vec![0.03; n],
            high_share: vec![0.35; n],
            return_ratio: vec![0.45; n],
            npts: vec![12.0; n],
            ground_intensity: vec![4000.0; n],
            spread: vec![0.05; n],
            slope_deg: vec![6.0; n],
        };
        for r in 5..25 {
            for c in 5..25 {
                let i = r * w + c;
                feat.mid_share[i] = 0.22;
                feat.ground_share[i] = 0.25;
                feat.high_share[i] = 0.50;
            }
        }
        for r in 5..25 {
            for c in 35..55 {
                let i = r * w + c;
                feat.mid_share[i] = 0.22;
                feat.ground_share[i] = 0.25;
                feat.high_share[i] = 0.50;
                feat.slope_deg[i] = 42.0;
            }
        }
        for r in 35..55 {
            for c in 5..25 {
                let i = r * w + c;
                feat.vegh[i] = 0.3;
                feat.ground_share[i] = 0.90;
                feat.low_share[i] = 0.08;
                feat.high_share[i] = 0.01;
                feat.mid_share[i] = 0.01;
            }
        }
        for r in 35..55 {
            for c in 35..55 {
                feat.water[r * w + c] = 1;
            }
        }

        let cfg = EngineConfig::defaults_for_interval(5.0);
        let res = classify_vegetation(&feat, &cfg);
        assert!(res.land[15 * w + 15] >= LAB_GREEN_406, "Dense thicket should be classified green");
        assert_eq!(res.land[15 * w + 45], LAB_FOREST, "Steep slope (>35 deg) must never be green");
        assert_eq!(res.undergrowth[15 * w + 45], 0, "Steep slope must never have undergrowth");
        assert_eq!(res.land[45 * w + 15], LAB_OPEN, "Open patch should be classified open");
        assert_eq!(res.undergrowth[45 * w + 15], 0, "Open yellow land must never have undergrowth");
        assert_eq!(res.land[45 * w + 45], LAB_NONE, "Water body must be LAB_NONE");
        assert_eq!(res.undergrowth[45 * w + 45], 0, "Water body must never have undergrowth");
    }

    #[test]
    fn veg_subcommand_runs_fast_without_writing_dxf() {
        let laz = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/laser/kungshatt-300m.laz");
        assert!(laz.exists(), "Missing fixture {}", laz.display());
        let out = temp_out("kungshatt-veg");
        let args = vec![
            "veg".into(),
            "--input".into(),
            laz.to_string_lossy().into(),
            "--out".into(),
            out.to_string_lossy().into(),
            "--veg-smooth".into(),
            "0.65".into(),
            "--open-share".into(),
            "0.60".into(),
        ];
        let cli = parse_args(&args).unwrap();
        let summary = execute(cli).unwrap();
        assert_eq!(summary.mode, "veg");
        assert!(summary.points_read > 200_000);
        assert_eq!(summary.contours, 0);
        assert!(out.join("vegetationsklasser.png").exists());
        assert!(out.join("vegetationsklasser.pgw").exists());
        assert!(out.join("summary.json").exists());
        assert!(!out.join("kurvor.dxf").exists(), "veg subcommand must skip DXF generation");
        assert!(!out.join("formlinjer.dxf").exists());
        assert!(!out.join("knollar.dxf").exists());
        let _ = std::fs::remove_dir_all(&out);
    }

    #[test]
    fn runs_end_to_end_on_kungshatt_laz() {
        let laz = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/laser/kungshatt-300m.laz");
        assert!(laz.exists(), "Missing fixture {}", laz.display());
        let out = temp_out("kungshatt");
        let args = vec![
            "run".into(),
            "--input".into(),
            laz.to_string_lossy().into(),
            "--out".into(),
            out.to_string_lossy().into(),
            "--overview".into(),
        ];
        let cli = parse_args(&args).unwrap();
        let summary = execute(cli).unwrap();
        assert!(summary.points_read > 200_000);
        assert!(summary.contours >= 10);
        assert!(out.join("kurvor.dxf").exists());
        assert!(out.join("formlinjer.dxf").exists());
        assert!(out.join("knollar.dxf").exists());
        assert!(out.join("vegetationsklasser.png").exists());
        assert!(out.join("vegetationsklasser.pgw").exists());
        assert!(out.join("karta.png").exists());
        assert!(out.join("summary.json").exists());
        let _ = std::fs::remove_dir_all(&out);
    }

    #[test]
    fn runs_end_to_end_on_hogdalen_bench_map_if_present() {
        let bench = Path::new("/Users/joelberring/.gemini/antigravity/brain/fe442499-93dc-4cb1-a229-aa9961fb51a1/scratch/bench/hogdalen");
        if !bench.join("hojd.png").exists() {
            return;
        }
        let out = temp_out("hogdalen");
        let args = vec![
            "bench-map".into(),
            "--dir".into(),
            bench.to_string_lossy().into(),
            "--out".into(),
            out.to_string_lossy().into(),
            "--overview".into(),
        ];
        let cli = parse_args(&args).unwrap();
        let summary = execute(cli).unwrap();
        assert!(summary.contours >= 50, "Expected contours on Hogdalen, got {}", summary.contours);
        assert!(summary.veg_ha_open > 1.0 && summary.veg_ha_green406 > 0.5);
        assert!(out.join("kurvor.dxf").exists());
        assert!(out.join("vegetationsklasser.png").exists());
        let _ = std::fs::remove_dir_all(&out);
    }
}
