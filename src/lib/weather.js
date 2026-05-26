const CACHE_KEY = 'sun-scout-weather-v3'; // v3 = 12-zone structure
const CACHE_TTL = 30 * 60 * 1000; // 30 min — balances freshness with API courtesy

/**
 * SF microclimate zones for per-neighbourhood weather queries.
 *
 * SF's weather gradient runs west→east: the outer coastal zones (Outer Sunset,
 * Outer Richmond) are the first to catch marine layer fog rolling in from the
 * Pacific. The Inner avenues, Twin Peaks, and Noe Valley sit in the transition
 * band. Mission, Bernal, Potrero, SOMA, and Bayview typically stay clear.
 * The northern waterfront (Marina, North Beach) and Downtown have their own
 * micro-patterns driven by Bay exposure.
 *
 * Open-Meteo accepts all coordinates in a single batch request so adding more
 * zones costs nothing beyond a slightly larger JSON payload.
 */
export const SF_ZONES = [
  { id: 'outer_sunset',   name: 'Outer Sunset',   lat: 37.7472, lng: -122.5027 },
  { id: 'inner_sunset',   name: 'Inner Sunset',   lat: 37.7594, lng: -122.4694 },
  { id: 'outer_richmond', name: 'Outer Richmond', lat: 37.7807, lng: -122.5027 },
  { id: 'inner_richmond', name: 'Inner Richmond', lat: 37.7803, lng: -122.4739 },
  { id: 'twin_peaks',     name: 'Twin Peaks',     lat: 37.7544, lng: -122.4477 },
  { id: 'noe_valley',     name: 'Noe Valley',     lat: 37.7490, lng: -122.4340 },
  { id: 'mission',        name: 'Mission',        lat: 37.7596, lng: -122.4148 },
  { id: 'bernal_heights', name: 'Bernal Heights', lat: 37.7391, lng: -122.4152 },
  { id: 'potrero_soma',   name: 'Potrero/SOMA',   lat: 37.7691, lng: -122.3995 },
  { id: 'downtown',       name: 'Downtown',       lat: 37.7936, lng: -122.3970 },
  { id: 'marina',         name: 'Marina',         lat: 37.8002, lng: -122.4354 },
  { id: 'north_beach',    name: 'North Beach',    lat: 37.8041, lng: -122.4102 },
];

/**
 * Returns the SF_ZONES entry whose coordinates are closest to (lat, lng).
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {(typeof SF_ZONES)[0]}
 */
export function getNearestZone(lat, lng) {
  let nearest = SF_ZONES[0];
  let minDist = Infinity;
  for (const zone of SF_ZONES) {
    const d = (zone.lat - lat) ** 2 + (zone.lng - lng) ** 2;
    if (d < minDist) { minDist = d; nearest = zone; }
  }
  return nearest;
}

/**
 * Fetches today's hourly cloud cover forecast for all 12 SF microclimate
 * zones in a single Open-Meteo batch request (no API key required).
 * Results are cached in localStorage for 30 minutes; subsequent calls
 * within the TTL return the cached data without hitting the network.
 *
 * @returns {Promise<Array<{ zone: object, hourly: Array<{hour: number, cloudCover: number, visibility: number|null}> }>>}
 */
