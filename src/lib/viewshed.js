import { point, lineString } from '@turf/helpers';
import destination from '@turf/destination';
import lineIntersect from '@turf/line-intersect';
import distance from '@turf/distance';
import bearing from '@turf/bearing';
import centroid from '@turf/centroid';

const RAY_DISTANCE_KM = 1.5;

// Geographic conversion factors at SF's latitude (~37.8°N).
// These are standard geodesic constants — 1° lat is nearly constant globally;
// 1° lng varies by cos(lat), which callers must apply.
const LAT_DEG_TO_KM   = 110.574; // km per degree of latitude
const LNG_DEG_TO_KM   = 111.32;  // km per degree of longitude at the equator

// Pre-filter margins
const BUILDING_BUFFER_KM = 0.15; // extend the distance filter beyond RAY_DISTANCE_KM
const MIN_HIT_DIST_M     = 5;    // ignore intersections < 5 m from origin (own-wall hits)

// Scoring formula parameters
const SF_MEDIAN_ELEV_M       = 50;   // SF's approximate median elevation (m); elevation bonus baseline
const ELEV_BONUS_SCALE       = 0.25; // score pts per metre above/below SF median (±12 pt cap)
const DIRECT_BLOCK_MIN_ALT   = 8;    // sun must be above this altitude (°) for direct-block penalty
const DIRECT_BLOCK_MARGIN    = -4;   // sun_alt - blockDeg must be below this to trigger penalty
const CIVIL_TWILIGHT_DEG     = 6;    // depth of civil twilight (°); scoring floor beyond this
const TWILIGHT_SCORE_PENALTY = 60;   // max score points lost at full civil twilight depth

// 13 rays spanning ±30° around the sun azimuth in 5° steps.
// ±30° covers the full golden-hour arc the sun sweeps in the ~30 min before sunset.
const RAY_OFFSETS = [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30];
// Cosine weights: dead-center obstruction hurts more than peripheral obstruction.
const RAY_WEIGHTS = RAY_OFFSETS.map(o => Math.cos(o * (Math.PI / 180)));
const RAY_WEIGHT_SUM = RAY_WEIGHTS.reduce((a, b) => a + b, 0);

/**
 * Pre-processes raw building GeoJSON features into an indexed form for fast
 * ray intersection. Computes centroid coordinates and the exterior ring
 * LineString once per building so they don't need to be re-derived on every
 * scoring call.
 *
 * @param {GeoJSON.Feature<GeoJSON.Polygon, { height: number }>[]} buildings
 *   Raw building polygon features as returned by `fetchTallBuildings()`.
 * @returns {Array<GeoJSON.Feature & { _centroid: [number, number], _ring: GeoJSON.Feature<GeoJSON.LineString> }>}
 *   Indexed buildings. Malformed geometries are silently dropped.
 */
