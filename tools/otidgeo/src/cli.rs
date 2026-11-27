//! Command-line argument parsing for `otidgeo` (`run`, `bench-map`, `veg`, `rasters`).

use crate::rasters::RastersConfig;
use crate::types::{ContourProfile, EngineConfig, FormlineMode};
use std::path::PathBuf;

pub enum Mode {
    Run { inputs: Vec<PathBuf> },
    BenchMap { dir: PathBuf },
    Veg { inputs: Vec<PathBuf> },
    Rasters(Box<RastersConfig>),
}

pub struct CliArgs {
    pub mode: Mode,
    pub out_dir: PathBuf,
    pub config: EngineConfig,
}

fn parse_f64(flag: &str, val: Option<&String>) -> Result<f64, String> {
    let s = val.ok_or_else(|| format!("Missing value for {flag}"))?;
    let v = s.parse::<f64>().map_err(|_| format!("Invalid number for {flag}: {s}"))?;
    if !v.is_finite() {
        return Err(format!("Non-finite number for {flag}: {s}"));
    }
    Ok(v)
}

fn parse_profile(val: &str) -> Result<ContourProfile, String> {
    match val.to_ascii_lowercase().as_str() {
        "very-detailed" | "very_detailed" => Ok(ContourProfile::VeryDetailed),
        "detailed" => Ok(ContourProfile::Detailed),
        "normal" => Ok(ContourProfile::Normal),
        "generalized" => Ok(ContourProfile::Generalized),
        "very-generalized" | "very_generalized" => Ok(ContourProfile::VeryGeneralized),
        other => Err(format!(
            "Invalid --profile '{other}' (expected very-detailed|detailed|normal|generalized|very-generalized)"
        )),
    }
}

fn parse_formline_mode(val: &str) -> Result<FormlineMode, String> {
    match val.to_ascii_lowercase().as_str() {
        "off" => Ok(FormlineMode::Off),
        "sparse" => Ok(FormlineMode::Sparse),
        "normal" => Ok(FormlineMode::Normal),
        "dense" => Ok(FormlineMode::Dense),
        other => Err(format!(
            "Invalid --formline-mode '{other}' (expected off|sparse|normal|dense)"
        )),
    }
}

