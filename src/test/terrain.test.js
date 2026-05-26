import { describe, it, expect } from 'vitest';
import { getElevation, computeTerrainBlockDeg, terrainReady } from '../lib/terrain';

// terrain.js decodes Mapbox terrain-RGB tiles using browser Image + Canvas.
// In the test environment (jsdom) no tiles are loaded, so all functions
// that depend on the tile cache operate on an empty state. These tests
// verify the safe-default behaviour — real tile-dependent behaviour is
// covered by visual testing in the running app.

describe('terrainReady', () => {
  it('returns false when no tiles have been loaded', () => {
    expect(terrainReady()).toBe(false);
  });
});

describe('getElevation', () => {
  it('returns 0 when the tile cache is empty', () => {
    expect(getElevation(37.76, -122.41)).toBe(0);
  });

  it('returns 0 for coordinates at the edge of SF', () => {
    expect(getElevation(37.70, -122.52)).toBe(0);
    expect(getElevation(37.82, -122.35)).toBe(0);
  });
});

describe('computeTerrainBlockDeg', () => {
  it('returns 0 when terrain is not ready', () => {
    // terrainReady() is false → function returns immediately with 0
    expect(computeTerrainBlockDeg(37.76, -122.41, 270)).toBe(0);
  });

  it('returns a number (not undefined or NaN)', () => {
    const result = computeTerrainBlockDeg(37.76, -122.41, 180);
    expect(typeof result).toBe('number');
    expect(Number.isNaN(result)).toBe(false);
  });

  it('returns 0 for any azimuth direction when tiles are not loaded', () => {
    for (const azimuth of [0, 45, 90, 135, 180, 225, 270, 315]) {
      expect(computeTerrainBlockDeg(37.76, -122.41, azimuth)).toBe(0);
    }
  });
});
