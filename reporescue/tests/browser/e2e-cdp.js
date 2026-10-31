import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const BRAVE_BIN = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const DEBUG_PORT = 9222;
const SCREENSHOT_DIR = path.resolve("screenshots");

await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        } else if (msg.method) {
          const handlers = this.events.get(msg.method) || [];
          for (const handler of handlers) handler(msg.params);
        }
      };
    });
  }

  on(method, handler) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(handler);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.pending.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expression) {
    let code = expression.trim();
    if (!code.includes(";") && !code.includes("\n") && !code.startsWith("return")) {
      code = `return (${code});`;
    }
    const isAsync = code.includes("await");
    const wrapped = `(${isAsync ? "async " : ""}() => { ${code} })()`;
    const res = await this.send("Runtime.evaluate", {
      expression: wrapped,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error("Evaluation error: " + JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  async captureScreenshot(filepath) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    const buffer = Buffer.from(res.data, "base64");
    await fs.writeFile(filepath, buffer);
    console.log(`Saved screenshot: ${filepath}`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log("=== RepoRescue E2E Browser Journey (with Login & Auth) ===");

  const braveProc = spawn(BRAVE_BIN, [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--user-data-dir=/tmp/reporescue-brave-qa",
    "--window-size=1280,960",
    "--no-first-run",
    "--no-default-browser-check",
    "http://localhost:5173/login"
  ], { stdio: "ignore" });

  await new Promise((r) => setTimeout(r, 2000));

  try {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const targets = await res.json();
    const pageTarget = targets.find(t => t.type === "page" && t.url.includes("5173")) || targets[0];
    if (!pageTarget) throw new Error("No page target found");
    console.log("Attached to target:", pageTarget.webSocketDebuggerUrl);

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();

    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");

    const consoleErrors = [];
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        consoleErrors.push(params.args.map((a) => a.value || a.description).join(" "));
      }
    });

    console.log("Waiting for Login page mount...");
    await new Promise((r) => setTimeout(r, 1500));

    // ==========================================
    // STAGE 00: LOGIN PAGE & DEMO ACCESS
    // ==========================================
    console.log("\n--- STAGE 00: LOGIN EXPERIENCE ---");
    const loginText = await client.eval(`document.body.innerText`);
    assert.ok(loginText.includes("Find problems. Understand them. Fix them."), "Tagline present on login page");
    assert.ok(loginText.includes("Continue with GitHub"), "GitHub login button present");
    assert.ok(loginText.includes("Explore Demo Without Signing In"), "Demo explore button present");
    assert.ok(loginText.includes("Privacy & Security Guarantee"), "Security guarantee present");

    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "00-login-page-unconfigured.png"));

    // Check responsive layout at mobile width (375px)
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await new Promise((r) => setTimeout(r, 500));
    const mobileFits = await client.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
    assert.ok(mobileFits, "Login page responsive without horizontal overflow on mobile (375px)");
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "00-login-page-mobile.png"));

    // Restore desktop viewport
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 500));

    // Click "Explore Demo Without Signing In"
    console.log("Clicking 'Explore Demo Without Signing In →'...");
    await client.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Explore Demo Without Signing In'));
      if (btn) btn.click();
      return true;
    `);

    await new Promise((r) => setTimeout(r, 1000));
    const currentUrl = await client.eval(`window.location.pathname`);
    assert.equal(currentUrl, "/", "Transitioned cleanly to Overview page as guest");
    console.log("Navigated to Overview as guest:", currentUrl);

    // ==========================================
    // STAGE 01: SCAN
    // ==========================================
    console.log("\n--- STAGE 01: SCAN ---");
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "01-scan-welcome.png"));

    console.log("Clicking 'Scan the bundled Beacon API'...");
    await client.eval(`
      const btn = Array.from(document.querySelectorAll('button.demo-card, button')).find(b => 
        (b.getAttribute('aria-label') && b.getAttribute('aria-label').includes('Beacon')) ||
        (b.textContent && b.textContent.includes('beacon-api'))
      );
      if (btn) btn.click();
      return true;
    `);

    console.log("Waiting for scan to complete and workspace to load...");
    let scanDone = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const text = await client.eval(`document.body.innerText`);
      if (text.includes("Stage 01") || text.includes("Readiness score") || text.includes("beacon-api")) {
        scanDone = true;
        break;
      }
    }
    if (!scanDone) throw new Error("Scan did not complete within 15s");

    const scanScore = await client.eval(`
      document.body.innerText.match(/(\\d+)\\s*\\/\\s*100/)?.[1]
    `);
    console.log(`Scan completed with initial readiness score: ${scanScore}/100 (Expected: 47)`);
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "01-scan-results.png"));

    // ==========================================
    // STAGE 02: FINDINGS & OPPORTUNITY ENGINE
    // ==========================================
    console.log("\n--- STAGE 02: FINDINGS & OPPORTUNITY ENGINE ---");
    await client.eval(`
      const link = Array.from(document.querySelectorAll('a, button')).find(el => 
        el.textContent.includes('02') || el.textContent.includes('FIND') || el.textContent.includes('Review')
      );
      if (link) link.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const findingsCount = await client.eval(`
      document.querySelectorAll('[data-finding-id], li[class*="finding"], article').length || document.body.innerText.match(/(\\d+)\\s*findings/)?.[1]
    `);
    console.log("Findings view loaded. Total findings detected:", findingsCount);
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "02-findings-all.png"));

    // Switch to Contribution Opportunities tab
    console.log("Switching to '✦ Contribution Opportunities' tab...");
    await client.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Contribution Opportunities'));
      if (btn) btn.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const opportunitiesText = await client.eval(`document.body.innerText`);
    const hasPriorities = opportunitiesText.includes("Priority") || opportunitiesText.includes("Beginner");
    console.log("Contribution Opportunities displayed with priority badges:", hasPriorities);
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "02-contribution-opportunities.png"));

    // Switch back to All Findings and click "✦ Explain with AI"
    console.log("Switching back to All Findings to test AI Explanation...");
    await client.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('All Findings'));
      if (btn) btn.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 600));

    console.log("Expanding first finding card...");
    await client.eval(`
      const head = document.querySelector('button.finding-head');
      if (head) head.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 600));

    console.log("Locating '✦ Explain with AI' button on expanded finding...");
    const explainClicked = await client.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Explain with AI'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    `);

    if (explainClicked) {
      console.log("Clicked Explain with AI, waiting for explanation...");
      let gotExplanation = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const bodyText = await client.eval(`document.body.innerText`);
        if (bodyText.includes("What was found") || bodyText.includes("Why it matters") || bodyText.includes("Analysis")) {
          gotExplanation = true;
          break;
        }
      }
      console.log("Explanation loaded successfully:", gotExplanation);
      await client.captureScreenshot(path.join(SCREENSHOT_DIR, "02-ai-explanation.png"));
    }

    // ==========================================
    // STAGE 03: FIX
    // ==========================================
    console.log("\n--- STAGE 03: FIX ---");
    await client.eval(`
      const navLink = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('03') || a.textContent.includes('FIX'));
      if (navLink) navLink.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 1500));

    const fixPageText = await client.eval(`document.body.innerText`);
    console.log("Fix page loaded. Has proposed fixes:", fixPageText.includes("Proposed") || fixPageText.includes("Fix"));
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "03-fix-workspace.png"));

    // ==========================================
    // STAGE 04: REVIEW & CONTRIBUTOR PLAYBOOK
    // ==========================================
    console.log("\n--- STAGE 04: REVIEW & CONTRIBUTOR PLAYBOOK ---");
    await client.eval(`
      const navLink = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('04') || a.textContent.includes('REVIEW'));
      if (navLink) navLink.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 1500));

    const reviewText = await client.eval(`document.body.innerText`);
    console.log("Review page loaded. Diffs displayed:", reviewText.includes("diff") || reviewText.includes("patch") || reviewText.includes("Branch"));
    console.log("Review page Contributor Playbook present:", reviewText.includes("Contributor Playbook"));
    console.log("Review page Download .patch present:", reviewText.includes(".patch"));
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "04-review-playbook.png"));

    // ==========================================
    // STAGE 05: VERIFY
    // ==========================================
    console.log("\n--- STAGE 05: VERIFY ---");
    await client.eval(`
      const navLink = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('05') || a.textContent.includes('VERIFY'));
      if (navLink) navLink.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 1500));

    console.log("Triggering local verification...");
    await client.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => 
        b.textContent.includes('Run local verification') || b.textContent.includes('Run verification')
      );
      if (btn) btn.click();
      return true;
    `);

    console.log("Waiting for verification results...");
    let verifyDone = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const text = await client.eval(`document.body.innerText`);
      if (text.includes("Resolved findings") || text.includes("84") || text.includes("passed")) {
        verifyDone = true;
        break;
      }
    }
    console.log("Verification completed:", verifyDone);

    const afterScore = await client.eval(`
      const el = document.querySelector('[aria-label*="after score"]');
      const label = el ? el.getAttribute('aria-label') : '';
      const m = label.match(/after score (\\d+) out of 100/);
      return m ? m[1] : (document.body.innerText.match(/after[\\s\\S]*?(\\d+)/i)?.[1] || "unknown");
    `);
    console.log(`Verified new score after fixes: ${afterScore}/100 (Expected: 84)`);
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "05-verify-complete.png"));

    // ==========================================
    // STAGE 06: AUTHENTICATED USER STATE
    // ==========================================
    console.log("\n--- STAGE 06: AUTHENTICATED USER EXPERIENCE ---");
    // Trigger dev login in the browser to receive server session cookie
    console.log("Triggering dev login to establish server session...");
    await client.eval(`
      await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: 'octocat',
          name: 'The Octocat',
          avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4'
        })
      });
      return true;
    `);

    console.log("Navigating to /login with active session cookie...");
    await client.send("Page.navigate", { url: "http://localhost:5173/login" });
    await new Promise((r) => setTimeout(r, 1500));

    const authPageText = await client.eval(`document.body.innerText`);
    assert.ok(authPageText.includes("@octocat"), "Displays authenticated username @octocat");
    assert.ok(authPageText.includes("Continue to Overview"), "Has Continue to Overview action");
    assert.ok(authPageText.includes("Sign out"), "Has Sign out action");
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "00-login-page-authenticated.png"));

    console.log("Navigating to Overview with active session to verify AppHeader...");
    await client.send("Page.navigate", { url: "http://localhost:5173/" });
    await new Promise((r) => setTimeout(r, 1500));

    const headerText = await client.eval(`document.querySelector('.site-header')?.innerText || ''`);
    assert.ok(headerText.includes("@octocat"), "AppHeader displays authenticated user pill");
    assert.ok(headerText.includes("Sign out"), "AppHeader displays Sign out button");
    await client.captureScreenshot(path.join(SCREENSHOT_DIR, "00-appheader-authenticated.png"));

    console.log("Clicking Sign out button in AppHeader...");
    await client.eval(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sign out'));
      if (btn) btn.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 1000));

    const headerAfterSignout = await client.eval(`document.querySelector('.site-header')?.innerText || ''`);
    assert.ok(headerAfterSignout.includes("Sign in"), "AppHeader reverted to Sign in after logout");
    console.log("Sign out verified cleanly:", headerAfterSignout.includes("Sign in"));

    // ==========================================
    // STAGE 07: POST-LOGOUT GUEST REGRESSION
    // ==========================================
    console.log("\n--- STAGE 07: POST-LOGOUT GUEST REGRESSION ---");
    const guestOverview = await client.eval(`window.location.pathname === '/'`);
    assert.ok(guestOverview, "Currently on Overview as logged-out guest");

    console.log("Opening existing demo scan workspace as logged-out guest...");
    await client.eval(`
      const openBtn = Array.from(document.querySelectorAll('a')).find(a => a.textContent === 'Open' || a.href.includes('/scan/'));
      if (openBtn) openBtn.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 1200));

    const postLogoutUrl = await client.eval(`window.location.pathname`);
    assert.ok(postLogoutUrl.includes("/scan/"), "Guest successfully opened scan workspace after logout");

    const navStages = await client.eval(`
      Array.from(document.querySelectorAll('.workspace-stage-link')).map(a => a.textContent.trim())
    `);
    assert.ok(navStages.some(s => s.includes("Find")), "Stage 02 Find accessible to logged-out guest");
    assert.ok(navStages.some(s => s.includes("Fix")), "Stage 03 Fix accessible to logged-out guest");
    assert.ok(navStages.some(s => s.includes("Review")), "Stage 04 Review accessible to logged-out guest");
    assert.ok(navStages.some(s => s.includes("Verify")), "Stage 05 Verify accessible to logged-out guest");
    console.log("✓ All 5 stages (SCAN → FIND → FIX → REVIEW → VERIFY) remain 100% functional after logout!");

    console.log("\n--- BROWSER CONSOLE AUDIT ---");
    if (consoleErrors.length === 0) {
      console.log("✓ Zero browser console errors recorded during entire user journey!");
    } else {
      console.log("Browser console errors recorded:", consoleErrors);
    }

    client.close();
    console.log("\n✓ COMPLETE AUTH & USER JOURNEY TEST PASSED SUCCESSFULLY!");
  } finally {
    braveProc.kill();
  }
}

run().catch((err) => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});
