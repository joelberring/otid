//! Core grid, geometry, configuration, and summary types for `otidgeo`.
//!
//! All raster grids use a single consistent north-up, row-major layout:
//! - Index `row * width + col` (`row = 0` is northernmost, `col = 0` is westernmost).
//! - Center of pixel `(col, row)` is `(x0 + col * cell, y0 - row * cell)`.
//! - World file (`.pgw`) lines are `cell, 0, 0, -cell, x0, y0`.

use serde::Serialize;

/// World-to-pixel affine transform for north-up square pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorldTransform {
    /// Pixel spacing in meters (> 0).
    pub cell: f64,
    /// Easting (X) at the center of pixel `(0, 0)`.
    pub x0: f64,
    /// Northing (Y) at the center of pixel `(0, 0)`.
    pub y0: f64,
}

impl WorldTransform {
    #[inline]
    pub fn col_to_x(&self, col: f64) -> f64 {
        self.x0 + col * self.cell
    }

    #[inline]
    pub fn row_to_y(&self, row: f64) -> f64 {
        self.y0 - row * self.cell
    }

    #[inline]
    pub fn x_to_col_f(&self, x: f64) -> f64 {
        (x - self.x0) / self.cell
    }

    #[inline]
    pub fn y_to_row_f(&self, y: f64) -> f64 {
        (self.y0 - y) / self.cell
    }

    /// Formats a standard 6-line ESRI world file (`.pgw`).
    pub fn to_pgw(&self) -> String {
        format!("{}\n0\n0\n{}\n{}\n{}\n", self.cell, -self.cell, self.x0, self.y0)
    }

    /// Parses a standard 6-line world file (`.pgw`).
    pub fn from_pgw(text: &str) -> Result<Self, String> {
        let vals: Vec<f64> = text
            .split_whitespace()
            .map(|s| s.parse::<f64>().map_err(|e| format!("Invalid number in pgw: {e}")))
            .collect::<Result<_, _>>()?;
        if vals.len() < 6 || vals.iter().take(6).any(|v| !v.is_finite()) {
            return Err("World file must contain 6 finite numbers".into());
        }
        let cell = vals[0];
        if !(cell > 0.0) || (vals[0] + vals[3]).abs() > 1e-4 {
            return Err(format!("Unsupported world file pixel scale: dx={}, dy={}", vals[0], vals[3]));
        }
        Ok(Self { cell, x0: vals[4], y0: vals[5] })
    }
}

/// Seamless 1 m (or general `cell`) digital elevation model.
#[derive(Clone, Debug)]
pub struct DemGrid {
    pub width: usize,
    pub height: usize,
    pub world: WorldTransform,
    /// Ground elevation in meters (`f32::NAN` where missing before gap filling).
    pub z: Vec<f32>,
    /// 1 where elevation is supported by real data (not exterior nodata or water).
    pub valid: Vec<u8>,
    /// 1 where cell is open water (class 9 in LAZ or masked water in bench-map).
    pub water: Vec<u8>,
    /// 1 where cell is wet / marsh ground (from `fuktdjup.png` or flat shoreline wetland).
    pub wet: Vec<u8>,
}

impl DemGrid {
    /// Bilinearly samples `z` at world coordinate `(x, y)` if all surrounding corners are finite.
    #[inline]
    pub fn sample_bilinear(&self, x: f64, y: f64) -> Option<f32> {
        let fc = self.world.x_to_col_f(x);
        let fr = self.world.y_to_row_f(y);
        if fc < 0.0 || fr < 0.0 {
            return None;
        }
        let c0 = fc.floor() as usize;
        let r0 = fr.floor() as usize;
        if c0 + 1 >= self.width || r0 + 1 >= self.height {
            let cn = fc.round() as isize;
            let rn = fr.round() as isize;
            if cn >= 0 && rn >= 0 && (cn as usize) < self.width && (rn as usize) < self.height {
                let v = self.z[rn as usize * self.width + cn as usize];
                return v.is_finite().then_some(v);
            }
            return None;
        }
        let tx = (fc - c0 as f64) as f32;
        let ty = (fr - r0 as f64) as f32;
        let z00 = self.z[r0 * self.width + c0];
        let z10 = self.z[r0 * self.width + c0 + 1];
        let z01 = self.z[(r0 + 1) * self.width + c0];
        let z11 = self.z[(r0 + 1) * self.width + c0 + 1];
        if !(z00.is_finite() && z10.is_finite() && z01.is_finite() && z11.is_finite()) {
            return None;
        }
        let top = z00 + (z10 - z00) * tx;
        let bot = z01 + (z11 - z01) * tx;
        Some(top + (bot - top) * ty)
    }
}