export function prepareBuildingIndex(buildings) {
  return buildings.map(b => {
    try {
      const centroidCoords = centroid(b).geometry.coordinates;
      const ring = lineString(b.geometry.coordinates[0]);
      return { ...b, _centroid: centroidCoords, _ring: ring };
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Returns a cosine-weighted average block angle (degrees) across the 13-ray
 * fan spanning ±30° around the sun azimuth.
 *
 * Casting 13 rays (vs the previous 3) catches buildings that fell between the
 * old ±15° gaps. Weighting each ray's contribution by cos(offset) means a
 * building that only clips the edge of the fan hurts less than one blocking
 * the centre — a narrow skyscraper and a broad ridge with the same peak
 * vertical angle now score differently, as they should. This is the expensive
 * step; cache the result and reuse it when the sun azimuth hasn't moved much
 * (see App.jsx buildingBlockCacheRef).
 *
 * @param {number} venueLat
 * @param {number} venueLng
 * @param {ReturnType<typeof prepareBuildingIndex>} buildingIndex
 * @param {number} sunAzimuth
 * @returns {number} Cosine-weighted average block angle in degrees.
 */
export function computeBuildingBlockDeg(venueLat, venueLng, buildingIndex, sunAzimuth) {
  const origin = point([venueLng, venueLat]);
  const rays = RAY_OFFSETS.map(offset => {
    const dest = destination(origin, RAY_DISTANCE_KM, sunAzimuth + offset, { units: 'kilometers' });
    return lineString([origin.geometry.coordinates, dest.geometry.coordinates]);
  });

  // Per-ray maximum block angle — populated as we test each building
  const rayBlockDeg = new Float32Array(RAY_OFFSETS.length); // zero-initialised

  for (const building of buildingIndex) {
    const [cLng, cLat] = building._centroid;
    const roughDistKm = Math.sqrt(
      Math.pow((cLat - venueLat) * LAT_DEG_TO_KM, 2) +
      Math.pow((cLng - venueLng) * LNG_DEG_TO_KM * Math.cos(venueLat * (Math.PI / 180)), 2)
    );
    if (roughDistKm > RAY_DISTANCE_KM + BUILDING_BUFFER_KM) continue;

    const bearingToCentroid = bearing(origin, point([cLng, cLat]));
    const angleDiff = Math.abs(((bearingToCentroid - sunAzimuth + 540) % 360) - 180);
    if (angleDiff > 50) continue; // tight filter — rays only span ±30°

    try {
      for (let i = 0; i < rays.length; i++) {
        const intersections = lineIntersect(rays[i], building._ring);
        if (!intersections.features.length) continue;
        let minDistM = Infinity;
        for (const feat of intersections.features) {
          const d = distance(origin, feat, { units: 'kilometers' }) * 1000;
          if (d < minDistM) minDistM = d;
        }
        if (minDistM < MIN_HIT_DIST_M) continue;
        const height = building.properties?.height;
        if (!height) continue; // skip buildings with missing/zero height data
        const blockDeg = Math.atan2(height, minDistM) * (180 / Math.PI);
        if (blockDeg > rayBlockDeg[i]) rayBlockDeg[i] = blockDeg;
      }
    } catch (_) {
      // Skip malformed geometries
    }
  }

  // Cosine-weighted average across all rays
  let weighted = 0;
  for (let i = 0; i < RAY_OFFSETS.length; i++) weighted += RAY_WEIGHTS[i] * rayBlockDeg[i];
  return weighted / RAY_WEIGHT_SUM;
}

/**
 * Converts pre-computed block angles and sun position into a 0–100 score.
 * Separating this from ray-casting lets callers cache `buildingBlockDeg` and
 * call only this function on subsequent slider moves with similar sun azimuths.
 *
 * The horizon score uses a continuous exponential decay rather than a stepped
 * lookup table, eliminating the scoring cliffs that made venues at 1.49° and
 * 1.51° score 82 and 68 respectively despite identical real-world views:
 *
 *   horizonScore = 95 × exp(−0.22 × blockDeg^0.70)
 *
 * Calibrated so the old step-table anchors remain inflection points:
 *   0° → 95   0.5° → ~83   3.5° → ~69   7° → ~49   14° → ~27
 *
 * Cloud cover is factored in as a stepped penalty keyed to the forecast for
 * the slider's current hour, so scores drop on overcast afternoons and rise
 * as the fog clears — matching the slider's time to the hourly forecast.
 * Light cloud (<20%) carries no penalty (can enhance sunset colours).
 *
 * @param {number} buildingBlockDeg        - Cosine-weighted avg from computeBuildingBlockDeg().
 * @param {number} terrainBlockDeg         - Max angle from computeTerrainBlockDeg().
 * @param {number} venueElevM              - Venue elevation in metres.
 * @param {number} sunAltitudeDeg          - Sun altitude in degrees.
 * @param {number} [cloudCoverPct=0]       - Cloud cover % for this venue's microclimate zone.
 * @returns {{ score: number, quality: string }}
 */
export function applyScoreFormula(buildingBlockDeg, terrainBlockDeg, venueElevM, sunAltitudeDeg, cloudCoverPct = 0) {
  if (sunAltitudeDeg <= -6) return { score: 0, quality: 'night' };

  const maxBlockDeg = Math.max(buildingBlockDeg, terrainBlockDeg);
  const elevDelta = venueElevM - SF_MEDIAN_ELEV_M;
  const elevBonus = Math.max(-12, Math.min(12, elevDelta * ELEV_BONUS_SCALE));

  // Continuous exponential — no score cliffs, smooth UX as the slider moves
  const horizonScore = 95 * Math.exp(-0.22 * Math.pow(Math.max(0, maxBlockDeg), 0.70));

  const directBlockPenalty =
    (sunAltitudeDeg > DIRECT_BLOCK_MIN_ALT && sunAltitudeDeg - maxBlockDeg < DIRECT_BLOCK_MARGIN)
      ? 25 : 0;
  const twilightPenalty = sunAltitudeDeg < 0
    ? Math.round((-sunAltitudeDeg / CIVIL_TWILIGHT_DEG) * TWILIGHT_SCORE_PENALTY)
    : 0;

  // Stepped cloud penalty. Light cloud can enhance sunset colours so <20% is free.
  let cloudPenalty = 0;
  if      (cloudCoverPct >= 80) cloudPenalty = 55;
  else if (cloudCoverPct >= 60) cloudPenalty = 40;
  else if (cloudCoverPct >= 40) cloudPenalty = 20;
  else if (cloudCoverPct >= 20) cloudPenalty = 5;

  const score = Math.max(5, Math.min(100, Math.round(horizonScore + elevBonus - directBlockPenalty - twilightPenalty - cloudPenalty)));

  let quality;
  if (score >= 80) quality = 'excellent';
  else if (score >= 62) quality = 'great';
  else if (score >= 44) quality = 'good';
  else if (score >= 22) quality = 'partial';
  else quality = 'blocked';

  return { score, quality };
}

/**
 * Scores a venue's sunset view quality on a 0–100 scale.
 * Internally calls `computeBuildingBlockDeg` then `applyScoreFormula`.
 * For repeated calls with slowly-changing azimuths, call those two
 * functions directly and cache `buildingBlockDeg` yourself.
 *
 * @param {number} venueLat
 * @param {number} venueLng
 * @param {ReturnType<typeof prepareBuildingIndex>} buildingIndex
 * @param {number} sunAzimuth
 * @param {number} sunAltitudeDeg
 * @param {number} [terrainBlockDeg=0]
 * @param {number} [venueElevM=0]
 * @param {number} [cloudCoverPct=0]
 * @returns {{ score: number, quality: string }}
 */
export function scoreVenue(venueLat, venueLng, buildingIndex, sunAzimuth, sunAltitudeDeg, terrainBlockDeg = 0, venueElevM = 0, cloudCoverPct = 0) {
  if (sunAltitudeDeg <= -6) return { score: 0, quality: 'night' };
  const buildingBlockDeg = computeBuildingBlockDeg(venueLat, venueLng, buildingIndex, sunAzimuth);
  return applyScoreFormula(buildingBlockDeg, terrainBlockDeg, venueElevM, sunAltitudeDeg, cloudCoverPct);
}

/**
 * Maps a 0–100 score to its corresponding display color.
 *
 * @param {number} score
 * @returns {string} Hex color string.
 */
export function getScoreColor(score) {
  if (score >= 80) return '#F97316';  // vivid orange — clearly "excellent"
  if (score >= 60) return '#FBBF24';  // golden amber — golden hour
  if (score >= 40) return '#FDE047';  // warm yellow — decent light
  if (score >= 20) return '#94A3B8';  // steel slate — partial / hazy
  return '#475569';                   // dark slate — blocked
}

/** Color used for venues whose score has not yet been computed. */
export const UNSCORED_COLOR = '#3B4268';

/** Minimum score threshold for a venue to be counted as a "great view" in the header summary. */
export const GREAT_SCORE_THRESHOLD = 68;

/** Human-readable label for each quality tier, suitable for display in the UI. */
export const QUALITY_LABELS = {
  excellent: '🌅 Excellent view',
  great:     '✨ Great view',
  good:      '👍 Good view',
  partial:   '🏙️ Partial view',
  blocked:   '🏢 Blocked',
  night:     '🌙 After sunset',
};