export async function fetchSFWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached?.ts && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  } catch {}

  const lats = SF_ZONES.map(z => z.lat).join(',');
  const lngs = SF_ZONES.map(z => z.lng).join(',');
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}&longitude=${lngs}` +
    `&hourly=cloud_cover,visibility` +
    `&timezone=America%2FLos_Angeles` +
    `&forecast_days=1`;

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();

  // Open-Meteo returns an array when multiple locations are requested
  const responses = Array.isArray(json) ? json : [json];

  const data = SF_ZONES.map((zone, i) => {
    const r = responses[i];
    if (!r?.hourly) return { zone, hourly: [] };
    return {
      zone,
      hourly: r.hourly.time.map((t, j) => ({
        hour: Number(t.slice(11, 13)),          // "2026-05-24T15:00" → 15
        cloudCover: r.hourly.cloud_cover[j],    // 0–100 %
        visibility: r.hourly.visibility[j] ?? null, // metres
      })),
    };
  });

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
  return data;
}

/**
 * Returns the cloud cover % for a specific zone at the given time, or null.
 *
 * @param {ReturnType<typeof fetchSFWeather> extends Promise<infer T> ? T : never} weatherZones
 * @param {string} zoneId
 * @param {Date} date
 * @returns {number|null}
 */
export function getCloudCoverForZone(weatherZones, zoneId, date) {
  if (!weatherZones) return null;
  const zoneData = weatherZones.find(z => z.zone.id === zoneId);
  if (!zoneData?.hourly.length) return null;
  const hour = date.getHours();
  return zoneData.hourly.find(h => h.hour === hour)?.cloudCover ?? null;
}

/**
 * Returns cloud cover % for the microclimate zone nearest to
 * (venueLat, venueLng) at the given time.
 *
 * @param {object[]|null} weatherZones
 * @param {number} venueLat
 * @param {number} venueLng
 * @param {Date} date
 * @returns {number|null}
 */
export function getCloudCoverForVenue(weatherZones, venueLat, venueLng, date) {
  if (!weatherZones) return null;
  const zone = getNearestZone(venueLat, venueLng);
  return getCloudCoverForZone(weatherZones, zone.id, date);
}

/**
 * Computes per-hour cloud cover averaged across all zones — used for the
 * time-pill emoji when no specific venue is selected. Zone-specific data
 * is used for individual venue scores and the venue detail panel.
 *
 * @param {object[]|null} weatherZones
 * @returns {Array<{ hour: number, cloudCover: number }>|null}
 */
export function getAverageHourly(weatherZones) {
  if (!weatherZones?.length) return null;
  const acc = {};
  for (const { hourly } of weatherZones) {
    for (const { hour, cloudCover } of hourly) {
      if (!acc[hour]) acc[hour] = { sum: 0, n: 0 };
      acc[hour].sum += cloudCover;
      acc[hour].n++;
    }
  }
  return Object.entries(acc)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([hour, { sum, n }]) => ({ hour: Number(hour), cloudCover: Math.round(sum / n) }));
}

/**
 * Returns the city-average cloud cover % for the given time, or null.
 *
 * @param {object[]|null} weatherZones
 * @param {Date} date
 * @returns {number|null}
 */
export function getAverageCloudCover(weatherZones, date) {
  const hourly = getAverageHourly(weatherZones);
  if (!hourly) return null;
  return hourly.find(h => h.hour === date.getHours())?.cloudCover ?? null;
}

/**
 * Returns an array of GOES-18 PSW GeoColor image URLs to try in order,
 * from most recent to oldest. Provides a list rather than a single URL
 * because GOES PSW scans happen at :01/:11/:21/:31/:41/:51 UTC (not round
 * 10-min marks), so the exact timestamp must be probed.
 *
 * Starts 5 minutes ago and steps back 2 minutes at a time, up to 45 minutes
 * back — normally a valid frame is found within 2–3 attempts.
 *
 * @param {string} [size='600x600'] - Image resolution. Options: 300x300, 600x600, 1200x1200.
 * @returns {string[]} Ordered list of candidate URLs.
 */
export function getGOESImageUrls(size = '600x600') {
  const urls = [];
  for (let offset = 5; offset <= 45; offset += 2) {
    const d = new Date(Date.now() - offset * 60_000);
    const year = d.getUTCFullYear();
    const dayOfYear = Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ts = `${year}${String(dayOfYear).padStart(3, '0')}${hh}${mm}`;
    urls.push(`https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/psw/GEOCOLOR/${ts}_GOES18-ABI-psw-GEOCOLOR-${size}.jpg`);
  }
  return urls;
}

/**
 * Maps a cloud cover percentage to a display label, emoji, and color.
 *
 * Uses a sky-blue → teal palette so weather indicators are visually distinct
 * from the warm-orange score dot palette. The three previous palette collisions
 * (Mostly clear = Great-score amber, Partly cloudy = Partial-score slate, etc.)
 * are fully resolved. All five colors pass WCAG AA against the app's dark
 * background (#0f0f19).
 *
 * @param {number|null} pct
 * @returns {{ label: string, emoji: string, color: string }|null}
 */
export function cloudCoverInfo(pct) {
  if (pct === null || pct === undefined) return null;
  if (pct < 20) return { label: 'Clear skies',   emoji: '☀️',  color: '#7dd3fc' }; // sky-300
  if (pct < 40) return { label: 'Mostly clear',  emoji: '🌤️', color: '#38bdf8' }; // sky-400
  if (pct < 60) return { label: 'Partly cloudy', emoji: '⛅',  color: '#0ea5e9' }; // sky-500
  if (pct < 80) return { label: 'Mostly cloudy', emoji: '🌥️', color: '#14b8a6' }; // teal-500
  return              { label: 'Overcast',        emoji: '☁️',  color: '#0d9488' }; // teal-600
}

