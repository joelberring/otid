//! Multi-threaded MIT-Rust raster & vector acceleration engine (`otidgeo rasters`).
//!
//! Reads merged or per-tile `mark.bin` (plus optional `vatten.bin`, `punkter.bin`, and
//! `vegetationsklasser.png`) and produces O-Tid's heavy raster and vector outputs in one
//! parallel rayon pipeline with exact binary/PNG/DXF/GeoJSON parity.

pub mod cliffs;
pub mod ditches;
pub mod geom;
pub mod grid_io;
pub mod height;
pub mod knolls;
pub mod moisture;
pub mod rock;
pub mod skeleton;
pub mod tracks;

#[cfg(test)]
mod tests;

use crate::rasters::cliffs::{run_cliffs, CliffRules, CliffSummary};
use crate::rasters::geom::local_relief;
use crate::rasters::grid_io::{
    load_ground_grids, load_point_stats, load_veg_masks, load_water_data, PointStats, WaterData,
};
use crate::rasters::height::{write_height_png, write_hillshade_png, write_relief_png, DEFAULT_MAX_SIDE};
use crate::rasters::knolls::KNOLL_LOWER_SHARE;
use crate::rasters::moisture::{run_moisture, MoistureResult, MoistureSettings};
use crate::rasters::rock::{run_rock_and_knolls, RockSummary};
use crate::rasters::tracks::{run_ditches_tracks, DitchesTracksSummary};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;

/// CLI configuration for `otidgeo rasters`.
#[derive(Clone, Debug)]
pub struct RastersConfig {
    pub ground_paths: Vec<PathBuf>,
    pub water_paths: Vec<PathBuf>,
    pub point_paths: Vec<PathBuf>,
    pub veg_png: Option<PathBuf>,
    pub veg_pgw: Option<PathBuf>,
    pub out_dir: PathBuf,
    pub gap_fill_rounds: usize,

    pub height_rasters: bool,
    pub point_images: bool,
    pub water_geojson: bool,

    pub moisture: bool,
    pub moisture_settings: MoistureSettings,

    pub cliffs: bool,
    pub cliff_rules: CliffRules,
    pub cliff_c3g: Option<PathBuf>,
    pub cliff_c2g: Option<PathBuf>,

    pub ditches_tracks: bool,

    pub rock: bool,
    pub rock_mode: u8,
    pub knolls: bool,
    pub knoll_share: f64,
}

impl Default for RastersConfig {
    fn default() -> Self {
        Self {
            ground_paths: Vec::new(),
            water_paths: Vec::new(),
            point_paths: Vec::new(),
            veg_png: None,
            veg_pgw: None,
            out_dir: PathBuf::new(),
            gap_fill_rounds: 4,
            height_rasters: false,
            point_images: false,
            water_geojson: false,
            moisture: false,
            moisture_settings: MoistureSettings::default(),
            cliffs: false,
            cliff_rules: CliffRules::default(),
            cliff_c3g: None,
            cliff_c2g: None,
            ditches_tracks: false,
            rock: false,
            rock_mode: 1,
            knolls: false,
            knoll_share: KNOLL_LOWER_SHARE,
        }
    }
}

/// Output summary serialized to `rasters-summary.json` in `--out`.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RastersSummary {
    pub water_ha: f64,
    pub water_areas: usize,
    pub wet_ha: f64,
    pub moist_ha: f64,
    pub wet_areas: usize,
    pub moist_areas: usize,
    pub channels: usize,
    pub terrain_channels: usize,
    pub cliffs201: usize,
    pub cliffs202: usize,
    pub cliff_meters201: usize,
    pub cliff_meters202: usize,
    pub cliffs_dropped: usize,
    pub ditches: usize,
    pub tracks: usize,
    pub boulders: usize,
    pub knolls: usize,
    pub bare_rock_areas: usize,
    pub capped_points: usize,
    pub ms_height: f64,
    pub ms_moisture: f64,
    pub ms_cliffs: f64,
    pub ms_tracks: f64,
    pub ms_rock: f64,
    pub ms_total: f64,
}

