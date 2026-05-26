# Sun Scout SF

> Interactive map ranking 600+ San Francisco cafes, bars, parks, and viewpoints by sun view quality — scored in real time as the sun moves across the sky.

---

## Features

- **Real-time viewshed scoring** — each venue is ray-cast toward the current sun azimuth; building polygons and terrain elevation are intersected to produce a 0–100 score that also incorporates the live cloud cover forecast for that neighbourhood
- **Time slider** — scrub from sunrise to civil dusk (sun 6° below horizon); scores recompute instantly via a speculative pass with cached building angles, or precisely after a 200 ms debounce when a large azimuth jump invalidates the cache (threshold: 5°)
- **3D map** — Mapbox GL JS with terrain extrusion (1.6× on desktop, 1.0× on mobile), hillshade, sky atmosphere, and building extrusions; pitch is reduced on mobile (35° vs 55°) to avoid an over-dramatic tilt on small screens
- **Smart clustering** — dots cluster at zoom < 12 and expand on click; individual dots with score colors at zoom 12+
- **Venue list** — slide-out panel with real-time search, type filter (cafes / parks), and minimum-score filter
- **Venue detail panel** — score, quality label, golden hour countdown, outdoor seating tag, Google Maps directions
- **Sun direction ray** — two-layer glow beam (wide amber halo + warm-white dashed core) pointing from the selected venue toward the current sun azimuth
- **Pulsing selection marker** — animated ring highlights the selected venue on the map
- **Cloud cover zone overlay** — 12 SF microclimate zones rendered as soft blurred circles on the map; opacity scales with cloud cover so fogged-in coastal zones get a faint white haze (real fog is white, the dark map makes it visible) while clear inland zones are invisible — the classic "fog rolling in from the coast" pattern is visible at a glance; updates with the 30-min weather refresh and tracks the slider hour
- **SF microclimate weather** — 12 neighbourhood zones (Outer Sunset, Inner Sunset, Outer Richmond, Inner Richmond, Twin Peaks, Noe Valley, Mission, Bernal Heights, Potrero/SOMA, Downtown, Marina, North Beach) queried in a single Open-Meteo batch request (free, no API key); cloud cover is factored directly into each venue's score using that zone's forecast, the time pill shows city-average conditions, and the venue detail panel shows neighbourhood-specific conditions — reflecting SF's 60+ point cloud-cover spreads between foggy coast and sunny inland
- **Pre-bundled data** — venue and building data shipped as static JSON served from CDN; no Overpass API calls at runtime

---

## Tech Stack

| Concern | Library / Service |
|---|---|
| UI framework | React 18 |
| Styling | TailwindCSS |
| Bundler | Vite 6 |
| Map rendering | Mapbox GL JS v3 |
| Terrain elevation | Mapbox terrain-RGB tiles (decoded client-side) |
| Geo math | Turf.js — bearing, destination, lineIntersect, distance, centroid |
| Sun position | SunCalc |
| Venue & building data | OpenStreetMap via Overpass API (pre-fetched, bundled as static JSON) |
| Weather | Open-Meteo (free, no API key) — 12 SF microclimate zones, batch hourly forecast |
| CI / data refresh | GitHub Actions (daily cron) |
| Unit & integration tests | Vitest 3 + jsdom |
| Visual testing | Playwright (dev dependency) |

---

## Prerequisites

