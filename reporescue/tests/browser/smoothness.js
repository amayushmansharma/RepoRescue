/* global document, window, getComputedStyle, navigator, requestAnimationFrame */
/** Optional production-browser regression suite. No app/test dependency changes.
 * Build/start Express first; see docs/SMOOTHNESS_QA.md for the exact commands.
 * Success responses always come from the real local API. Fault injection only
 * delays genuine responses or aborts a request to exercise the existing errors.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const base = process.env.QA_BASE_URL ?? "http://127.0.0.1:3201";
const artifacts = process.env.QA_ARTIFACTS ?? "/tmp/reporescue-smoothness";
await fs.mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const pageErrors = [];
const requests = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("request", (request) => {
  if (new URL(request.url()).pathname.startsWith("/api/")) requests.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postData() });
});
let passed = 0;
const pass = (message) => console.log(`PASS ${++passed}. ${message}`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const nav = () => page.getByRole("navigation", { name: "RepoRescue workflow stages" });
const stage = (label) => nav().getByRole("link", { name: new RegExp(`\\d{2}\\s*${label}`) });
const count = (url) => requests.filter((request) => request.path === url).length;
async function checkWidth(label) {
  await frames();
  const sizes = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  assert(sizes.document <= sizes.viewport + 1, `${label}: overflow ${JSON.stringify(sizes)}`);
}
async function allWidths(label) {
  for (const width of [360, 768, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await checkWidth(`${label}@${width}`);
  }
  pass(`${label}: no page overflow at 360 / 768 / 1280 / 1600px`);
}
async function startDemo(label = "Beacon API") {
  const response = page.waitForResponse((result) => new URL(result.url()).pathname === "/api/scans" && result.request().method() === "POST");
  await page.getByRole("button", { name: new RegExp(`Scan the bundled ${label}`) }).click();
  const payload = await (await response).json();
  assert.equal(payload.ok, true);
  await nav().waitFor();
  return payload.data.scan;
}
async function nextStage(label, suffix) {
  await stage(label).click();
  await page.waitForURL((url) => url.pathname.endsWith(suffix));
  await frames();
}

try {
  const health = await (await context.request.get(`${base}/api/health`)).json();
  assert.equal(health.checks.remoteWrites, "disabled");
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Scan the bundled Beacon API/ }).waitFor();
  await allWidths("Overview");
  await page.setViewportSize({ width: 360, height: 850 });
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Skip to main content");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "main");
  pass("Skip link moves keyboard focus to the existing main landmark");
  await page.setViewportSize({ width: 1280, height: 900 });
  const scan = await startDemo();
  assert.equal(scan.score.total, 47);
  assert.equal(scan.findings.length, 10);
  const autoIds = scan.findings.filter((finding) => finding.remediation.kind === "auto").map((finding) => finding.id);
  pass("Real demo scan still returns 47/100 and 10 findings");
  await allWidths("SCAN");
  await nextStage("Find", "/findings");
  await allWidths("FIND");
  await page.getByLabel("Search findings").fill("no-such-finding-sentinel");
  await page.getByText("No findings match these filters").waitFor();
  await page.getByLabel("Search findings").fill("");
  await page.getByLabel("Severity", { exact: true }).selectOption("high");
  assert.equal(await page.locator(".finding").count(), scan.findings.filter((finding) => finding.severity === "high").length);
  await page.getByLabel("Severity", { exact: true }).selectOption("all");
  const disclosure = page.locator(".finding-head").first();
  await disclosure.focus();
  await page.keyboard.press("Enter");
  assert.equal(await disclosure.getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Enter");
  pass("Filtering, empty state and keyboard disclosure remain functional");

  // Navigate from a long page's bottom. Check the destination after its commit,
  // not an arbitrary millisecond before React Router has applied navigation.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  assert(await page.evaluate(() => window.scrollY > 100));
  await page.getByRole("link", { name: /Continue to FIX/ }).click();
  await page.waitForURL(/\/fix$/);
  await page.getByRole("heading", { name: "Proposed changes, generated from rules" }).waitFor();
  await frames();
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.equal(await page.evaluate(() => document.activeElement.tagName), "H1");
  const wipe = await page.locator(".workspace-content").evaluate((el) => {
    const css = getComputedStyle(el, "::after");
    return { duration: css.animationDuration, pointer: css.pointerEvents, height: parseFloat(css.height), viewport: window.innerHeight };
  });
  assert.equal(wipe.duration, "0.38s");
  assert.equal(wipe.pointer, "none");
  assert(wipe.height <= wipe.viewport + 1);
  await page.locator(".diff").first().waitFor();
  pass("Bottom-to-stage navigation resets instantly, focuses H1 and limits the nonblocking wipe to one viewport");
  await allWidths("FIX");
  const previews = count("/api/remediations/preview");
  await nextStage("Find", "/findings");
  await nextStage("Fix", "/fix");
  await page.locator(".diff").first().waitFor();
  assert.equal(count("/api/remediations/preview"), previews);
  pass("Revisiting unchanged FIX preserves its preview without another API request");

  await page.setViewportSize({ width: 360, height: 850 });
  const diff = page.locator(".diff-body").first();
  await diff.focus();
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.querySelector(".diff-body").scrollTop > 0);
  assert.equal(await diff.getAttribute("tabindex"), "0");
  await diff.press("Home");
  pass("Native diff scrolling works from the keyboard, without wheel handlers");
  await page.getByRole("link", { name: /Continue to REVIEW/ }).click();
  await page.waitForURL(/\/review$/);
  await page.getByRole("heading", { name: "PR draft", exact: true }).waitFor();
  await frames();
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  assert.equal(count("/api/remediations/preview"), previews);
  pass("REVIEW reuses the same real patch preview and opens at its beginning");
  await allWidths("REVIEW");
  const draftCalls = count("/api/pull-requests/preview");
  await page.getByRole("button", { name: "Copy title", exact: true }).click();
  await page.getByText("PR title copied to the clipboard.", { exact: true }).waitFor();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert(clipboard.includes("improve contributor onboarding"));
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download review ZIP" }).click();
  const download = await downloadPending;
  await download.saveAs(path.join(artifacts, "review.zip"));
  const bytes = await fs.readFile(path.join(artifacts, "review.zip"));
  assert.equal(bytes.subarray(0, 4).toString("hex"), "504b0304");
  pass("Copy waits for the actual clipboard result; ZIP export returns a real archive");
  await page.screenshot({ path: path.join(artifacts, "review-desktop.png"), fullPage: false });
  await nextStage("Fix", "/fix");
  await nextStage("Review", "/review");
  await page.getByRole("heading", { name: "PR draft", exact: true }).waitFor();
  assert.equal(count("/api/pull-requests/preview"), draftCalls);
  pass("Revisiting REVIEW preserves the draft without a loading flash or duplicate request");

  const verifyResponse = page.waitForResponse((result) => new URL(result.url()).pathname === "/api/verifications" && result.request().method() === "POST");
  await page.getByRole("button", { name: /Verify proposed changes/ }).click();
  const verification = (await (await verifyResponse).json()).data.verification;
  assert.equal(verification.status, "passed");
  assert.equal(verification.comparison.beforeScore, 47);
  assert.equal(verification.comparison.afterScore, 84);
  assert.equal(verification.comparison.resolved.length, autoIds.length);
  await page.waitForURL(/\/verify$/);
  await page.getByRole("heading", { name: "Verification checks", exact: true }).waitFor();
  await page.getByText("Remote CI: not run", { exact: true }).waitFor();
  await page.getByText("Pull request: not created", { exact: true }).waitFor();
  assert.equal(count(`/api/verifications/${verification.id}`), 0, "The already returned record should not be fetched again");
  pass("Real local verification remains 47 → 84, with remote CI and PR correctly not run");
  await allWidths("VERIFY");
  await nextStage("Find", "/findings");
  await nextStage("Verify", "/verify");
  await page.getByRole("heading", { name: "Verification checks", exact: true }).waitFor();
  assert.equal(count(`/api/verifications/${verification.id}`), 0);
  pass("Recorded verification survives repeated stage navigation unchanged");

  // Controls and selection changes must not restart the stage curtain.
  await nextStage("Find", "/findings");
  await pause(430);
  const animationsBefore = await page.locator(".workspace-content").evaluate((el) => el.getAnimations({ subtree: false }).map((a) => a.currentTime));
  await page.getByLabel("Search findings").fill("environment");
  const animationsAfter = await page.locator(".workspace-content").evaluate((el) => el.getAnimations({ subtree: false }).map((a) => a.currentTime));
  assert.deepEqual(animationsAfter, animationsBefore);
  await page.getByLabel("Search findings").fill("");
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  assert(await page.getByRole("button", { name: /Continue to FIX/ }).isDisabled());
  await page.getByRole("button", { name: "Select all auto-fixable", exact: true }).click();
  await nextStage("Verify", "/verify");
  await page.getByRole("heading", { name: "Not started", exact: true }).waitFor();
  pass("Minor filtering does not replay the wipe; selection edits correctly invalidate old verification evidence");

  // Rapid clicks with a real, deliberately delayed response; latest URL wins.
  await page.route("**/api/pull-requests/preview", async (route) => {
    const response = await route.fetch();
    await pause(650);
    await route.fulfill({ response }).catch(() => {});
  });
  await nextStage("Review", "/review");
  await stage("Fix").evaluate((el) => el.click());
  await stage("Find").evaluate((el) => el.click());
  await stage("Verify").evaluate((el) => el.click());
  await page.waitForURL(/\/verify$/);
  await pause(850);
  assert(new URL(page.url()).pathname.endsWith("/verify"));
  assert.equal(await page.locator(".workspace-content").count(), 1);
  await page.getByRole("heading", { name: "What was actually checked" }).waitFor();
  await page.unroute("**/api/pull-requests/preview");
  pass("Rapid navigation and delayed real responses cannot restore a stale route or stack wipe layers");

  // Exercise the genuine recoverable network error state, then allow the next
  // request through to the real API. No successful response is mocked.
  await nextStage("Fix", "/fix");
  let failOnce = true;
  await page.route("**/api/remediations/preview", async (route) => {
    if (failOnce) { failOnce = false; return route.abort("failed"); }
    return route.continue();
  });
  const selectedBox = page.locator(`input[id="select-${autoIds[0]}"]`);
  await selectedBox.uncheck();
  await page.getByRole("button", { name: "Retry preview", exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry preview", exact: true }).click();
  await page.locator(".diff").first().waitFor();
  assert.equal(await page.getByRole("button", { name: "Retry preview", exact: true }).count(), 0);
  await page.unroute("**/api/remediations/preview");
  pass("A failed preview is honest, retryable, and clears its error after the real retry succeeds");

  // Walk away from an actual POST, holding only its response in the test proxy.
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Overview" }).click();
  let lateRequest;
  const pendingResponse = new Promise((resolve) => { lateRequest = resolve; });
  await page.route("**/api/scans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    lateRequest();
    await pause(1000);
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByRole("button", { name: /Scan the bundled Tidewatch/ }).click();
  await pendingResponse;
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Scoring method" }).click();
  await pause(1400);
  assert.equal(new URL(page.url()).pathname, "/methodology");
  await page.unroute("**/api/scans");
  pass("Leaving a slow scan aborts client observation and never redirects back on late completion");

  // Slow acceptance makes the first real progress lookup return 404. It must
  // recover on a later poll instead of permanently losing progress reporting.
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Overview" }).click();
  let progressReads = 0;
  let sawProgress404 = false;
  const onProgress = (response) => {
    if (response.url().includes("/api/scans/progress/")) { progressReads += 1; if (response.status() === 404) sawProgress404 = true; }
  };
  page.on("response", onProgress);
  await page.route("**/api/scans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await pause(650);
    const response = await route.fetch();
    await pause(950);
    await route.fulfill({ response }).catch(() => {});
  });
  const completedScan = await startDemo("Tidewatch");
  assert.equal(completedScan.score.total, 85);
  assert(sawProgress404 && progressReads >= 2, `Expected first 404 then recovery, got ${progressReads} reads`);
  page.off("response", onProgress);
  await page.unroute("**/api/scans");
  pass("Initial missing-progress race recovers while the real scan is pending; Tidewatch score remains 85");

  await page.goto(base);
  await page.getByLabel("Public GitHub repository").fill("https://gitlab.com/owner/repo");
  await page.getByRole("button", { name: "Scan repository", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "INVALID_REPOSITORY" }).waitFor();
  const progressAfterFailure = requests.filter((request) => request.path.includes("/progress/")).length;
  await pause(650);
  assert.equal(requests.filter((request) => request.path.includes("/progress/")).length, progressAfterFailure);
  pass("Real invalid-repository error stops loading and all progress polling");

  // Route changes from a short page and browser Back should not animate a
  // second, competing scroll. Hash links remain native in-page navigation.
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Scoring method" }).click();
  await page.getByRole("heading", { name: "A score you can audit" }).waitFor();
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("link", { name: "Overview" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await frames();
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.goBack();
  await page.waitForURL(/\/methodology$/);
  await frames();
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await page.locator(".skip-link").evaluate((el) => el.click());
  await page.waitForURL((url) => url.hash === "#main");
  await page.waitForFunction(() => window.scrollY < 180);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "smooth");
  pass("Browser Back and footer navigation reset immediately; native in-page anchor scrolling remains smooth");

  await page.setViewportSize({ width: 360, height: 850 });
  const table = page.getByRole("region", { name: "API routes table" });
  await table.waitFor();
  await table.focus();
  const tableWidths = await table.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  if (tableWidths.scroll > tableWidths.client) {
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector('[aria-label="API routes table"]').scrollLeft > 0);
  }
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "API routes table");
  await checkWidth("keyboard table");
  pass("Horizontal tables keep native keyboard scrolling inside the panel");

  await page.goto(`${base}/scan/${scan.scanId}/review`);
  await page.getByRole("heading", { name: "PR draft", exact: true }).waitFor();
  // Synthetic display-only stress strings: server data and scores are untouched.
  await page.locator(".repo-console-name").evaluate((el) => { el.textContent = "an-extremely-long-owner/" + "repository-name-".repeat(16); });
  await page.locator(".diff-head > .mono").first().evaluate((el) => { el.textContent = "packages/" + "a-long-path-segment/".repeat(18) + "README.md"; });
  await page.getByRole("region", { name: "Pull request draft description" }).evaluate((el) => { el.textContent += "\n" + "unbroken-identifier".repeat(35); });
  await checkWidth("synthetic long text");
  pass("Long repository names, file paths and draft text remain within the mobile layout");

  let failAssessment = true;
  await page.route(`**/api/scans/${scan.scanId}`, async (route) => {
    if (failAssessment) { failAssessment = false; return route.abort("failed"); }
    return route.continue();
  });
  await page.goto(`${base}/scan/${scan.scanId}`);
  await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("heading", { name: "beacon-labs/beacon-api", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Retry", exact: true }).count(), 0);
  await page.unroute(`**/api/scans/${scan.scanId}`);
  pass("Assessment-fetch failure shows Retry and recovers with the actual server record");

  const reduced = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${base}/scan/${scan.scanId}/findings`);
  await reducedPage.getByRole("heading", { name: "Findings you can reproduce" }).waitFor();
  assert.equal(await reducedPage.locator(".workspace-content").evaluate((el) => getComputedStyle(el, "::after").animationName), "none");
  assert.equal(await reducedPage.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "auto");
  assert.equal(await reducedPage.locator("canvas").count(), 0);
  await reducedPage.screenshot({ path: path.join(artifacts, "findings-mobile.png"), fullPage: false });
  await reduced.close();
  pass("Reduced motion removes the wipe and smooth anchor scrolling; no orb or canvas exists");

  assert.deepEqual(pageErrors, [], `Browser runtime errors: ${pageErrors.join(" | ")}`);
  pass("No page runtime exceptions during the production browser journey");
  console.log(`RESULT: ${passed} browser checks passed`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: false }).catch(() => {});
  console.error(`FAILED after ${passed} passes: ${error.stack ?? error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