pub fn parse_args(args: &[String]) -> Result<CliArgs, String> {
    if args.is_empty() || args[0] == "-h" || args[0] == "--help" {
        return Err(usage());
    }
    let sub = args[0].as_str();
    if sub == "rasters" {
        let cfg = parse_rasters_args(&args[1..])?;
        let out_dir = cfg.out_dir.clone();
        return Ok(CliArgs {
            mode: Mode::Rasters(Box::new(cfg)),
            out_dir,
            config: EngineConfig::defaults_for_interval(5.0),
        });
    }
    let sub_kind = match sub {
        "run" => 0u8,
        "bench-map" => 1u8,
        "veg" => 2u8,
        other => return Err(format!("Unknown subcommand '{other}'.\n\n{}", usage())),
    };

    // Pass 1: pre-scan `--interval` so interval-dependent defaults initialize first.
    let mut interval = 5.0f64;
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--interval" {
            interval = parse_f64("--interval", args.get(i + 1))?;
            i += 2;
        } else {
            i += 1;
        }
    }

    let mut config = EngineConfig::defaults_for_interval(interval);

    // Pass 2: apply `--profile` before individual overrides.
    let mut p = 1;
    while p < args.len() {
        if args[p] == "--profile" {
            let val = args.get(p + 1).ok_or("Missing value for --profile")?;
            config.apply_profile(parse_profile(val)?);
            p += 2;
        } else {
            p += 1;
        }
    }

    // Pass 3: apply `--formline-mode` before explicit `--formline-*` overrides.
    let mut j = 1;
    while j < args.len() {
        if args[j] == "--formline-mode" {
            let val = args.get(j + 1).ok_or("Missing value for --formline-mode")?;
            config.apply_formline_mode(parse_formline_mode(val)?);
            j += 2;
        } else {
            j += 1;
        }
    }

    let mut inputs: Vec<PathBuf> = Vec::new();
    let mut bench_dir: Option<PathBuf> = None;
    let mut out_dir: Option<PathBuf> = None;

    // Pass 4: individual flags always override profile & mode presets.
    let mut k = 1;
    while k < args.len() {
        let flag = args[k].as_str();
        match flag {
            "--input" => {
                let v = args.get(k + 1).ok_or("Missing value for --input")?;
                inputs.push(PathBuf::from(v));
                k += 2;
            }
            "--dir" => {
                let v = args.get(k + 1).ok_or("Missing value for --dir")?;
                bench_dir = Some(PathBuf::from(v));
                k += 2;
            }
            "--out" => {
                let v = args.get(k + 1).ok_or("Missing value for --out")?;
                out_dir = Some(PathBuf::from(v));
                k += 2;
            }
            "--interval" | "--profile" | "--formline-mode" => {
                k += 2; // Already applied in passes 1–3.
            }
            "--index-every" => {
                config.index_every = parse_f64(flag, args.get(k + 1))?.round() as i32;
                k += 2;
            }
            "--level-offset" => {
                config.level_offset = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--scale" => {
                config.scale = parse_f64(flag, args.get(k + 1))?.round().max(500.0) as u32;
                k += 2;
            }
            "--smooth-m" => {
                config.smooth_m = parse_f64(flag, args.get(k + 1))?.max(0.0);
                k += 2;
            }
            "--flat-smooth-m" => {
                config.flat_smooth_m = Some(parse_f64(flag, args.get(k + 1))?.max(0.0));
                k += 2;
            }
            "--taubin-passes" => {
                let raw = args.get(k + 1).ok_or("Missing value for --taubin-passes")?;
                let n = raw
                    .parse::<usize>()
                    .map_err(|_| format!("Invalid integer for --taubin-passes: {raw} (expected 0..=6)"))?;
                if n > 6 {
                    return Err(format!("--taubin-passes must be in 0..=6, got {n}"));
                }
                config.taubin_passes = n;
                k += 2;
            }
            "--curviness" => {
                config.curviness = parse_f64(flag, args.get(k + 1))?.clamp(0.0, 0.8);
                k += 2;
            }
            "--min-loop-area-m2" => {
                config.min_loop_area_m2 = parse_f64(flag, args.get(k + 1))?.max(0.0);
                k += 2;
            }
            "--min-clearance-m" => {
                config.min_clearance_m = parse_f64(flag, args.get(k + 1))?.max(0.0);
                k += 2;
            }
            "--simplify-m" => {
                config.simplify_m = parse_f64(flag, args.get(k + 1))?.max(0.0);
                k += 2;
            }
            "--knoll-min-rise" => {
                config.knoll_min_rise_m = parse_f64(flag, args.get(k + 1))?.max(0.2);
                k += 2;
            }
            "--knoll-share" => {
                config.knoll_lower_share = parse_f64(flag, args.get(k + 1))?.clamp(0.3, 1.0);
                k += 2;
            }
            "--knoll-spacing" => {
                config.knoll_spacing_m = parse_f64(flag, args.get(k + 1))?.max(2.0);
                k += 2;
            }
            "--knoll-max-foot-m2" => {
                config.knoll_max_foot_m2 = parse_f64(flag, args.get(k + 1))?.max(15.0);
                k += 2;
            }
            "--formline-min-gap-m" => {
                config.formline_min_gap_m = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--formline-min-slope-deg" => {
                config.formline_min_slope_deg = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--formline-max-slope-deg" => {
                config.formline_max_slope_deg = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--formline-min-length-m" => {
                config.formline_min_length_m = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--formline-min-loop-area-m2" => {
                config.formline_min_loop_area_m2 = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--veg-smooth" => {
                config.veg_smooth = parse_f64(flag, args.get(k + 1))?.clamp(0.0, 3.0);
                k += 2;
            }
            "--open-max-height-m" => {
                config.open_max_height_m = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--open-min-ground-share" | "--open-share" => {
                config.open_min_ground_share = parse_f64(flag, args.get(k + 1))?.clamp(0.0, 1.0);
                k += 2;
            }
            "--green-scale" => {
                config.green_scale = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--green-low-thresh" => {
                config.green_low_thresh = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--green-med-thresh" => {
                config.green_med_thresh = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--green-high-thresh" => {
                config.green_high_thresh = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--undergrowth-thresh" => {
                config.undergrowth_thresh = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--canopy-weight" => {
                config.canopy_weight = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--steep-cutoff-deg" => {
                config.steep_cutoff_deg = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--min-veg-area-m2" => {
                config.min_veg_area_m2 = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--bbox" | "--clip" => {
                let s = args.get(k + 1).ok_or_else(|| format!("Missing value for {flag}"))?;
                let parts: Vec<f64> = s
                    .split(',')
                    .map(|p| p.trim().parse::<f64>().map_err(|_| format!("Invalid {flag} number: {p}")))
                    .collect::<Result<_, _>>()?;
                if parts.len() != 4 {
                    return Err(format!("{flag} requires 4 comma-separated numbers: minx,miny,maxx,maxy"));
                }
                config.bbox = Some([parts[0], parts[1], parts[2], parts[3]]);
                k += 2;
            }
            "--overview" => {
                config.overview = true;
                k += 1;
            }
            "--include-intermed" => {
                config.include_intermed = true;
                k += 1;
            }
            other => return Err(format!("Unknown flag '{other}'.\n\n{}", usage())),
        }
    }

    let out_dir = out_dir.ok_or("Missing required --out <dir>")?;
    let mode = match sub_kind {
        0 => {
            if inputs.is_empty() {
                return Err("Subcommand 'run' requires at least one --input <file.laz|.las>".into());
            }
            Mode::Run { inputs }
        }
        1 => {
            let dir = bench_dir.ok_or("Subcommand 'bench-map' requires --dir <map_dir>")?;
            Mode::BenchMap { dir }
        }
        _ => {
            if inputs.is_empty() {
                return Err("Subcommand 'veg' requires at least one --input <file.laz|.las>".into());
            }
            Mode::Veg { inputs }
        }
    };

    Ok(CliArgs { mode, out_dir, config })
}