- Node.js 18+
- A free [Mapbox public token](https://mapbox.com) (`pk.eyJ1...`)

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd sf-sunset-finder
npm install

# 2. Set up your Mapbox token
cp .env.example .env
# Edit .env and set VITE_MAPBOX_TOKEN=pk.eyJ1...

# 3. Fetch venue and building data
npm run fetch-data

# 4. Start the dev server
npm run dev
```

Open [http://localhost:5174](http://localhost:5174).

`fetch-data` populates `public/data/` from Overpass and is required before first run. The files are gitignored — re-run whenever you want fresh OSM data.

Want to contribute or adapt this for another city? See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_MAPBOX_TOKEN` | Yes | Mapbox public token — used for map tiles, terrain-RGB tiles, and 3D terrain |

Copy `.env.example` to `.env` and fill in the token. Never commit `.env`.

---

## Project Structure

```
.github/
└── workflows/
    └── refresh-data.yml     # Daily cron: re-fetches venue/building data and redeploys

public/
└── data/                    # Generated at build time by npm run fetch-data (gitignored)
    ├── venues.json          #   1 000+ OSM cafes, parks, viewpoints
    └── buildings.json       #   3 000+ OSM building polygons

scripts/
└── fetch-data.js            # Node script that populates public/data/ from Overpass

src/
├── App.jsx                  # Root: state, data loading, score orchestration
├── components/
│   ├── MapView.jsx          # Mapbox GL map, layers, clustering, markers, tooltip
│   ├── VenuePanel.jsx       # Selected-venue detail slide-in panel
│   ├── VenueList.jsx        # Ranked venue list with search and filters
│   ├── TimeSlider.jsx       # Time-of-day scrubber with golden hour visualization
│   ├── LoadingStatus.jsx    # Loading pill during initial data load
│   └── Legend.jsx           # Score color legend (desktop only)
└── lib/
    ├── viewshed.js          # Ray-casting scoring algorithm (computeBuildingBlockDeg, applyScoreFormula)
    ├── terrain.js           # Mapbox terrain-RGB tile decode and elevation sampling
    ├── weather.js           # Open-Meteo fetch, 12-zone microclimate data, cloud cover helpers
    ├── overpass.js          # Data loader: static bundle → localStorage cache → live Overpass
    └── sun.js               # SunCalc wrappers — azimuth, altitude, golden hour times

src/test/
├── viewshed.test.js         # 23 unit tests — scoring formula, quality tiers, color mapping
├── weather.test.js          # 37 unit tests — zone lookup, cloud cover helpers, GOES URLs
├── sun.test.js              # 23 unit tests — position, times, formatTime
├── terrain.test.js          #  6 unit tests — safe defaults when tile cache is empty
├── integration.test.js      # 20 integration tests — full pipeline with real SF buildings
└── fixtures/
    ├── buildings-dolores.json  # 9 real OSM buildings around Dolores Park (max 18 m)
    └── buildings-fidi.json     # 109 real OSM buildings in FiDi (max 226 m)
```

---

## Scoring Algorithm

Each venue receives a **0–100 sun view score** for the selected time of day. The pipeline is split into two functions in `src/lib/viewshed.js` so the expensive step can be cached:

- `computeBuildingBlockDeg()` — ray-casts through ~3 000 building polygons. Result is cached per venue keyed on sun azimuth; reused on slider moves where the azimuth changes by less than 5° (~20 min of real sun movement).
- `applyScoreFormula()` — pure arithmetic on the cached block angle; always runs on every slider move.

### Steps

1. **Ray cast** — 13 rays are cast from the venue across a ±30° fan around the sun azimuth (every 5°), each 1.5 km long. The wider fan (vs the previous ±15°, 3-ray approach) catches buildings that fell between the old gaps.
2. **Building intersection** — each ray is intersected with tall-building polygons (3+ stories) within range. The closest hit gives the angular height that building subtends above the venue's horizon.
3. **Cosine-weighted average** — each ray's block angle is weighted by `cos(offset)`, so a narrow building blocking only the central rays hurts less than a broad ridge blocking all 13. This differentiates a slender skyscraper from a wide hillside wall with the same peak vertical angle.
4. **Terrain sampling** — `computeTerrainBlockDeg()` samples terrain elevation at 8 distances (0.15 – 6.5 km) along the sun azimuth and returns the maximum horizon angle the hills create.
5. **Elevation bonus** — venues above SF's median elevation (~50 m) receive up to +12 points; below median, up to −12.
6. **Horizon score** — the effective block angle (max of cosine-weighted buildings and terrain) feeds a continuous exponential formula instead of a stepped table, eliminating scoring cliffs:

   `horizonScore = 95 × exp(−0.22 × blockDeg^0.70)`

   Calibrated anchor points: 0° → 95, ~0.5° → 83, ~3.5° → 69, ~7° → 49, ~14° → 27.

7. **Twilight penalty** — once the sun dips below the horizon (0° → −6°), scores decay linearly: 0 pts at 0°, −60 pts at −6°. Venues score 0 and are labelled "night" beyond −6°.
8. **Cloud cover penalty** — the live forecast for the venue's SF microclimate zone is applied as a stepped penalty: <20% cloud → 0 pts (light cloud can enhance colours), 20–40% → −5, 40–60% → −20, 60–80% → −40, ≥80% → −55. Scores update automatically every 30 min and whenever the slider moves to a new hour with different forecast conditions.
9. **Final score** — `clamp(horizonScore + elevBonus − directBlockPenalty − twilightPenalty − cloudPenalty, 5, 100)`

### Score Legend

| Color | Range | Label |
|---|---|---|
| 🟠 Orange | ≥ 80 | Excellent |
| 🟡 Amber | ≥ 60 | Great |
| 🟨 Yellow | ≥ 40 | Good |
| 🔵 Steel | ≥ 20 | Partial |
| ⬛ Dark | < 20 | Blocked |

Parks and viewpoints are shown with a **green ring**. The **sun direction ray** (amber glow with warm-white dashed core) points from the selected venue toward the current sun azimuth.

---

## Development

```bash
npm run dev          # Start Vite dev server with hot reload
npm run build        # Production build → dist/
npm run preview      # Preview the production build locally
npm run fetch-data   # Re-fetch venue and building data from Overpass → public/data/
npm test             # Run unit tests (Vitest)
npm run test:watch   # Run tests in watch mode
```

### Refreshing venue data manually

Run `npm run fetch-data` whenever you want to pull the latest cafes, parks, and buildings from OpenStreetMap. The script queries Overpass, writes the results to `public/data/`, and prints file sizes. Commit the updated JSON files to deploy the refresh.

```bash
npm run fetch-data
git add public/data/
git commit -m "chore: refresh venue and building data"
git push
```

### Unit and integration tests

109 tests across two tiers — all pass, all run in under 2 seconds.

```bash
npm test             # single run
npm run test:watch   # re-runs on file change
```

**Unit tests (89)** in `src/test/` cover all pure logic modules with no external dependencies (no Mapbox token, no network calls). Run in jsdom via Vitest.

**Integration tests (20)** in `src/test/integration.test.js` exercise the full `prepareBuildingIndex → computeBuildingBlockDeg → applyScoreFormula` pipeline with real OSM building fixtures:
- `fixtures/buildings-dolores.json` — 9 buildings near Dolores Park (max 18 m, open views)
- `fixtures/buildings-fidi.json` — 109 buildings in FiDi (max 226 m, Salesforce Tower neighbours)

The integration tests verify that a FiDi venue scores at least 15 points lower than Dolores Park at golden hour, that buildings in the opposite direction from the sun don't affect scores, and that score monotonicity holds (adding blocking buildings never raises a score).

### Visual testing with Playwright

Playwright is installed as a dev dependency. Scripts require the module directly from `node_modules/` and run against the dev server.

```bash
npm run dev &
node your-test-script.js   # require('/path/to/node_modules/playwright')
```

---

## Deployment

The app is a fully static Vite build — no backend required. Deploy to any CDN-backed host.

Set `VITE_MAPBOX_TOKEN` as an environment variable on your platform, and use this as your build command so venue data is fetched fresh at deploy time:

```bash
npm run fetch-data && npm run build
```

Output directory: `dist/`

### Data loading fallback chain

`overpass.js` tries three sources in order, so the app never hard-fails even if the static files are missing:

1. `/data/venues.json` — static file served from CDN (production)
2. `localStorage` — 6-hour TTL cache (repeat dev sessions)
3. Live Overpass API — last resort with one automatic retry

---

## Data Sources

| Data | Source | Refresh |
|---|---|---|
| Venues (cafes, bars, parks, viewpoints) | OpenStreetMap / Overpass API | Daily via GitHub Actions |
| Building polygons (3+ stories) | OpenStreetMap / Overpass API | Daily via GitHub Actions |
| Terrain elevation | Mapbox terrain-RGB tiles, decoded client-side | On-demand (Mapbox CDN) |
| Sun position | SunCalc (local calculation) | Real-time — recalculated every 30 s and on every slider move |
| Weather / cloud cover | Open-Meteo — 12 SF microclimate zones, one batch request | Fetched on page load; auto-refreshed every 30 min; 30-min localStorage cache avoids redundant requests |

---

## Data Freshness

| What you see | How fresh it is |
|---|---|
| Sun position & scores | Updated every 30 seconds automatically; instantly when you move the time slider |
| Weather / cloud cover | Refetched every 30 min while the tab is open; the first load uses a localStorage cache if it's less than 30 min old. Each successful fetch records its timestamp, shown in the slider note as "updated 3:45 PM" — always accurate regardless of the refresh interval. A new fetch also triggers an instant re-score of all venues. |
| Venue & building data | Refreshed daily at 6 AM UTC (10 PM PT) by GitHub Actions; bundled into the static build |
| Map tiles & terrain | Loaded on demand from Mapbox CDN; browser-cached per normal HTTP rules |
