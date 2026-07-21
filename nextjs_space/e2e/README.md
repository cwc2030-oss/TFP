# TFP browser E2E suite (Playwright)

These specs close the two test holes flagged in the weekly system test:

- **TC-A3 — Hunt Zone ring drag** (`terrain-ring-drag.spec.ts`). The ring is a
  WebGL Mapbox layer with no DOM node, so the vitest/jsdom harness could not
  exercise a mouse drag (INCONCLUSIVE). Playwright drives a real pointer drag
  over the map canvas and asserts the ring moved + re-read on settle, using the
  `window.__tfpHuntZone` test hook the app exposes on drag/read commit.
- **TC-A10 — failure ≠ flat** (`terrain-failure-not-flat.spec.ts`). Drives the
  forced compute-failure path (`?forceFail=1`, honored only when the server env
  `TFP_ALLOW_TEST_FAILURE=1`) and asserts the UI shows an explicit "tap to
  retry" affordance rather than a false flat/zero read.

## One-time setup

Playwright is intentionally NOT a default dependency (keeps the app build
light). Install it once in the weekly-suite environment:

```bash
yarn add -D @playwright/test
npx playwright install chromium
```

## Running

Against the local dev server (port 3000):

```bash
PW_BASE_URL=http://localhost:3000 npx playwright test
```

Against the staging deploy (TFP_ALLOW_TEST_FAILURE=1 is set there):

```bash
PW_BASE_URL=https://terra-firma-mapping-nf30ep.abacusai.app npx playwright test
```

The `e2e/` folder is excluded from the app's TypeScript build and from the
vitest run, so these specs never affect `yarn test`, `tsc`, or the production
build.