fn parse_rasters_args(args: &[String]) -> Result<RastersConfig, String> {
    let mut cfg = RastersConfig::default();
    let mut out_dir: Option<PathBuf> = None;
    let mut k = 0usize;
    while k < args.len() {
        let flag = args[k].as_str();
        match flag {
            "--ground" => {
                let v = args.get(k + 1).ok_or("Missing value for --ground")?;
                cfg.ground_paths.push(PathBuf::from(v));
                k += 2;
            }
            "--water" => {
                let v = args.get(k + 1).ok_or("Missing value for --water")?;
                cfg.water_paths.push(PathBuf::from(v));
                k += 2;
            }
            "--points" => {
                let v = args.get(k + 1).ok_or("Missing value for --points")?;
                cfg.point_paths.push(PathBuf::from(v));
                k += 2;
            }
            "--veg-png" => {
                let v = args.get(k + 1).ok_or("Missing value for --veg-png")?;
                cfg.veg_png = Some(PathBuf::from(v));
                k += 2;
            }
            "--veg-pgw" => {
                let v = args.get(k + 1).ok_or("Missing value for --veg-pgw")?;
                cfg.veg_pgw = Some(PathBuf::from(v));
                k += 2;
            }
            "--out" => {
                let v = args.get(k + 1).ok_or("Missing value for --out")?;
                out_dir = Some(PathBuf::from(v));
                k += 2;
            }
            "--gap-fill-rounds" => {
                let raw = args.get(k + 1).ok_or("Missing value for --gap-fill-rounds")?;
                cfg.gap_fill_rounds = raw
                    .parse::<usize>()
                    .map_err(|_| format!("Invalid integer for --gap-fill-rounds: {raw}"))?;
                k += 2;
            }
            "--height-rasters" => {
                cfg.height_rasters = true;
                k += 1;
            }
            "--point-images" => {
                cfg.point_images = true;
                k += 1;
            }
            "--water-geojson" => {
                cfg.water_geojson = true;
                k += 1;
            }
            "--moisture" => {
                cfg.moisture = true;
                k += 1;
            }
            "--channel-ha" => {
                cfg.moisture_settings.channel_ha = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--wet-meters" => {
                cfg.moisture_settings.wet_meters = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--moist-meters" => {
                cfg.moisture_settings.moist_meters = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--channel-line-ha" => {
                cfg.moisture_settings.channel_line_ha = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--cliffs" => {
                cfg.cliffs = true;
                k += 1;
            }
            "--cliff-min-drop" => {
                cfg.cliff_rules.min_drop = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--cliff-impassable-drop" => {
                let v = parse_f64(flag, args.get(k + 1))?;
                cfg.cliff_rules.impassable_drop3 = v;
                cfg.cliff_rules.impassable_drop6 = v;
                k += 2;
            }
            "--cliff-impassable-length" => {
                cfg.cliff_rules.impassable_length = parse_f64(flag, args.get(k + 1))?;
                k += 2;
            }
            "--cliff-tags" => {
                cfg.cliff_rules.tags = true;
                k += 1;
            }
            "--cliff-c3g" => {
                let v = args.get(k + 1).ok_or("Missing value for --cliff-c3g")?;
                cfg.cliff_c3g = Some(PathBuf::from(v));
                k += 2;
            }
            "--cliff-c2g" => {
                let v = args.get(k + 1).ok_or("Missing value for --cliff-c2g")?;
                cfg.cliff_c2g = Some(PathBuf::from(v));
                k += 2;
            }
            "--ditches-tracks" => {
                cfg.ditches_tracks = true;
                k += 1;
            }
            "--rock" => {
                cfg.rock = true;
                k += 1;
            }
            "--rock-mode" => {
                let raw = args.get(k + 1).ok_or("Missing value for --rock-mode")?;
                let mode = raw
                    .parse::<u8>()
                    .map_err(|_| format!("Invalid integer for --rock-mode: {raw} (expected 0|1|2)"))?;
                if mode > 2 {
                    return Err(format!("--rock-mode must be 0, 1, or 2, got {mode}"));
                }
                cfg.rock_mode = mode;
                k += 2;
            }
            "--knolls" => {
                cfg.knolls = true;
                k += 1;
            }
            "--knoll-share" => {
                cfg.knoll_share = parse_f64(flag, args.get(k + 1))?.clamp(0.3, 1.0);
                k += 2;
            }
            "-h" | "--help" => return Err(usage()),
            other => return Err(format!("Unknown rasters flag '{other}'.\n\n{}", usage())),
        }
    }
    if cfg.ground_paths.is_empty() {
        return Err("Subcommand 'rasters' requires at least one --ground <mark.bin>".into());
    }
    cfg.out_dir = out_dir.ok_or("Subcommand 'rasters' requires --out <dir>")?;
    Ok(cfg)
}

