# Smoothness and interaction QA

## Scope

This pass changes only the React/Vite client and its tests/documentation. The Express server, shared analysis constants, scoring, remediation, verification services, API contracts, package manifests and dependency lockfile are unchanged. No GitHub write capability or 3D animation was added.

## Reproduced problems and fixes

- **Competing scroll and navigation:** a bottom-of-FIND navigation started at `scrollY=1197`, drifted through 557 and 47 pixels, then reached zero over roughly 450 ms. The route reset now runs before paint with explicit `behavior: "instant"`. Hash links retain native smooth scrolling; reduced motion disables that smoothing. Navigation moves focus to the destination heading or the main landmark.
- **Oversized/transparent wipe:** the old pseudo-element started invisible and grew to the full height of long pages (over 7,000 px in the demo). The same left-to-right angled curtain now covers the first destination frame, reveals in 380 ms, and is capped to the viewport. It has no routing delay, click interception or overlapping layers. Minor UI interactions do not replay it.
- **Redundant requests and flashes:** revisiting unchanged FIX made a second preview request. A small per-workspace resource cache now shares pending requests and reuses genuine immutable responses keyed by scan, selected finding IDs and verification ID. It keeps errors visible until retry, discards superseded completions and retains at most 20 inactive settled resources.
- **Late scan redirects:** leaving a delayed scan previously caused navigation back to its result after the user opened Scoring method. The abandoned client request and observation loop now clean up; server-side work is not represented as cancelled. An initial progress 404 is retried while the real scan is pending. Polling has a fixed observation budget and is cleared on success, failure or unmount.
- **Keyboard and legibility:** diff areas and the PR draft are explicitly focusable native scroll regions; diff signs no longer render twice; added-line text and small sidebar links are readable; status glyphs and distinct border treatments distinguish passed/failed/warning/informational states without new hues.
- **Measured layout defects:** SCAN's invalid description-list markup is now a labelled group. REVIEW's sidebar cards size to their content instead of stretching to match every diff on the left. Short table status badges no longer break mid-word.

## Commands used

From `reporescue/`:

```sh
npm ci --no-audit --no-fund
npm run lint
npm run test:unit
npm run test:integration
npm test
npm run build
```

The normal suite has **38 tests** (26 unit and 12 integration), including four new workspace-resource regressions. Baseline was 34 tests. The fixture assertions still pin Beacon at 47 before / 84 after local validation, and Tidewatch at 85 before fixes.

### Optional production-browser run (no application dependency added)

Install a browser tool into npm's temporary cache, not into the application manifests:

```sh
npm exec --yes --package=playwright -- playwright install chromium --with-deps
```

Start the real built client and API:

```sh
PORT=3201 HOST=127.0.0.1 REPORESCUE_PERSIST=false npm start
```

In a separate terminal, from `reporescue/`:

```sh
PLAYWRIGHT_MODULE="$(find "$(npm config get cache)/_npx" -path '*/node_modules/playwright/index.mjs' -print -quit)" \
QA_BASE_URL=http://127.0.0.1:3201 \
QA_ARTIFACTS=/tmp/reporescue-smoothness \
node tests/browser/smoothness.js
```

The script runs **29 browser checks** against the production Vite bundle served by Express. All successful scan, patch, draft, ZIP and verification responses come from the real local API. Slow/error cases delay real responses or abort a request; they do not fabricate a successful result. Long-text checks inject explicitly labelled display-only stress strings without changing server data.

Covered in headless Chromium:

- Overview and all five stages at 360 / 768 / 1280 / 1600 px, without document-wide horizontal overflow.
- Keyboard skip link, disclosure, disabled action, diff scrolling and horizontal table scrolling.
- Bottom-of-page and short-page navigation, browser Back, native hash anchors and predictable focus.
- Repeated stage navigation with no duplicate preview/draft/verification reads.
- Rapid navigation with delayed real responses; latest route wins.
- Clipboard completion and a downloaded ZIP with the actual ZIP signature.
- Selection changes, recorded verification integrity and the no-GitHub-writes boundary.
- Preview and assessment-fetch errors with successful real retries.
- Leaving an in-flight scan; no late redirect or continued polling.
- Initial missing progress record followed by real recovery.
- Reduced motion, no orb/canvas, no browser page exceptions.

Screenshots and the downloaded review ZIP go to the artifact directory, not the source tree.

## Accessibility review and limitations

A separate temporary axe-core browser audit covered Overview, SCAN, FIND, FIX and REVIEW. It found a real SCAN definition-list violation, which was fixed; the repeat audit reported no definite violations on those pages. **Colour-contrast checks remained incomplete on layered glass and pseudo-element surfaces** (100–397 nodes per page), so this is not a claim that every WCAG criterion or every contrast pairing passed. Screenshots were also inspected, and the known text-legibility issues above were corrected.

The browser regression suite is Chromium on Linux. Safari, Firefox, real mobile hardware, assistive-technology speech output, and representative-device FPS are not verified. No live GitHub scan or remote CI was needed for this UI pass. Existing deterministic service tests establish that analysis outcomes were preserved.