#[inline]
fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Executes all enabled raster/vector steps in parallel and writes `rasters-summary.json`.
pub fn execute_rasters(cfg: &RastersConfig) -> Result<RastersSummary, String> {
    let t_total = Instant::now();
    std::fs::create_dir_all(&cfg.out_dir)
        .map_err(|e| format!("Failed to create output directory {}: {e}", cfg.out_dir.display()))?;

    // Load ground, optional water, and optional point stats concurrently.
    let water_geo = cfg.water_geojson.then(|| cfg.out_dir.join("vatten.geojson"));
    let (ground_res, (water_res, points_res)) = rayon::join(
        || load_ground_grids(&cfg.ground_paths, cfg.gap_fill_rounds),
        || {
            rayon::join(
                || -> Result<Option<WaterData>, String> {
                    if cfg.water_paths.is_empty() {
                        Ok(None)
                    } else {
                        load_water_data(&cfg.water_paths, water_geo.as_deref()).map(Some)
                    }
                },
                || -> Result<Option<PointStats>, String> {
                    if cfg.point_paths.is_empty() {
                        Ok(None)
                    } else {
                        load_point_stats(&cfg.point_paths).map(Some)
                    }
                },
            )
        },
    );
    let ground = ground_res?;
    let water = water_res?;
    let points = points_res?;

    // Precompute shared 1 m water mask, optional veg masks, and optional 4 m local relief in parallel.
    let need_relief_4m = cfg.height_rasters || cfg.ditches_tracks;
    let ((water_mask_1m, veg_masks_res), relief_4m) = rayon::join(
        || {
            rayon::join(
                || water.as_ref().map(|wd| ground.mask_of(|x, y| wd.is_water(x, y))),
                || -> Result<Option<(Vec<u8>, Vec<u8>)>, String> {
                    match &cfg.veg_png {
                        Some(p) => load_veg_masks(p, cfg.veg_pgw.as_deref(), &ground).map(Some),
                        None => Ok(None),
                    }
                },
            )
        },
        || need_relief_4m.then(|| local_relief(&ground, 4.0)),
    );
    let veg_masks = veg_masks_res?;

    // Phase A: run Moisture, Height+Relief+PointImages, and Cliffs concurrently!
    let mut height_res: Result<f64, String> = Ok(0.0);
    let mut moisture_res: Result<Option<(MoistureResult, f64)>, String> = Ok(None);
    let mut cliffs_res: Result<Option<(CliffSummary, f64)>, String> = Ok(None);

    rayon::scope(|s| {
        s.spawn(|_| {
            if cfg.height_rasters || cfg.ditches_tracks || (cfg.point_images && points.is_some()) {
                let t0 = Instant::now();
                let mut r_hojd = Ok(());
                let mut r_shade = Ok(());
                let mut r_rel = Ok(());
                let mut r_pts = Ok(());
                rayon::scope(|hs| {
                    if cfg.height_rasters {
                        hs.spawn(|_| r_hojd = write_height_png(&cfg.out_dir, &ground));
                        hs.spawn(|_| r_shade = write_hillshade_png(&cfg.out_dir, &ground, DEFAULT_MAX_SIDE));
                    }
                    if let Some(rel) = relief_4m.as_deref() {
                        hs.spawn(|_| r_rel = write_relief_png(&cfg.out_dir, &ground, rel, DEFAULT_MAX_SIDE));
                    }
                    if cfg.point_images {
                        if let Some(pts) = points.as_ref() {
                            hs.spawn(|_| r_pts = pts.write_point_images(&cfg.out_dir));
                        }
                    }
                });
                height_res = r_hojd
                    .and(r_shade)
                    .and(r_rel)
                    .and(r_pts)
                    .map(|()| t0.elapsed().as_secs_f64() * 1000.0);
            }
        });
        s.spawn(|_| {
            if cfg.moisture {
                let t0 = Instant::now();
                moisture_res = run_moisture(
                    &ground,
                    cfg.moisture_settings,
                    water.as_ref(),
                    points.as_ref(),
                    &cfg.out_dir,
                )
                .map(|m| Some((m, t0.elapsed().as_secs_f64() * 1000.0)));
            }
        });
        s.spawn(|_| {
            if cfg.cliffs {
                let t0 = Instant::now();
                cliffs_res = run_cliffs(
                    &ground,
                    cfg.cliff_rules,
                    cfg.cliff_c3g.as_deref(),
                    cfg.cliff_c2g.as_deref(),
                    &cfg.out_dir,
                )
                .map(|c| Some((c, t0.elapsed().as_secs_f64() * 1000.0)));
            }
        });
    });

    let ms_height = height_res?;
    let moisture_out = moisture_res?;
    let cliffs_out = cliffs_res?;
    let wet_mask_1m = moisture_out.as_ref().map(|(m, _)| m.wet_mask_1m.as_slice());

    // Phase B: run Ditches+Tracks and Rock+Knolls concurrently (both consume wet_mask_1m)!
    let (tracks_res, rock_res) = rayon::join(
        || -> Result<Option<(DitchesTracksSummary, f64)>, String> {
            if !cfg.ditches_tracks {
                return Ok(None);
            }
            let t0 = Instant::now();
            let rel = relief_4m.as_deref().expect("relief_4m computed when ditches_tracks enabled");
            let res = run_ditches_tracks(
                &ground,
                rel,
                wet_mask_1m,
                water_mask_1m.as_deref(),
                &cfg.out_dir,
            )?;
            Ok(Some((res, t0.elapsed().as_secs_f64() * 1000.0)))
        },
        || -> Result<Option<(RockSummary, f64)>, String> {
            if !cfg.rock {
                return Ok(None);
            }
            let t0 = Instant::now();
            let res = run_rock_and_knolls(
                &ground,
                cfg.rock_mode,
                cfg.knolls,
                cfg.knoll_share,
                veg_masks.as_ref(),
                water_mask_1m.as_deref(),
                wet_mask_1m,
                &cfg.out_dir,
            )?;
            Ok(Some((res, t0.elapsed().as_secs_f64() * 1000.0)))
        },
    );
    let tracks_out = tracks_res?;
    let rock_out = rock_res?;

    let mut summary = RastersSummary {
        ms_height: round1(ms_height),
        ms_total: round1(t_total.elapsed().as_secs_f64() * 1000.0),
        ..Default::default()
    };
    if let Some(wd) = &water {
        summary.water_ha = wd.water_ha;
        summary.water_areas = wd.water_areas;
    }
    if let Some((m, ms)) = &moisture_out {
        summary.wet_ha = m.wet_ha;
        summary.moist_ha = m.moist_ha;
        summary.wet_areas = m.wet_areas;
        summary.moist_areas = m.moist_areas;
        summary.channels = m.channels;
        summary.ms_moisture = round1(*ms);
    }
    if let Some((c, ms)) = &cliffs_out {
        summary.cliffs201 = c.cliffs_201;
        summary.cliffs202 = c.cliffs_202;
        summary.cliff_meters201 = c.cliff_meters_201;
        summary.cliff_meters202 = c.cliff_meters_202;
        summary.cliffs_dropped = c.cliffs_dropped;
        summary.ms_cliffs = round1(*ms);
    }
    if let Some((t, ms)) = &tracks_out {
        summary.ditches = t.ditches;
        summary.terrain_channels = t.terrain_channels;
        summary.tracks = t.tracks;
        summary.ms_tracks = round1(*ms);
    }
    if let Some((r, ms)) = &rock_out {
        summary.boulders = r.boulders;
        summary.knolls = r.knolls;
        summary.bare_rock_areas = r.bare_rock_areas;
        summary.capped_points = r.capped_points;
        summary.ms_rock = round1(*ms);
    }
    summary.ms_total = round1(t_total.elapsed().as_secs_f64() * 1000.0);

    let json = serde_json::to_string_pretty(&summary)
        .map_err(|e| format!("Failed serializing rasters-summary.json: {e}"))?;
    std::fs::write(cfg.out_dir.join("rasters-summary.json"), format!("{json}\n"))
        .map_err(|e| format!("Failed writing rasters-summary.json: {e}"))?;

    Ok(summary)
}
