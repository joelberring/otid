//! Unit and integration tests for `otidgeo rasters`.

use crate::bench_io::read_rgba_png;
use crate::cli::{parse_args, Mode};
use crate::rasters::cliffs::{measure_cliff, slope_lines};
use crate::rasters::execute_rasters;
use crate::rasters::geom::clean_mask;
use crate::rasters::grid_io::{write_sub_png, GroundGrid};
use crate::rasters::height::{shade_value, write_height_png};
use crate::rasters::knolls::{choose_knolls, knoll_candidates, KNOLL_LOWER_SHARE};
use crate::rasters::moisture::{fill_depressions, flow_accumulation, flow_directions, height_above_drainage, Grid2m};
use crate::rasters::rock::detect_boulders;
use crate::rasters::skeleton::thin;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("otidgeo-rasters-{tag}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_ground_bin(path: &Path, g: &GroundGrid) {
    let mut f = std::fs::File::create(path).unwrap();
    for v in [g.min_x, g.min_y, g.cell] {
        f.write_all(&v.to_le_bytes()).unwrap();
    }
    for v in [g.width as u64, g.height as u64] {
        f.write_all(&v.to_le_bytes()).unwrap();
    }
    for &z in &g.z {
        f.write_all(&z.to_le_bytes()).unwrap();
    }
}

fn write_water_bin(path: &Path, min_x: f64, min_y: f64, cell: f64, w: usize, h: usize, cells: &[u8]) {
    let mut f = std::fs::File::create(path).unwrap();
    for v in [min_x, min_y, cell] {
        f.write_all(&v.to_le_bytes()).unwrap();
    }
    for v in [w as u64, h as u64] {
        f.write_all(&v.to_le_bytes()).unwrap();
    }
    f.write_all(cells).unwrap();
}

