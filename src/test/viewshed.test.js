import { describe, it, expect } from 'vitest';
import {
  applyScoreFormula,
  computeBuildingBlockDeg,
  prepareBuildingIndex,
  getScoreColor,
  scoreVenue,
  GREAT_SCORE_THRESHOLD,
  QUALITY_LABELS,
  UNSCORED_COLOR,
} from '../lib/viewshed';

// ---------------------------------------------------------------------------
// applyScoreFormula
// ---------------------------------------------------------------------------
describe('applyScoreFormula', () => {
  it('returns night when sun is below civil twilight', () => {
    expect(applyScoreFormula(0, 0, 50, -6)).toEqual({ score: 0, quality: 'night' });
    expect(applyScoreFormula(0, 0, 50, -10)).toEqual({ score: 0, quality: 'night' });
    expect(applyScoreFormula(0, 0, 50, -6.01)).toEqual({ score: 0, quality: 'night' });
  });

  it('gives near-maximum score for a clear horizon at golden hour', () => {
    const { score, quality } = applyScoreFormula(0, 0, 50, 10);
    expect(score).toBeGreaterThanOrEqual(90);
    expect(quality).toBe('excellent');
  });

  it('penalises heavy cloud cover (>= 80%)', () => {
    const clear   = applyScoreFormula(0, 0, 50, 15, 0).score;
    const overcast = applyScoreFormula(0, 0, 50, 15, 100).score;
    expect(clear - overcast).toBeGreaterThanOrEqual(50); // at least 50 pts penalty
  });

  it('does not penalise light cloud cover (< 20%)', () => {
    const noClouds    = applyScoreFormula(0, 0, 50, 15, 0).score;
    const lightClouds = applyScoreFormula(0, 0, 50, 15, 15).score;
    expect(noClouds).toBe(lightClouds);
  });

  it('applies stepped cloud penalties correctly', () => {
    const base = applyScoreFormula(0, 0, 50, 15, 0).score;
    expect(base - applyScoreFormula(0, 0, 50, 15, 25).score).toBe(5);
    expect(base - applyScoreFormula(0, 0, 50, 15, 50).score).toBe(20);
    expect(base - applyScoreFormula(0, 0, 50, 15, 70).score).toBe(40);
    expect(base - applyScoreFormula(0, 0, 50, 15, 90).score).toBe(55);
  });

  it('applies twilight penalty when sun is just below horizon', () => {
    const justAbove = applyScoreFormula(0, 0, 50,  0.1).score;
    const justBelow = applyScoreFormula(0, 0, 50, -3).score;
    expect(justAbove).toBeGreaterThan(justBelow);
  });

  it('gives elevation bonus above SF median (50 m)', () => {
    const median = applyScoreFormula(0, 0, 50, 15).score;
    const elevated = applyScoreFormula(0, 0, 100, 15).score; // 50 m above median
    expect(elevated).toBeGreaterThan(median);
  });

  it('gives elevation penalty below SF median', () => {
    const median  = applyScoreFormula(0, 0, 50, 15).score;
    const lowland = applyScoreFormula(0, 0, 0, 15).score;  // 50 m below median
    expect(lowland).toBeLessThan(median);
  });

  it('scores lower for heavily blocked horizon', () => {
    const open    = applyScoreFormula(0,  0, 50, 15).score;
    const blocked = applyScoreFormula(20, 0, 50, 15).score;
    expect(open).toBeGreaterThan(blocked);
  });

  it('uses terrain block when it exceeds building block', () => {
    const buildingDominates = applyScoreFormula(10, 2, 50, 15).score;
    const terrainDominates  = applyScoreFormula(2, 10, 50, 15).score;
    expect(buildingDominates).toBe(terrainDominates);
  });

  it('score is always clamped between 5 and 100', () => {
    // Extreme cases
    const { score: low }  = applyScoreFormula(90, 90, 0, -5, 100);
    const { score: high } = applyScoreFormula(0, 0, 200, 45, 0);
    expect(low).toBeGreaterThanOrEqual(5);
    expect(high).toBeLessThanOrEqual(100);
  });

  it('assigns quality tiers at the right score boundaries', () => {
    // Drive score by adjusting cloud cover penalty against a known base
    // Base clear-sky score at alt=15, block=0, elev=50 ≈ 95
    const { quality: excellent } = applyScoreFormula(0, 0, 50, 15, 0);
    expect(excellent).toBe('excellent'); // score ≈ 95

    const { quality: great } = applyScoreFormula(1.5, 0, 50, 15, 15);
    expect(['excellent', 'great']).toContain(great);

    // Force a blocked score via heavy terrain + heavy cloud
    const { quality: blocked } = applyScoreFormula(30, 30, 0, 5, 80);
    expect(['blocked', 'partial']).toContain(blocked);
  });
});

