# Contributing to Sun Scout SF

Thanks for your interest in contributing. This document covers how to get the project running locally and how to submit changes.

---

## Getting Started

### Prerequisites

- Node.js 18+
- A free [Mapbox public token](https://mapbox.com) (`pk.eyJ1...`)

### Local setup

```bash
git clone https://github.com/sreeram12/sf-sunset-finder.git
cd sf-sunset-finder
npm install

cp .env.example .env
# Edit .env and add your VITE_MAPBOX_TOKEN

npm run fetch-data   # populate public/data/ from OpenStreetMap
npm run dev          # start dev server at http://localhost:5174
```

### Mapbox token URL restrictions

Mapbox tokens can be scoped to specific domains. For local development, add `http://localhost:5174` to your token's allowed URLs in the Mapbox dashboard. Never commit your `.env` file.

---

## Making Changes

### Branch workflow

`main` is protected — all changes must go through a pull request.

```bash
git checkout -b your-feature-or-fix
# make changes
git push origin your-feature-or-fix
# open a PR on GitHub
```

### Code style

- No comments unless the *why* is non-obvious
- Prefer editing existing files over creating new ones
- Keep components focused — if a component is doing two unrelated things, split it
- Run `npm run build` before opening a PR to catch any type or bundling errors

### Running unit tests

```bash
npm test             # single run — all 109 tests
npm run test:watch   # watch mode for TDD
```

Tests live in `src/test/` and cover all pure logic modules:

| File | Type | What's tested |
|---|---|---|
| `viewshed.test.js` | Unit | `applyScoreFormula`, `computeBuildingBlockDeg`, `getScoreColor`, quality tiers, constants |
| `weather.test.js` | Unit | `getNearestZone`, `cloudCoverInfo`, `getAverageHourly`, `getGOESImageUrls`, zone data structure |
| `sun.test.js` | Unit | `getSunPosition`, `getSunTimes`, `formatTime`, `minutesUntilSunset` |
| `terrain.test.js` | Unit | Safe defaults when tile cache is empty |
| `integration.test.js` | Integration | Full pipeline with real SF building fixtures — Dolores Park vs FiDi ranking, direction sensitivity, score monotonicity |

No Mapbox token or network access is required — all tests run in jsdom. Integration tests use OSM building fixtures in `src/test/fixtures/` extracted from `public/data/buildings.json`.

### Visual testing with Playwright

Playwright is used for UI smoke checks against the running dev server:

```bash
npm run dev &
# run a Playwright script against http://localhost:5174
```

---

## Submitting a PR

1. Keep the PR scope small — one fix or feature per PR
2. Fill out the PR template
3. If your change affects the scoring algorithm, explain the reasoning in the PR description
4. Screenshots or screen recordings are appreciated for UI changes

---

## Adapting for Another City

The scoring algorithm and data pipeline are city-agnostic. To add a new city:

1. Update the bounding box in `scripts/fetch-data.js`
2. Update `SF_CENTER` in `src/lib/sun.js` and `src/lib/terrain.js`
3. Update the microclimate zones in `src/lib/weather.js` (`SF_ZONES`)
4. Run `npm run fetch-data` to populate venue and building data for the new area

---

## Reporting Issues

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) for bugs and the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md) for ideas.