#[test]
fn parses_rasters_flags_and_clip_alias() {
    let args: Vec<String> = vec![
        "rasters",
        "--ground", "mark0.bin",
        "--ground", "mark1.bin",
        "--water", "vatten0.bin",
        "--points", "punkter0.bin",
        "--veg-png", "vegetationsklasser.png",
        "--out", "/tmp/out",
        "--gap-fill-rounds", "0",
        "--height-rasters",
        "--point-images",
        "--water-geojson",
        "--moisture", "--channel-ha", "1.5", "--wet-meters", "0.3", "--moist-meters", "0.5",
        "--cliffs", "--cliff-min-drop", "1.1", "--cliff-impassable-drop", "4.0", "--cliff-impassable-length", "15", "--cliff-tags",
        "--ditches-tracks",
        "--rock", "--rock-mode", "2", "--knolls", "--knoll-share", "0.8",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    let cli = parse_args(&args).unwrap();
    let Mode::Rasters(cfg) = cli.mode else {
        panic!("Expected Mode::Rasters");
    };
    assert_eq!(cfg.ground_paths.len(), 2);
    assert_eq!(cfg.water_paths.len(), 1);
    assert_eq!(cfg.point_paths.len(), 1);
    assert_eq!(cfg.gap_fill_rounds, 0);
    assert!(cfg.height_rasters && cfg.point_images && cfg.water_geojson);
    assert!(cfg.moisture);
    assert!((cfg.moisture_settings.channel_ha - 1.5).abs() < 1e-9);
    assert!((cfg.moisture_settings.wet_meters - 0.3).abs() < 1e-9);
    assert!((cfg.moisture_settings.moist_meters - 0.5).abs() < 1e-9);
    assert!(cfg.cliffs && cfg.cliff_rules.tags);
    assert!((cfg.cliff_rules.impassable_drop3 - 4.0).abs() < 1e-9);
    assert!((cfg.cliff_rules.impassable_drop6 - 4.0).abs() < 1e-9);
    assert!(cfg.ditches_tracks && cfg.rock && cfg.knolls);
    assert_eq!(cfg.rock_mode, 2);
    assert!((cfg.knoll_share - 0.8).abs() < 1e-9);

    // `--clip` alias works on `run`.
    let run_args: Vec<String> = vec!["run", "--input", "a.laz", "--out", "/tmp/o", "--clip", "1,2,3,4"]
        .into_iter()
        .map(String::from)
        .collect();
    let run_cli = parse_args(&run_args).unwrap();
    assert_eq!(run_cli.config.bbox, Some([1.0, 2.0, 3.0, 4.0]));
}

#[test]
fn height_png_and_hillshade_match_reference_values() {
    let slope = |dx: f32, dy: f32| -> GroundGrid {
        let mut z = vec![0.0f32; 81];
        for x in 0..9 {
            for y in 0..9 {
                z[x * 9 + y] = x as f32 * dx + y as f32 * dy;
            }
        }
        GroundGrid { min_x: 0.0, min_y: 0.0, cell: 1.0, width: 9, height: 9, z }
    };
    assert_eq!(shade_value(&slope(0.0, 0.0), 1, 4, 4), Some(204));
    assert!(shade_value(&slope(-0.6, 0.6), 1, 4, 4).unwrap() < 120);
    assert!(shade_value(&slope(0.6, -0.6), 1, 4, 4).unwrap() > 204);
    let nan_grid = GroundGrid { min_x: 0.0, min_y: 0.0, cell: 1.0, width: 9, height: 9, z: vec![f32::NAN; 81] };
    assert_eq!(shade_value(&nan_grid, 1, 4, 4), None);

    // 24-bit cm + 10_000 roundtrip in hojd.png.
    let dir = temp_dir("hojd");
    let g = GroundGrid {
        min_x: 664_780.0,
        min_y: 6_576_500.0,
        cell: 1.0,
        width: 2,
        height: 2,
        z: vec![12.34, f32::NAN, -5.0, 100.0],
    };
    write_height_png(&dir, &g).unwrap();
    let img = read_rgba_png(&dir.join("hojd.png")).unwrap();
    // Row 0 is northmost (y = 1): col 0 -> NaN, col 1 -> 100.0 m (20000 cm).
    assert_eq!(&img.data[0..4], &[0, 0, 0, 0]);
    let v100 = (img.data[4] as u32) * 65536 + (img.data[5] as u32) * 256 + (img.data[6] as u32);
    assert_eq!(v100, 20_000);
    assert_eq!(img.data[7], 255);
    // Row 1 is southmost (y = 0): col 0 -> 12.34 m (11234 cm), col 1 -> -5.0 m (9500 cm).
    let v12 = (img.data[8] as u32) * 65536 + (img.data[9] as u32) * 256 + (img.data[10] as u32);
    assert_eq!(v12, 11_234);
    let vm5 = (img.data[12] as u32) * 65536 + (img.data[13] as u32) * 256 + (img.data[14] as u32);
    assert_eq!(vm5, 9_500);
    let pgw = std::fs::read_to_string(dir.join("hojd.pgw")).unwrap();
    assert_eq!(pgw, "1\n0\n0\n-1\n664780.5\n6576501.5\n");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn clean_mask_preserves_lakes_and_zhang_suen_thins_to_single_pixel() {
    // 10x10 wet mask with a 2x2 lake (blocked) inside: clean_mask must NOT fill blocked cells.
    let (w, h) = (10, 10);
    let mut mask = vec![1u8; w * h];
    let mut blocked = vec![0u8; w * h];
    for x in 4..6 {
        for y in 4..6 {
            mask[x * h + y] = 0;
            blocked[x * h + y] = 1;
        }
    }
    let cleaned = clean_mask(&mask, w, h, 4, 20, Some(&blocked));
    for x in 4..6 {
        for y in 4..6 {
            assert_eq!(cleaned[x * h + y], 0, "Blocked lake cell must not be filled");
        }
    }

    // Zhang-Suen thins a 3-cell-wide horizontal band to 1 cell wide.
    let mut band = vec![0u8; 20 * 9];
    for x in 2..18 {
        for y in 3..6 {
            band[x * 9 + y] = 1;
        }
    }
    let skel = thin(&band, 20, 9);
    for x in 4..16 {
        let sum: u8 = (3..6).map(|y| skel[x * 9 + y]).sum();
        assert_eq!(sum, 1, "Expected 1-pixel centerline at x={x}");
    }
}

#[test]
fn priority_flood_handles_sink_and_produces_monotone_hand() {
    let (w, h) = (25, 25);
    let mut z = vec![0.0f64; w * h];
    for x in 0..w {
        for y in 0..h {
            // Sloped valley along x=12 flowing toward y=0, with an interior pit at (12, 12).
            let dx = (x as f64 - 12.0).abs();
            let mut elev = 10.0 + 0.05 * y as f64 + 0.3 * dx;
            if x >= 10 && x <= 14 && y >= 10 && y <= 14 {
                elev -= 1.0;
            }
            z[x * h + y] = elev;
        }
    }
    let grid = Grid2m { min_x: 1.0, min_y: 1.0, cell: 2.0, width: w, height: h, z };
    let filled = fill_depressions(&grid, 1e-4);
    let down = flow_directions(&grid, &filled);
    let (acc, order) = flow_accumulation(&down, &filled);
    assert!(acc[12 * h] > 50.0, "Valley outlet must accumulate flow, got {}", acc[12 * h]);
    let hand = height_above_drainage(&grid, &down, &acc, &order, 20.0);
    assert!(hand[12 * h + 1].is_finite() && hand[12 * h + 1] < 0.05);
    assert!(hand[20 * h + 1] > 1.5);
}

#[test]
fn synthetic_cliffs_boulders_knolls_and_full_rasters_pipeline() {
    let (w, h) = (120, 120);
    let mut z = vec![20.0f32; w * h];
    for x in 0..w {
        for y in 0..h {
            // Gentle valley along y = 100..115 + steep east-west cliff at y = 60 (drop 6 m over 3 m -> >60 deg).
            let mut elev = 20.0f64 + 0.02 * x as f64;
            if y < 60 {
                elev += 6.0;
            } else if y < 63 {
                elev += 6.0 * (63 - y) as f64 / 3.0;
            }
            // Steep boulder at (25, 25): +1.6 m peak, sharp sides.
            let db = ((x as f64 - 25.0).powi(2) + (y as f64 - 25.0).powi(2)).sqrt();
            if db < 1.5 {
                elev += 1.6 * (1.0 - db / 1.5);
            }
            // Dry knoll at (55, 25): +1.4 m Gaussian sigma=2.5 m (foot ~ 20 m²).
            let dk = (x as f64 - 55.0).powi(2) + (y as f64 - 25.0).powi(2);
            elev += 1.4 * (-dk / (2.0 * 2.5 * 2.5)).exp();
            // Low marsh bump at (85, 25): +1.1 m (suppressed when wet < 1.5 m).
            let dm = (x as f64 - 85.0).powi(2) + (y as f64 - 25.0).powi(2);
            elev += 1.1 * (-dm / (2.0 * 2.5 * 2.5)).exp();
            z[x * h + y] = elev as f32;
        }
    }
    let ground = GroundGrid { min_x: 660_000.0, min_y: 6_570_000.0, cell: 1.0, width: w, height: h, z };

    // Cliff line must be extracted and oriented downhill to the right (north = +y is downhill, so line goes west -> east? Wait: right of E (+x) is S (-y); right of W (-x) is N (+y)!).
    let lines = slope_lines(&ground);
    assert!(!lines.is_empty(), "Expected cliff line from 6 m step");
    let (d3, d6, len) = measure_cliff(&lines[0], &ground);
    assert!(d3 > 4.5 && d6 > 4.5 && len > 20.0, "Expected impassable drop, got d3={d3}, d6={d6}, len={len}");

    // Boulders & knolls with marsh guard.
    let (stones, _) = detect_boulders(&ground, None);
    assert!(!stones.is_empty(), "Expected synthetic boulder to be detected");
    let mut wet = vec![0u8; w * h];
    for x in 75..95 {
        for y in 15..35 {
            wet[x * h + y] = 1;
        }
    }
    let cands = knoll_candidates(&ground, None, Some(&wet));
    let dry_cand = cands.iter().find(|c| (c.at[0] - 660_055.5).abs() < 3.0 && !c.wet);
    let wet_cand = cands.iter().find(|c| (c.at[0] - 660_085.5).abs() < 3.0 && c.wet);
    assert!(dry_cand.is_some(), "Expected dry knoll candidate");
    assert!(wet_cand.is_some(), "Expected wet knoll candidate marked wet=true");
    let chosen = choose_knolls(&cands, KNOLL_LOWER_SHARE);
    assert!(chosen.iter().any(|p| (p[0] - 660_055.5).abs() < 3.0), "Dry knoll must be chosen");
    assert!(!chosen.iter().any(|p| (p[0] - 660_085.5).abs() < 3.0), "Low marsh knoll (<1.5 m) must be suppressed");

    // End-to-end `execute_rasters` invocation writing all outputs + `rasters-summary.json`.
    let dir = temp_dir("e2e");
    let mark_path = dir.join("mark0.bin");
    let water_path = dir.join("vatten0.bin");
    let veg_png = dir.join("vegetationsklasser.png");
    let veg_pgw = dir.join("vegetationsklasser.pgw");
    let out_dir = dir.join("out");
    write_ground_bin(&mark_path, &ground);
    write_water_bin(&water_path, 660_000.0, 6_570_000.0, 2.0, 60, 60, &vec![1u8; 3600]);
    write_sub_png(&veg_png, 60, 60, |_r, row| {
        for px in row.chunks_exact_mut(4) {
            px.copy_from_slice(&[1, 160, 1, 255]); // open land
        }
    })
    .unwrap();
    std::fs::write(&veg_pgw, "2\n0\n0\n-2\n660001\n6570119\n").unwrap();

    let cli_args: Vec<String> = vec![
        "rasters",
        "--ground", mark_path.to_str().unwrap(),
        "--water", water_path.to_str().unwrap(),
        "--veg-png", veg_png.to_str().unwrap(),
        "--out", out_dir.to_str().unwrap(),
        "--height-rasters",
        "--moisture", "--channel-ha", "0.25", "--wet-meters", "0.25", "--moist-meters", "0.4",
        "--cliffs", "--cliff-min-drop", "1.3", "--cliff-impassable-drop", "4.5", "--cliff-impassable-length", "20",
        "--ditches-tracks",
        "--rock", "--rock-mode", "1", "--knolls",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    let parsed = parse_args(&cli_args).unwrap();
    let Mode::Rasters(cfg) = parsed.mode else { unreachable!() };
    let summary = execute_rasters(&cfg).unwrap();
    assert!(summary.cliffs201 >= 1);
    assert!(summary.boulders >= 1);
    assert!(summary.knolls >= 1);
    for expected in [
        "hojd.png", "hojd.pgw", "skuggning.png", "skuggning.pgw", "relief.png", "relief.pgw",
        "fukt.png", "fukt.pgw", "fuktdjup.png", "fuktdjup.pgw", "fukt.dxf",
        "brantlinjer.dxf", "brantlinjer.geojson", "berg.png", "berg.pgw", "berg.dxf",
        "kullar.geojson", "rasters-summary.json",
    ] {
        assert!(out_dir.join(expected).exists(), "Missing expected output {expected}");
    }
    let json_text = std::fs::read_to_string(out_dir.join("rasters-summary.json")).unwrap();
    let val: serde_json::Value = serde_json::from_str(&json_text).unwrap();
    for key in [
        "wetHa", "moistHa", "wetAreas", "moistAreas", "channels", "terrainChannels",
        "cliffs201", "cliffs202", "cliffMeters201", "cliffMeters202", "cliffsDropped",
        "ditches", "tracks", "boulders", "knolls", "bareRockAreas",
        "msHeight", "msMoisture", "msCliffs", "msTracks", "msRock", "msTotal",
    ] {
        assert!(val.get(key).is_some(), "rasters-summary.json missing key {key}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}