// ---------------------------------------------------------------------------
// prepareBuildingIndex
// ---------------------------------------------------------------------------
describe('prepareBuildingIndex', () => {
  const validBuilding = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-122.42, 37.77],
        [-122.41, 37.77],
        [-122.41, 37.78],
        [-122.42, 37.78],
        [-122.42, 37.77],
      ]],
    },
    properties: { height: 30 },
  };

  it('returns an empty array for empty input', () => {
    expect(prepareBuildingIndex([])).toEqual([]);
  });

  it('adds _centroid and _ring to valid buildings', () => {
    const [indexed] = prepareBuildingIndex([validBuilding]);
    expect(indexed._centroid).toHaveLength(2);
    expect(indexed._ring).toBeDefined();
  });

  it('silently drops malformed geometries', () => {
    const malformed = { type: 'Feature', geometry: null, properties: { height: 10 } };
    const result = prepareBuildingIndex([validBuilding, malformed]);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// computeBuildingBlockDeg
// ---------------------------------------------------------------------------
describe('computeBuildingBlockDeg', () => {
  it('returns 0 for an empty building index', () => {
    expect(computeBuildingBlockDeg(37.76, -122.41, [], 270)).toBe(0);
  });

  it('returns 0 when buildings are outside the scan radius', () => {
    // Building in Oakland, well beyond 1.5 km from a Mission venue
    const distantBuilding = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-122.27, 37.80], [-122.26, 37.80],
          [-122.26, 37.81], [-122.27, 37.81], [-122.27, 37.80],
        ]],
      },
      properties: { height: 50 },
    };
    const index = prepareBuildingIndex([distantBuilding]);
    const result = computeBuildingBlockDeg(37.76, -122.41, index, 270);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getScoreColor
// ---------------------------------------------------------------------------
describe('getScoreColor', () => {
  it('returns correct hex for each tier', () => {
    expect(getScoreColor(80)).toBe('#F97316');
    expect(getScoreColor(100)).toBe('#F97316');
    expect(getScoreColor(60)).toBe('#FBBF24');
    expect(getScoreColor(79)).toBe('#FBBF24');
    expect(getScoreColor(40)).toBe('#FDE047');
    expect(getScoreColor(59)).toBe('#FDE047');
    expect(getScoreColor(20)).toBe('#94A3B8');
    expect(getScoreColor(39)).toBe('#94A3B8');
    expect(getScoreColor(0)).toBe('#475569');
    expect(getScoreColor(19)).toBe('#475569');
  });
});

// ---------------------------------------------------------------------------
// scoreVenue (thin wrapper — just verify it delegates correctly)
// ---------------------------------------------------------------------------
describe('scoreVenue', () => {
  it('returns night when sun is below civil twilight', () => {
    expect(scoreVenue(37.76, -122.41, [], 270, -7)).toEqual({ score: 0, quality: 'night' });
  });

  it('returns a valid score and quality for a daytime sun', () => {
    const { score, quality } = scoreVenue(37.76, -122.41, [], 270, 20);
    expect(score).toBeGreaterThan(0);
    expect(['excellent', 'great', 'good', 'partial', 'blocked']).toContain(quality);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('constants', () => {
  it('GREAT_SCORE_THRESHOLD is 68', () => {
    expect(GREAT_SCORE_THRESHOLD).toBe(68);
  });

  it('UNSCORED_COLOR is a hex string', () => {
    expect(UNSCORED_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('QUALITY_LABELS has entries for all six quality tiers', () => {
    const tiers = ['excellent', 'great', 'good', 'partial', 'blocked', 'night'];
    for (const tier of tiers) {
      expect(QUALITY_LABELS[tier]).toBeDefined();
    }
  });
});