/// 2 m point-cloud feature grid used by the clean-room vegetation module.
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct VegFeatures {
    pub width: usize,
    pub height: usize,
    pub world: WorldTransform,
    /// 1 where cell has LiDAR data (not outside clip / nodata).
    pub valid: Vec<u8>,
    /// 1 where cell is open water.
    pub water: Vec<u8>,
    /// 90th-percentile (or top) vegetation height above ground in meters.
    pub vegh: Vec<f32>,
    /// Fraction of returns classified as ground (0..1).
    pub ground_share: Vec<f32>,
    /// Fraction of returns in 0.3–1.0 m above ground (0..1).
    pub low_share: Vec<f32>,
    /// Fraction of returns in 1.0–3.0 m above ground (0..1).
    pub mid_share: Vec<f32>,
    /// Fraction of returns > 3.0 m above ground (0..1).
    pub high_share: Vec<f32>,
    /// Multi-return or non-ground ratio (0..1).
    pub return_ratio: Vec<f32>,
    /// Total non-noise return count in cell.
    pub npts: Vec<f32>,
    /// Mean ground return intensity.
    pub ground_intensity: Vec<f32>,
    /// RMS height spread of ground returns in meters.
    pub spread: Vec<f32>,
    /// Terrain slope in degrees.
    pub slope_deg: Vec<f32>,
}

/// Layer classification for contour polylines.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContourLayer {
    Contour,
    ContourIndex,
    Depression,
    DepressionIndex,
    ContourIntermed,
    Formline,
}

impl ContourLayer {
    pub fn dxf_name(self) -> &'static str {
        match self {
            Self::Contour => "contour",
            Self::ContourIndex => "contour_index",
            Self::Depression => "depression",
            Self::DepressionIndex => "depression_index",
            Self::ContourIntermed => "contour_intermed",
            Self::Formline => "formline",
        }
    }
}

/// A 2D polyline in projected coordinates (meters) at a given elevation.
#[derive(Clone, Debug)]
pub struct ContourLine {
    pub layer: ContourLayer,
    pub elevation: f64,
    pub closed: bool,
    pub points: Vec<[f64; 2]>,
}

/// Classification of a small terrain point feature (`knollar.dxf`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KnollKind {
    /// Round small knoll (`dotknoll`, ISOM 109).
    Round,
    /// Elongated small knoll (`dotknoll_avlang`, ISOM 110).
    Elongated,
    /// Small depression / pit (`udepression`, ISOM 111).
    Pit,
}

/// A small hill (`dotknoll`, ISOM 109), elongated hill (`dotknoll_avlang`, ISOM 110),
/// or small pit (`udepression`, ISOM 111).
#[derive(Clone, Copy, Debug)]
pub struct KnollPoint {
    pub kind: KnollKind,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// Major-axis angle in degrees CCW from East (`+X`), in `[0, 180)`, set for `Elongated`.
    pub angle_deg: Option<f64>,
}

impl KnollPoint {
    #[inline]
    pub fn is_depression(self) -> bool {
        self.kind == KnollKind::Pit
    }

    pub fn dxf_layer(self) -> &'static str {
        match self.kind {
            KnollKind::Round => "dotknoll",
            KnollKind::Elongated => "dotknoll_avlang",
            KnollKind::Pit => "udepression",
        }
    }
}

