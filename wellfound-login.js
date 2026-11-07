/**
 * One-time manual Wellfound sign-in.
 *
 * The generic `auto-apply-runner.js wellfound login` opens a window and waits for a
 * human to log in by hand. This helper does the same while keeping the browser
 * profile open for up to five minutes. It never reads or enters credentials.
 *
 *   node wellfound-login.js          visible window, signs in, saves the session
 *   node wellfound-login.js --check  no sign-in — just report whether we're logged in
 *
 * The window is left visible on purpose: Google may ask for a 2-step prompt or a
 * captcha, and those need you. If it stops on one, just finish it by hand — the
 * session is saved to .wellfound-chrome-profile either way.
 */
const { chromium } = require("playwright-core");
const path = require("path");
const { browserLaunchOptions } = require("./browser-options");

const PROFILE_DIR = path.join(__dirname, ".wellfound-chrome-profile");
const CHECK_ONLY = process.argv.includes("--check");

const log = (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

/** Logged-in Wellfound shows an avatar / dashboard nav; logged-out shows Log In. */
async function isLoggedIn(page) {
  return page.evaluate(() => {
    const t = document.body.innerText;
    const hasLogin =
      /\bLog In\b|\bSign in\b/i.test(t) &&
      /wellfound/i.test(document.title || "");
    const hasAccount = !!document.querySelector(
      'img[alt*="avatar" i], [data-test*="Avatar" i], a[href*="/jobs"], nav a[href*="/profile"]',
    );
    return { hasLogin, hasAccount, title: document.title, url: location.href };
  });
}

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, browserLaunchOptions({
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--window-position=0,0",
    ],
  }));
  const page = ctx.pages()[0] || (await ctx.newPage());

  try {
    await page.goto("https://wellfound.com/jobs", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(5000);
    let state = await isLoggedIn(page);
    if (state.hasAccount && !state.hasLogin) {
      log(`Already logged in — ${state.url}`);
      await ctx.close();
      return;
    }
    if (CHECK_ONLY) {
      log(`NOT logged in (title="${state.title}", url=${state.url})`);
      await ctx.close();
      process.exit(1);
    }

    log("Not logged in — sign in manually in the visible browser. No password is stored or entered by this project.");
    await page.goto("https://wellfound.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    // Wait for a user-completed login. The identity provider may open a popup,
    // so inspect every page in the local persistent browser context.
    let ok = false;
    for (let i = 0; i < 150 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      for (const p of ctx.pages()) {
        if (!/wellfound\.com/.test(p.url())) continue;
        const s = await isLoggedIn(p).catch(() => null);
        if (s && s.hasAccount && !s.hasLogin) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) {
      throw new Error(
        "Google step did not complete — likely a 2-step prompt or captcha. " +
          "The window is still open: finish the login by hand, then close it.",
      );
    }
    log("Wellfound login OK — session saved to .wellfound-chrome-profile");
    await ctx.close();
  } catch (err) {
    log("FAILED: " + String(err.message || err).split("\n")[0]);
    log(
      "Leaving the window open for 3 minutes so you can finish the login manually.",
    );
    await page.waitForTimeout(180000).catch(() => {});
    await ctx.close().catch(() => {});
    process.exit(1);
  }
})();
