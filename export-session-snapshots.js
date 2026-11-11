#!/usr/bin/env node

/**
 * Export already-authenticated Chrome sessions into owner-only local snapshots.
 * macOS LaunchAgents cannot access Chrome's login-keychain encryption, so scheduled
 * processes restore these snapshots through Playwright instead. No password is read.
 */
const path = require('path');
const { chromium } = require('playwright-core');
const { browserLaunchOptions } = require('./browser-options');
const { saveSessionSnapshot, snapshotPath } = require('./session-snapshot');
const { sessionLooksAuthenticated } = require('./session-auth');

const targets = [
  {
    name: 'refresh',
    // The apply profile is the confirmed authenticated Naukri session. Reuse its
    // cookies for refresh as both jobs operate on the same account; the refresh
    // still keeps its own browser profile and its own private snapshot file.
    profile: '.naukri-apply-profile',
    url: 'https://www.naukri.com/mnjuser/profile',
  },
  {
    name: 'naukri',
    profile: '.naukri-apply-profile',
    url: 'https://www.naukri.com/mnjuser/profile',
  },
  {
    name: 'wellfound',
    profile: '.wellfound-chrome-profile',
    url: 'https://wellfound.com/jobs',
  },
];
const requestedTargets = process.argv.slice(2);
const selectedTargets = requestedTargets.length
  ? targets.filter((target) => requestedTargets.includes(target.name))
  : targets;
if (requestedTargets.length && selectedTargets.length !== new Set(requestedTargets).size) {
  console.error('Usage: node export-session-snapshots.js [refresh|naukri|wellfound ...]');
  process.exit(2);
}

(async () => {
  for (const target of selectedTargets) {
    const context = await chromium.launchPersistentContext(
      path.join(__dirname, target.profile),
      browserLaunchOptions({
        headless: false,
        viewport: { width: 1200, height: 800 },
        args: ['--disable-blink-features=AutomationControlled', '--window-position=-32000,-32000'],
      }),
    );
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(9000);
      const text = await page.locator('body').innerText().catch(() => '');
      if (!sessionLooksAuthenticated(target.name, { url: page.url(), text })) {
        throw new Error(`${target.name} session looks logged out; run its manual login command first`);
      }
      const count = await saveSessionSnapshot(context, target.name);
      console.log(`${target.name}: exported ${count} cookies to ${snapshotPath(target.name)}`);
    } finally {
      await context.close().catch(() => {});
    }
  }
})().catch((error) => {
  console.error(`Session export failed: ${error.message}`);
  process.exitCode = 1;
});