/// Calibrated contour detail profile (from near-raw laser up to strongly generalized).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContourProfile {
    VeryDetailed,
    Detailed,
    Normal,
    Generalized,
    VeryGeneralized,
}

/// Preset mode for directly controllable formlines (ISOM 103).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FormlineMode {
    Off,
    Sparse,
    Normal,
    Dense,
}

/// Complete engine configuration (every parameter physically meaningful & CLI-controllable).
#[derive(Clone, Debug)]
pub struct EngineConfig {
    pub profile: ContourProfile,
    pub interval: f64,
    pub index_every: i32,
    pub level_offset: f64,
    pub scale: u32,
    pub smooth_m: f64,
    /// Optional explicit flat-ground smoothing sigma (m); when `None`, smoothly derived from `smooth_m`.
    pub flat_smooth_m: Option<f64>,
    pub taubin_passes: usize,
    pub curviness: f64,
    pub min_loop_area_m2: f64,
    pub min_clearance_m: f64,
    pub simplify_m: f64,
    pub include_intermed: bool,

    pub knoll_min_rise_m: f64,
    pub knoll_lower_share: f64,
    pub knoll_spacing_m: f64,
    pub knoll_max_foot_m2: f64,

    pub formline_mode: FormlineMode,
    pub formline_min_gap_m: f64,
    pub formline_min_slope_deg: f64,
    pub formline_max_slope_deg: f64,
    pub formline_min_length_m: f64,
    pub formline_min_loop_area_m2: f64,

    pub veg_smooth: f64,
    pub open_max_height_m: f64,
    pub open_min_ground_share: f64,
    pub green_scale: f64,
    pub green_low_thresh: f64,
    pub green_med_thresh: f64,
    pub green_high_thresh: f64,
    pub undergrowth_thresh: f64,
    pub canopy_weight: f64,
    pub steep_cutoff_deg: f64,
    pub min_veg_area_m2: f64,

    pub overview: bool,
    pub bbox: Option<[f64; 4]>,
}

impl EngineConfig {
    pub fn defaults_for_interval(interval: f64) -> Self {
        let sprint = interval <= 3.0;
        let mut cfg = Self {
            profile: ContourProfile::Normal,
            interval,
            index_every: 5,
            level_offset: 0.0,
            scale: if sprint { 4_000 } else { 15_000 },
            smooth_m: if sprint { 0.78 } else { 1.08 },
            flat_smooth_m: None,
            taubin_passes: 2,
            curviness: 0.18,
            min_loop_area_m2: if sprint { 15.0 } else { 36.0 },
            min_clearance_m: if sprint { 0.90 } else { 1.55 },
            simplify_m: 0.20,
            include_intermed: false,

            knoll_min_rise_m: if sprint { 0.75 } else { 0.95 },
            knoll_lower_share: 0.80,
            knoll_spacing_m: if sprint { 9.0 } else { 13.0 },
            knoll_max_foot_m2: if sprint { 80.0 } else { 135.0 },

            formline_mode: FormlineMode::Normal,
            formline_min_gap_m: if sprint { 3.2 } else { 4.1 },
            formline_min_slope_deg: if sprint { 2.85 } else { 2.55 },
            formline_max_slope_deg: if sprint { 20.0 } else { 20.5 },
            formline_min_length_m: if sprint { 8.5 } else { 9.5 },
            formline_min_loop_area_m2: if sprint { 18.0 } else { 30.0 },

            veg_smooth: 1.05,
            open_max_height_m: 1.5,
            open_min_ground_share: 0.63,
            green_scale: 1.0,
            green_low_thresh: 0.098,
            green_med_thresh: 0.156,
            green_high_thresh: 0.235,
            undergrowth_thresh: 0.058,
            canopy_weight: 0.34,
            steep_cutoff_deg: 35.0,
            min_veg_area_m2: 300.0,

            overview: false,
            bbox: None,
        };
        cfg.apply_profile(ContourProfile::Normal);
        cfg
    }

