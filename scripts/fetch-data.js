#!/usr/bin/env node
/**
 * Pre-fetches SF venue and building data from the Overpass API and writes
 * them to public/data/ as static JSON assets bundled with the app.
 *
 * The deployed app loads these files directly — no Overpass dependency at
 * runtime, no rate limiting, and sub-100ms data load for every visitor.
 *
 * This script is called automatically by the GitHub Actions daily cron
 * (.github/workflows/refresh-data.yml). Run it manually to force a refresh:
 *
 *   npm run fetch-data
 *
 * After running, commit public/data/venues.json and public/data/buildings.json.
 * A push to main triggers an automatic redeploy on Vercel / Netlify.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'data');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const SF_BBOX = '37.7081,-122.5155,37.8124,-122.3531';

async function overpassQuery(ql) {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'sf-sunset-finder/1.0 (data prefetch script)',
    },
    body: `data=${encodeURIComponent(ql)}`,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function parseVenue(el, type) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!lat || !lng) return null;

  const isGreen = type === 'park';
  const greenLabel =
    el.tags?.leisure === 'viewpoint' ? 'viewpoint' :
    el.tags?.natural === 'peak'      ? 'peak'      :
    el.tags?.leisure === 'garden'    ? 'garden'    : 'park';

  return {
    id:    el.id,
    lat,
    lng,
    name:          el.tags?.name || greenLabel,
    amenity:       isGreen ? greenLabel : el.tags?.amenity,
    type,
    outdoorSeating: isGreen || el.tags?.outdoor_seating === 'yes',
    cuisine:  el.tags?.cuisine || null,
    website:  el.tags?.website || el.tags?.['contact:website'] || null,
    address:  el.tags?.['addr:street']
      ? `${el.tags?.['addr:housenumber'] || ''} ${el.tags?.['addr:street']}`.trim()
      : null,
  };
}

async function fetchVenues() {
  process.stdout.write('  Venues... ');
  const [venueData, parkData] = await Promise.all([
    overpassQuery(`[out:json][timeout:35];node["amenity"~"^(cafe|restaurant|bar)$"]["name"](${SF_BBOX});out body 600;`),
    overpassQuery(`[out:json][timeout:35];(node["leisure"~"^(park|viewpoint|garden)$"](${SF_BBOX});way["leisure"~"^(park|garden)$"](${SF_BBOX});node["natural"="peak"]["name"](${SF_BBOX}););out body center 500;`),
  ]);

  const seen = new Set();
  const results = [];

  for (const el of venueData.elements) {
    const v = parseVenue(el, 'venue');
    if (!v) continue;
    const key = `${v.lat.toFixed(4)}_${v.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(v);
  }
  for (const el of parkData.elements) {
    const v = parseVenue(el, 'park');
    if (!v) continue;
    const key = `${v.lat.toFixed(4)}_${v.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(v);
  }

  console.log(`${results.length} found`);
  return results;
}

async function fetchBuildings() {
  process.stdout.write('  Buildings... ');
  const data = await overpassQuery(`
    [out:json][timeout:60];
    (
      way["building"]["building:levels"~"^([3-9]|[1-9][0-9]+)$"](${SF_BBOX});
      way["building"]["height"~"^([2-9][0-9]|[1-9][0-9]{2,})(\\..*)?$"](${SF_BBOX});
    );
    out geom;
  `);

  const features = [];
  for (const el of data.elements) {
    if (!el.geometry || el.geometry.length < 3) continue;
    const coords = el.geometry.map(pt => [pt.lon, pt.lat]);
    const first = coords[0], last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);

    const levels  = parseInt(el.tags?.['building:levels']) || null;
    const heightRaw = el.tags?.height;
    const height  = heightRaw ? parseFloat(heightRaw) : levels ? levels * 3.5 : 14;

    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: { height },
    });
  }

  console.log(`${features.length} found`);
  return features;
}

console.log('Fetching data from Overpass API...');
mkdirSync(OUT, { recursive: true });

const venues   = await fetchVenues();
const buildings = await fetchBuildings();

writeFileSync(join(OUT, 'venues.json'),    JSON.stringify(venues));
writeFileSync(join(OUT, 'buildings.json'), JSON.stringify(buildings));

const vSize = (JSON.stringify(venues).length    / 1024).toFixed(1);
const bSize = (JSON.stringify(buildings).length / 1024).toFixed(1);
console.log(`\nWrote:`);
console.log(`  public/data/venues.json    ${vSize} KB  (${venues.length} venues)`);
console.log(`  public/data/buildings.json ${bSize} KB  (${buildings.length} buildings)`);
console.log('\nDone. Commit both files alongside your code.');
