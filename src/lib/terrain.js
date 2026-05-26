// Decodes elevation from Mapbox terrain-RGB tiles without any extra API.
// Formula: elevation = -10000 + (R*65536 + G*256 + B) * 0.1  (metres above sea level)

const ZOOM = 13;
const TILE_SIZE = 256;
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// In-memory tile cache: key `${x}_${y}` → CanvasRenderingContext2D
const tileCache = new Map();

// In-module cache for computeTerrainBlockDeg results
const terrainBlockCache = new Map();

function lngLatToTile(lng, lat) {
  const n = Math.pow(2, ZOOM);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

function lngLatToPixel(lng, lat, tileX, tileY) {
  const n = Math.pow(2, ZOOM);
  const px = Math.floor((((lng + 180) / 360) * n - tileX) * TILE_SIZE);
  const latRad = (lat * Math.PI) / 180;
  const py = Math.floor(
    (((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - tileY) * TILE_SIZE
  );
  return { px, py };
}

async function fetchTile(x, y) {
  const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${ZOOM}/${x}/${y}.pngraw?access_token=${TOKEN}`;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
      resolve(ctx);
    };
    img.onerror = () => resolve(null); // fail silently
    img.src = url;
  });
}

/**
 * Pre-loads all terrain-RGB tiles covering San Francisco.
 * SF bounding box: lat 37.70–37.82, lng -122.52 to -122.35
 * At zoom 13 this is ~12 tiles — loads in ~1–2 seconds.
 */
export async function preloadSFTerrain(onProgress) {
  const sw = lngLatToTile(-122.52, 37.70); // bottom-left → larger y
  const ne = lngLatToTile(-122.35, 37.82); // top-right  → smaller y

  const tasks = [];
  for (let x = ne.x; x <= sw.x; x++) {
    for (let y = ne.y; y <= sw.y; y++) {
      const key = `${x}_${y}`;
      if (!tileCache.has(key)) {
        tasks.push(
          fetchTile(x, y).then(ctx => {
            if (ctx) tileCache.set(key, ctx);
            if (onProgress) onProgress();
          })
        );
      }
    }
  }

  await Promise.all(tasks);
  return tileCache.size;
}

export function terrainReady() {
  return tileCache.size > 0;
}

/** Returns elevation in metres at a given lat/lng. Returns 0 if tile not loaded. */
export function getElevation(lat, lng) {
  const { x: tx, y: ty } = lngLatToTile(lng, lat);
  const ctx = tileCache.get(`${tx}_${ty}`);
  if (!ctx) return 0;

  const { px, py } = lngLatToPixel(lng, lat, tx, ty);
  if (px < 0 || px >= TILE_SIZE || py < 0 || py >= TILE_SIZE) return 0;

  const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
  return -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

/**
 * Returns the maximum angular elevation (degrees) that terrain creates above
 * the venue's horizon, looking in the sun's azimuth direction.
 * This is what we compare against sun altitude to determine if hills block the view.
 */
export function computeTerrainBlockDeg(venueLat, venueLng, sunAzimuth) {
  if (!terrainReady()) return 0;

  const cacheKey = `${venueLat.toFixed(4)}_${venueLng.toFixed(4)}_${Math.round(sunAzimuth / 2) * 2}`;
  if (terrainBlockCache.has(cacheKey)) return terrainBlockCache.get(cacheKey);

  const venueElev = getElevation(venueLat, venueLng);
  const RAD = Math.PI / 180;

  // Logarithmically-spaced sample distances (km): fine resolution near the venue
  // where small hills matter most, coarser at distance for major ridge lines.
  const distances = [0.15, 0.3, 0.6, 1.0, 1.6, 2.5, 4.0, 6.5];
  const LNG_DEG_TO_KM = 111.32; // km per degree of longitude at the equator
  let maxBlockDeg = 0;

  for (const d of distances) {
    const dLat = (d / 111.32) * Math.cos(sunAzimuth * RAD);
    const dLng = (d / (LNG_DEG_TO_KM * Math.cos(venueLat * RAD))) * Math.sin(sunAzimuth * RAD);
    const sLat = venueLat + dLat;
    const sLng = venueLng + dLng;

    const terrainElev = getElevation(sLat, sLng);
    const heightDiff = terrainElev - venueElev;
    if (heightDiff <= 1) continue; // ignore ≤1 m difference (within elevation data noise)

    const blockDeg = Math.atan2(heightDiff, d * 1000) * (180 / Math.PI);
    if (blockDeg > maxBlockDeg) maxBlockDeg = blockDeg;
  }

  terrainBlockCache.set(cacheKey, maxBlockDeg);
  return maxBlockDeg;
}