    /// Effective Gaussian smoothing sigma (m) used on calm flat ground (`< 2.5°`).
    /// Auto-derives monotonically from `smooth_m` unless overridden via `--flat-smooth-m`.
    #[inline]
    pub fn effective_flat_smooth_m(&self) -> f64 {
        if let Some(f) = self.flat_smooth_m {
            return f.max(self.smooth_m);
        }
        let sprint = self.interval <= 3.0;
        let ratio = if sprint { 2.45 } else { 2.65 };
        let cap = if sprint { 3.4 } else { 4.8 };
        (self.smooth_m * ratio).min(cap).max(self.smooth_m)
    }

    /// Applies one of the 5 calibrated terrain-adaptive contour/detail profiles
    /// (monotonically ordered on both `101` contours and `103` formlines).
    pub fn apply_profile(&mut self, profile: ContourProfile) {
        let sprint = self.interval <= 3.0;
        self.profile = profile;
        match profile {
            ContourProfile::VeryDetailed => {
                self.smooth_m = if sprint { 0.52 } else { 0.72 };
                self.taubin_passes = 1;
                self.curviness = 0.26;
                self.min_loop_area_m2 = if sprint { 9.0 } else { 18.0 };
                self.min_clearance_m = if sprint { 0.55 } else { 0.95 };
                self.simplify_m = 0.14;
                self.veg_smooth = 0.65;
            }
            ContourProfile::Detailed => {
                self.smooth_m = if sprint { 0.65 } else { 0.88 };
                self.taubin_passes = 2;
                self.curviness = 0.22;
                self.min_loop_area_m2 = if sprint { 12.0 } else { 26.0 };
                self.min_clearance_m = if sprint { 0.75 } else { 1.25 };
                self.simplify_m = 0.17;
                self.veg_smooth = 0.65;
            }
            ContourProfile::Normal => {
                self.smooth_m = if sprint { 0.78 } else { 1.08 };
                self.taubin_passes = 2;
                self.curviness = 0.18;
                self.min_loop_area_m2 = if sprint { 15.0 } else { 36.0 };
                self.min_clearance_m = if sprint { 0.90 } else { 1.55 };
                self.simplify_m = 0.20;
                self.veg_smooth = 1.05;
            }
            ContourProfile::Generalized => {
                self.smooth_m = if sprint { 1.10 } else { 1.50 };
                self.taubin_passes = 3;
                self.curviness = 0.13;
                self.min_loop_area_m2 = if sprint { 25.0 } else { 62.0 };
                self.min_clearance_m = if sprint { 1.20 } else { 2.00 };
                self.simplify_m = 0.25;
                self.veg_smooth = 1.35;
            }
            ContourProfile::VeryGeneralized => {
                self.smooth_m = if sprint { 1.55 } else { 2.15 };
                self.taubin_passes = 4;
                self.curviness = 0.08;
                self.min_loop_area_m2 = if sprint { 40.0 } else { 105.0 };
                self.min_clearance_m = if sprint { 1.50 } else { 2.40 };
                self.simplify_m = 0.32;
                self.veg_smooth = 1.60;
            }
        }
        self.apply_formline_mode(self.formline_mode);
    }