pub fn usage() -> String {
    "Usage:\n  otidgeo run --input <file.laz|.las> [--input ...] --out <dir> [options]\n  otidgeo veg --input <file.laz|.las> [--input ...] --out <dir> [veg options]\n  otidgeo rasters --ground <mark.bin> [--ground ...] --out <dir> [raster options]\n  otidgeo bench-map --dir <map_dir> --out <dir> [options]\n\nProfiles (individual flags always override profile):\n  --profile very-detailed|detailed|normal|generalized|very-generalized (default normal)\n\nKey contour & knoll options:\n  --interval <m> (default 5.0; 2.5 for sprint)   --level-offset <m> (0.0)\n  --smooth-m <m> (1.08 / 0.78 hilly sigma)       --flat-smooth-m <m> (auto 2.86 / 1.91)\n  --taubin-passes <0..6> (2)                     --curviness <0..0.8> (0.18)\n  --min-loop-area-m2 <m2> (36 / 15)              --min-clearance-m <m> (1.55 / 0.90)\n  --simplify-m <m> (0.20)                        --knoll-min-rise <m> (0.95 / 0.75)\n  --knoll-share <0.3..1> (0.80)                  --knoll-spacing <m> (13 / 9)\n  --knoll-max-foot-m2 <m2> (135 / 80)            --formline-mode off|sparse|normal|dense\n  --formline-min-gap-m <m> (4.1 / 3.2)           --formline-min-slope-deg <deg> (2.55 / 2.85)\n  --formline-max-slope-deg <deg> (20.5 / 20.0)   --formline-min-length-m <m> (9.5 / 8.5)\n  --formline-min-loop-area-m2 <m2> (30 / 18)\n\nKey vegetation options:\n  --veg-smooth <0..3> (1.05; 0.65 detailed)      --open-share <0..1> (0.63)\n  --open-max-height-m <m> (1.5)                  --green-scale <mult> (1.0)\n  --canopy-weight <f> (0.34)                     --undergrowth-thresh <f> (0.058)\n  --green-low-thresh <f>                         --green-med-thresh <f>\n  --green-high-thresh <f>                        --steep-cutoff-deg <deg> (35.0)\n  --min-veg-area-m2 <m2> (300)                   --bbox|--clip <minx,miny,maxx,maxy> --overview\n\nRaster acceleration options (`otidgeo rasters`):\n  --ground <mark.bin> (repeatable)               --water <vatten.bin> (repeatable)\n  --points <punkter.bin> (repeatable)            --veg-png <vegetationsklasser.png>\n  --gap-fill-rounds <N> (default 4)              --height-rasters --point-images --water-geojson\n  --moisture [--channel-ha 1] [--wet-meters 0.25] [--moist-meters 0.4] [--channel-line-ha 5]\n  --cliffs [--cliff-min-drop 1.3] [--cliff-impassable-drop 4.5] [--cliff-impassable-length 20] [--cliff-tags]\n  --ditches-tracks                               --rock [--rock-mode 0|1|2] [--knolls] [--knoll-share 0.85]".into()
}
