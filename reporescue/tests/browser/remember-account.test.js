import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const BRAVE_BIN = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const DEBUG_PORT = 9223;

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

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function runBrowserTest() {
  const browserProc = spawn(BRAVE_BIN, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--headless=new",
    "--disable-gpu",
    "--force-prefers-reduced-motion",
    "--no-sandbox",
    "about:blank",
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
        const targets = await res.json();
        if (targets.length > 0 && targets[0].webSocketDebuggerUrl) {
          wsUrl = targets[0].webSocketDebuggerUrl;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (!wsUrl) throw new Error("Could not connect to browser CDP port");

    const client = new CDPClient(wsUrl);
    await client.connect();

    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");

    // 1. Navigate to /login
    await client.send("Page.navigate", { url: "http://localhost:5173/login" });
    await new Promise((r) => setTimeout(r, 1000));

    // 2. Check checkbox properties
    const checkboxInitialState = await client.eval(`
      (() => {
        const cb = document.getElementById("remember-account-checkbox");
        if (!cb) return { found: false };
        const label = cb.closest("label");
        return {
          found: true,
          checked: cb.checked,
          labelHtml: label ? label.innerText : "",
          disabled: cb.disabled
        };
      })()
    `);

    assert.equal(checkboxInitialState.found, true, "Checkbox must exist on page");
    assert.equal(checkboxInitialState.checked, false, "Checkbox default state must be unchecked");
    assert.ok(checkboxInitialState.labelHtml.includes("Remember this account"));
    assert.ok(checkboxInitialState.labelHtml.includes("Keep me signed in on this device."));

    // 3. Click the checkbox to toggle it
    await client.eval(`
      (() => {
        const cb = document.getElementById("remember-account-checkbox");
        cb.click();
      })()
    `);

    const checkboxCheckedState = await client.eval(`
      (() => {
        const cb = document.getElementById("remember-account-checkbox");
        return cb.checked;
      })()
    `);
    assert.equal(checkboxCheckedState, true, "Checkbox must be checked after click");

    // 4. Test authenticated persistent view
    // Log in via dev-login with remember: true
    const devLoginRes = await fetch("http://127.0.0.1:3001/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: "browserdev", remember: true }),
    });
    const setCookie = devLoginRes.headers.get("set-cookie");
    const cookieVal = /reporescue_session=([^;]+)/.exec(setCookie)[1];

    // Set cookie in browser
    await client.send("Network.setCookie", {
      name: "reporescue_session",
      value: cookieVal,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    });

    // Reload login page with authenticated cookie
    await client.send("Page.navigate", { url: "http://localhost:5173/login" });
    await new Promise((r) => setTimeout(r, 1000));

    const authState = await client.eval(`
      (() => {
        const text = document.body.innerText;
        return {
          hasUser: text.includes("@browserdev"),
          hasPersistentText: text.includes("Kept signed in on this device"),
          hasSignOut: text.includes("Sign out")
        };
      })()
    `);

    assert.equal(authState.hasUser, true, "Should display logged-in username");
    assert.equal(authState.hasPersistentText, true, "Should display Kept signed in on this device");
    assert.equal(authState.hasSignOut, true, "Should display Sign out button");

    // Click Sign out
    await client.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const signOutBtn = buttons.find(b => b.innerText.includes("Sign out"));
        if (signOutBtn) signOutBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));

    // Verify back to unauthenticated state with unchecked checkbox
    const postSignOutState = await client.eval(`
      (() => {
        const cb = document.getElementById("remember-account-checkbox");
        return {
          loggedOut: !document.body.innerText.includes("@browserdev"),
          checkboxPresent: Boolean(cb),
          checkboxChecked: cb ? cb.checked : null
        };
      })()
    `);

    assert.equal(postSignOutState.loggedOut, true, "Should be logged out");
    assert.equal(postSignOutState.checkboxPresent, true, "Checkbox should be present again");
    assert.equal(postSignOutState.checkboxChecked, false, "Checkbox should be unchecked by default");

    console.log("✔ Browser CDP tests passed: checkbox rendering, interaction, persistence state display, and logout");
    client.close();
  } finally {
    browserProc.kill("SIGKILL");
  }
}

runBrowserTest().catch((err) => {
  console.error("Browser test failed:", err);
  process.exit(1);
});