    pub fn apply_formline_mode(&mut self, mode: FormlineMode) {
        let sprint = self.interval <= 3.0;
        self.formline_mode = mode;
        if mode == FormlineMode::Off {
            return;
        }
        // Monotonic base parameters per detail profile (for FormlineMode::Normal).
        let (base_gap, base_min_slp, base_max_slp, base_min_len, base_min_area): (f64, f64, f64, f64, f64) =
            match self.profile {
            ContourProfile::VeryDetailed => (
                if sprint { 2.2 } else { 3.2 },
                if sprint { 2.1 } else { 1.9 },
                if sprint { 22.5 } else { 23.0 },
                if sprint { 5.5 } else { 7.5 },
                if sprint { 9.0 } else { 18.0 },
            ),
            ContourProfile::Detailed => (
                if sprint { 2.7 } else { 3.6 },
                if sprint { 2.45 } else { 2.2 },
                if sprint { 21.0 } else { 21.5 },
                if sprint { 7.0 } else { 8.5 },
                if sprint { 13.0 } else { 24.0 },
            ),
            ContourProfile::Normal => (
                if sprint { 3.2 } else { 4.1 },
                if sprint { 2.85 } else { 2.55 },
                if sprint { 20.0 } else { 20.5 },
                if sprint { 8.5 } else { 9.5 },
                if sprint { 18.0 } else { 30.0 },
            ),
            ContourProfile::Generalized => (
                if sprint { 4.4 } else { 5.6 },
                if sprint { 3.2 } else { 2.9 },
                if sprint { 16.5 } else { 17.0 },
                if sprint { 11.5 } else { 14.0 },
                if sprint { 34.0 } else { 60.0 },
            ),
            ContourProfile::VeryGeneralized => (
                if sprint { 5.8 } else { 7.6 },
                if sprint { 3.7 } else { 3.3 },
                if sprint { 13.0 } else { 13.5 },
                if sprint { 16.0 } else { 20.0 },
                if sprint { 58.0 } else { 110.0 },
            ),
        };
        match mode {
            FormlineMode::Off => {}
            FormlineMode::Sparse => {
                self.formline_min_gap_m = (base_gap * 1.45 * 10.0).round() / 10.0;
                self.formline_min_slope_deg = base_min_slp + 0.5;
                self.formline_max_slope_deg = (base_max_slp - 4.5).max(9.0);
                self.formline_min_length_m = (base_min_len * 1.45).round();
                self.formline_min_loop_area_m2 = (base_min_area * 1.85).round();
            }
            FormlineMode::Normal => {
                self.formline_min_gap_m = base_gap;
                self.formline_min_slope_deg = base_min_slp;
                self.formline_max_slope_deg = base_max_slp;
                self.formline_min_length_m = base_min_len;
                self.formline_min_loop_area_m2 = base_min_area;
            }
            FormlineMode::Dense => {
                let min_allowed = self.min_clearance_m * 1.15;
                self.formline_min_gap_m = ((base_gap * 0.72).max(min_allowed) * 10.0).round() / 10.0;
                self.formline_min_slope_deg = (base_min_slp - 0.8).max(0.8);
                self.formline_max_slope_deg = (base_max_slp + 4.5).min(27.0);
                self.formline_min_length_m = (base_min_len * 0.65).max(if sprint { 5.0 } else { 7.0 }).round();
                self.formline_min_loop_area_m2 = (base_min_area * 0.55).max(if sprint { 8.0 } else { 16.0 }).round();
            }
        }
    }
}

/// Output summary serialized to `summary.json`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub mode: String,
    pub profile: ContourProfile,
    pub area_ha: f64,
    pub dem_width: usize,
    pub dem_height: usize,
    pub dem_cell_m: f64,
    pub points_read: u64,
    pub contour_interval_m: f64,
    pub contours: usize,
    pub index_contours: usize,
    pub depressions: usize,
    pub contour_vertices: usize,
    pub formlines: usize,
    pub formline_vertices: usize,
    pub knolls: usize,
    pub elongated_knolls: usize,
    pub pits: usize,
    pub veg_ha_white: f64,
    pub veg_ha_open: f64,
    pub veg_ha_semi: f64,
    pub veg_ha_green406: f64,
    pub veg_ha_green408: f64,
    pub veg_ha_green410: f64,
    pub veg_ha_undergrowth407: f64,
    pub veg_ha_undergrowth409: f64,
    pub ms_lidar: f64,
    pub ms_dem: f64,
    pub ms_contours: f64,
    pub ms_formlines: f64,
    pub ms_vegetation: f64,
    pub ms_overview: f64,
    pub ms_total: f64,
}
