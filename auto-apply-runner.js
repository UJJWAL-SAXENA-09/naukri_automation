/**
 * Auto-Apply Runner — drives the existing console auto-apply scripts with Playwright,
 * so no more F12 + paste: it injects indeed-auto-apply.js / wellfound-auto-apply.js
 * into the page automatically on every load (that IS the "paste again" step).
 *
 * Usage:
 *   node auto-apply-runner.js indeed login      one-time: visible Chrome opens — log in manually, then close the window
 *   node auto-apply-runner.js indeed            dry run: fills everything, never submits
 *   node auto-apply-runner.js indeed --live     applies for real
 *   node auto-apply-runner.js wellfound [login|--live]
 *
 * Each run targets up to 10 applications, runs off-screen, and stops after the
 * target or 100 minutes. Daily state caps each site at 50 applications.
 */
const path = require('path');
const fs = require('fs');
const { browserLaunchOptions } = require('./browser-options');
const { restoreSessionSnapshot, saveSessionSnapshot } = require('./session-snapshot');
const { sessionLooksLoggedOut } = require('./session-auth');
const { runManualBrowserLogin } = require('./manual-browser-login');
const { CV, JOB_FILTERS, geminiKey, resumePath: RESUME_PATH } = require('./config'); // personal data from .env
const { minimizeBrowserWindows, hideBrowserWindows, SHOW_FLAG } = require('./window-utils');
const { applyExternal } = require('./external-apply'); // "Apply on company site" jobs, driven from Node
const { reconcileWellfoundCsv } = require('./application-log');
// stealth patches the fingerprint leaks reCAPTCHA uses to flag automation; falls back to plain playwright
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) {
  ({ chromium } = require('playwright-core'));
}

// Page reloads (naukri clicking "Next") race the stealth plugin's CDP session and throw
// async rejections outside any await — swallow them so a normal navigation can't kill the run.
process.on('unhandledRejection', (e) => console.log(`[${new Date().toLocaleString()}] unhandledRejection (ignored): ${String(e && e.message || e).split('\n')[0]}`));
process.on('uncaughtException', (e) => console.log(`[${new Date().toLocaleString()}] uncaughtException (ignored): ${String(e && e.message || e).split('\n')[0]}`));

const SITE_ARG = process.argv[2];
const LOGIN_MODE = process.argv.includes('login');
const LIVE = process.argv.includes('--live');
const requestedMaxArg = process.argv.find((arg) => /^--max-applications=\d+$/.test(arg));
const REQUESTED_MAX = requestedMaxArg ? Number(requestedMaxArg.split('=')[1]) : null;
// --scheduled marks a run started by a scheduler rather than by hand. Such runs wait
// a random 0-14 minutes before starting so applications do not always begin at the
// exact same second.
const SCHEDULED = process.argv.includes('--scheduled');
// Window handling: hidden by default (off screen and out of the taskbar, so a run is
// invisible), --minimize to keep it in the taskbar, --show to leave it on screen.
// `node show-windows.js` brings a hidden window back.
const SHOW_WINDOW = process.argv.includes('--show');
const MINIMIZE_ONLY = process.argv.includes('--minimize');

const SITES = {
  indeed: {
    script: 'indeed-auto-apply.js',
    profile: '.indeed-chrome-profile',
    // sort=date → newest first; fromage=14 → only jobs posted in the last 14 days; no location filter
    searches: [
      'https://in.indeed.com/jobs?q=full+stack+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=software+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=backend+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=ai+engineer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=gen+ai+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=react+developer&sort=date&fromage=14',
      'https://in.indeed.com/jobs?q=node+js+developer&sort=date&fromage=14',
    ],
    loginUrl: 'https://in.indeed.com/account/login',
    injectOn: (url) => /indeed\./.test(url),
    // count both real submits and dry-run "would submit" so pacing works in both modes
    submittedRe: /application submitted|would click: "Submit/i,
    storeKey: 'autoApply', // localStorage key the console script uses (seen jobs + submit count)
  },
  wellfound: {
    script: 'wellfound-auto-apply.js',
    profile: '.wellfound-chrome-profile',
    // /jobs alone dead-ends at 19 listings; the role pages carry the real inventory
    // (measured 2026-08-12). Same list the console script walks internally.
    searches: [
      'https://wellfound.com/jobs',
      'https://wellfound.com/role/l/software-engineer/india',
      'https://wellfound.com/role/r/software-engineer',
      'https://wellfound.com/role/r/backend-engineer',
      'https://wellfound.com/role/r/platform-engineer',
      'https://wellfound.com/role/r/devops-engineer',
      'https://wellfound.com/role/r/full-stack-engineer',
      'https://wellfound.com/role/r/frontend-engineer',
      'https://wellfound.com/role/r/mobile-engineer',
    ],
    loginUrl: 'https://wellfound.com/login',
    // Wellfound's own record of what was submitted. Checked after every live apply:
    // the in-page "Applied" stamp only reflects the DOM the apply flow just touched,
    // so it cannot tell a real submission from one that looked fine and never
    // registered. /jobs/applied redirects here.
    appliedListUrl: 'https://wellfound.com/jobs/applications',
    injectOn: (url) => /wellfound\.com/.test(url),
    submittedRe: /application sent|DRY_RUN — would click/i,
    // The wellfound script manages its own per-day seen-list under its own key
    // (wfAutoApplySeen), so the runner has no key to reset here.
    storeKey: null,
    dailyCap: 50,
    perRun: 10, // 10 per hourly run; the 50/day cap still decides when the day ends
  },
  naukri: {
    script: 'naukri-auto-apply.js',
    // ponytail: own profile (copy of the refresh's login) so the long apply run never
    // collides with the hourly refresh on .naukri-chrome-profile. Re-copy if it logs out.
    profile: '.naukri-apply-profile',
    searches: [
      'https://www.naukri.com/dot-net-developer-jobs?experience=1',
      'https://www.naukri.com/dot-net-core-developer-jobs?experience=1',
      'https://www.naukri.com/c-sharp-developer-jobs?experience=1',
      'https://www.naukri.com/backend-developer-jobs?experience=1',
      'https://www.naukri.com/software-engineer-jobs?experience=1',
      'https://www.naukri.com/microservices-developer-jobs?experience=1',
      'https://www.naukri.com/java-developer-jobs?experience=1',
      'https://www.naukri.com/devops-engineer-jobs?experience=1',
      'https://www.naukri.com/full-stack-developer-jobs?experience=1',
      'https://www.naukri.com/react-js-developer-jobs?experience=1',
      'https://www.naukri.com/node-js-developer-jobs?experience=1',
      'https://www.naukri.com/php-developer-jobs?experience=1',
      'https://www.naukri.com/ruby-developer-jobs?experience=1',
      'https://www.naukri.com/ios-developer-jobs?experience=1',
      'https://www.naukri.com/android-developer-jobs?experience=1',
      'https://www.naukri.com/flutter-developer-jobs?experience=1',
    ],
    loginUrl: 'https://www.naukri.com/nlogin/login',
    appliedListUrl: 'https://www.naukri.com/myapply/historypage',
    // inject only on search pages (…-jobs…), never into the job popup the script drives itself
    injectOn: (url) => /naukri\.com\/[^?]*-jobs/.test(url),
    submittedRe: /✅ applied|DRY_RUN — would click/,
    storeKey: 'autoApplyNaukri',
    dailyCap: 50,
    perRun: 10, // 10 per scheduled run; the 50/day cap still decides when the day ends
    // ~85-90% of Naukri dev listings are "Apply on company site" — follow them
    // onto the employer's own form instead of skipping them.
    externalApply: true,
  },
};

const site = SITES[SITE_ARG];
if (!site) {
  console.log('Usage: node auto-apply-runner.js <indeed|wellfound|naukri> [login|--live] [--show|--minimize] [--scheduled]');
  process.exit(1);
}

// Hard daily cap per site, tracked across runs in a state file — multiple logons in
// one day resume the count instead of restarting it, and stop dead at the cap.
const DAILY_CAP = site.dailyCap || 50;
const STATE_FILE = path.join(__dirname, `apply-state-${SITE_ARG}.json`);
const todayKey = new Date().toDateString();
let dayState = { date: todayKey, count: 0 };
try { const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8').replace(/^﻿/, '')); if (s.date === todayKey) dayState = s; } catch (e) {}
const bumpDayCount = () => { dayState.count++; try { fs.writeFileSync(STATE_FILE, JSON.stringify(dayState)); } catch (e) {} };
// per-run target (site.perRun) capped by whatever is left of the daily allowance
const TARGET = Math.min(REQUESTED_MAX || site.perRun || DAILY_CAP, DAILY_CAP - dayState.count);
const MAX_RUNTIME_MS = 100 * 60 * 1000;
const MAX_RESTARTS = 8; // browser gets closed and reopened this many times before giving up
const IDLE_ROTATE_MS = 4 * 60 * 1000;
const UNANSWERED_FILE = path.join(__dirname, 'unanswered-questions.log');
const unansweredSeen = new Set();

const log = (msg) => {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] [${SITE_ARG}] ${msg}`);
  if (/no verified answer stored|unmatched \(\d+\):/i.test(msg)) {
    const key = `${SITE_ARG}:${msg.replace(/\s+/g, ' ').trim()}`;
    if (!unansweredSeen.has(key)) {
      unansweredSeen.add(key);
      fs.appendFileSync(UNANSWERED_FILE, `[${timestamp}] [${SITE_ARG}] ${msg}\n`);
    }
  }
};

// ======== CSV log of every submitted application (created once, appended forever) ========
const CSV_FILE = path.join(__dirname, 'applications.csv');
const SKILLS = ['JavaScript', 'TypeScript', 'Python', 'Java', 'React', 'Next.js', 'React Native', 'Node.js',
  'Express', 'FastAPI', 'MongoDB', 'PostgreSQL', 'Redis', 'GraphQL', 'WebSockets', 'Docker', 'Kubernetes',
  'GCP', 'AWS', 'CI/CD', 'LangChain', 'LangGraph', 'RAG', 'LLM', 'GenAI', 'Machine Learning', 'MCP', 'Pinecone', 'FAISS'];
const matchSkills = (t) => { const l = t.toLowerCase(); return SKILLS.filter((s) => l.includes(s.toLowerCase())).join('; '); };
const csvRow = (vals) => vals.map((v) => '"' + String(v || '').replace(/"/g, '""').replace(/\s+/g, ' ').trim() + '"').join(',') + '\n';
function logApplication(job) {
  // one-time migration: archive a CSV written before the Job Link column existed
  // Also re-archive when the Verified column was added, so older rows (which carry
  // no verification status) are not silently read as unverified.
  if (fs.existsSync(CSV_FILE)) {
    const header = fs.readFileSync(CSV_FILE, 'utf8').split('\n')[0];
    if (!header.includes('Job Link') || !header.includes('Verified')) {
      fs.renameSync(CSV_FILE, path.join(__dirname, 'applications-old.csv'));
    }
  }
  if (!fs.existsSync(CSV_FILE)) {
    // ﻿ BOM so Excel renders ₹/– correctly
    fs.writeFileSync(CSV_FILE, '﻿' + csvRow(['Date', 'Site', 'Role', 'Company', 'CTC/Salary', 'Skills', 'Job Link', 'Verified', 'Job Description']));
  }
  fs.appendFileSync(CSV_FILE, csvRow([new Date().toLocaleString(), SITE_ARG, job.title, job.company, job.salary, job.skills, job.link, job.verified || 'n/a', job.jd]));
}

// Patch the console script: our DRY_RUN flag, our per-run target, and a busy-guard
// so a second injection while one is still running becomes a no-op.
// The job set lives HERE, in Node, not in the page: wellfound's role/job pages do not
// share localStorage with the /jobs feed across navigations (measured 2026-08-12 — the
// stored list kept resetting to 1), so the script re-opened the same job every cycle.
const seenJobs = new Set(); // /jobs/<id>-slug of every job already opened this run
function buildInjection(remainingApplications) {
  // Each injection gets only what is left in THIS runner invocation. Naukri also
  // keeps a cumulative browser counter, which must not turn a later scheduled run
  // into an immediate no-op once yesterday/earlier-today reached the same number.
  const remaining = Math.max(0, remainingApplications);
  const raw = fs
    .readFileSync(path.join(__dirname, site.script), 'utf8')
    .replace(/DRY_RUN: true/, `DRY_RUN: ${!LIVE}`)
    .replace(/MAX_APPLICATIONS: \d+/, `MAX_APPLICATIONS: ${remaining}`);
  // the console script reads its personal data from window.__APPLY_CONFIG (from .env),
  // so no PII lives in the injected script itself
  return `(async () => {
    if (window.__aaBusy) return; window.__aaBusy = true;
    window.__APPLY_CONFIG = ${JSON.stringify({ CV, JOB_FILTERS, geminiKey, seen: [...seenJobs] })};
    try { await ${raw}
    } finally { window.__aaBusy = false; }
  })()`;
}

(async () => {
  if (LOGIN_MODE) {
    await runManualBrowserLogin(SITE_ARG);
    return;
  }
  if (SCHEDULED && !LOGIN_MODE) {
    const jitterMs = Math.floor(Math.random() * 14 * 60 * 1000);
    log(`Scheduled run: waiting ${Math.round(jitterMs / 60000)} min before starting.`);
    await new Promise((r) => setTimeout(r, jitterMs));
  }
  if (!LOGIN_MODE && TARGET <= 0) {
    log(`Daily cap of ${DAILY_CAP} applications already reached (${dayState.count} today) — exiting.`);
    return;
  }
  const launch = () => chromium.launchPersistentContext(path.join(__dirname, site.profile), browserLaunchOptions({
    headless: false, // bot checks block headless; headed + minimised instead (same trick as naukri refresh)
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-backgrounding-occluded-windows', // keep timers full-speed while minimised
      '--disable-renderer-backgrounding',
      '--disable-popup-blocking', // naukri script opens each job in a popup it controls
      // A hidden run launches off-screen, because hiding can only happen once the
      // window exists — measured as a 1-3s flash of "about:blank - Google Chrome"
      // before the hide landed. --show and --minimize need a real on-screen origin
      // (Chrome otherwise reuses the old -32000 bounds saved in the profile).
      // show-windows.js moves a hidden window back into view before showing it.
      SHOW_WINDOW || MINIMIZE_ONLY || LOGIN_MODE
        ? '--window-position=0,0'
        : '--window-position=-32000,-32000',
    ],
  }));

  // The window used to be parked at -32000,-32000. That hid it, but its taskbar
  // button then "restored" it to coordinates no monitor covers, so the run could
  // never be watched. Minimise instead: same out-of-the-way behaviour, but one
  // click on the taskbar brings it up. Pass --show to leave it on screen.
  // Hiding once at launch was not enough: the naukri script opens a job popup per job,
  // external applies open their own tabs, and each new window appears on screen. Sweep
  // continuously instead, so a run genuinely stays out of sight.
  //
  // The sweep is paused while show-windows.js has set its flag, so bringing the browser
  // up to watch it does not turn into a fight with a timer.
  let sweepTimer = null;
  const tuckAway = async (ctx) => {
    if (LOGIN_MODE || SHOW_WINDOW) return;
    const stow = MINIMIZE_ONLY ? minimizeBrowserWindows : hideBrowserWindows;
    const dir = path.join(__dirname, site.profile);
    const sweep = async () => {
      if (fs.existsSync(SHOW_FLAG)) return; // user asked to see it
      await stow(dir).catch(() => {});
    };
    // Hide as soon as the native process exists, then sweep again after Chrome has
    // finished creating its first window. This minimizes focus theft on macOS.
    await new Promise((r) => setTimeout(r, 250));
    await sweep();
    await new Promise((r) => setTimeout(r, 750));
    await sweep();
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = setInterval(() => { sweep(); }, 2000);
    sweepTimer.unref?.();
    ctx.once('close', () => { if (sweepTimer) clearInterval(sweepTimer); });
  };

  log(`Starting. mode=${LIVE ? 'LIVE' : 'DRY RUN'} target=${TARGET} applications, max ${MAX_RUNTIME_MS / 60000} min`);
  const deadline = Date.now() + MAX_RUNTIME_MS;
  let submitted = 0;
  let lastActivity = Date.now();
  let searchIdx = 0;
  let pendingJob = null; // details of the job currently being applied to, for the CSV
  const externalQueue = [];              // "Apply on company site" jobs, handled in Node
  // Tabs opened purely to read the site's applied-list. They are on the same origin as
  // the feed, so without this the supervisor would inject the apply script into them.
  const VERIFY_PAGES = new Set();
  const externalSeen = new Set();
  const extStats = { applied: 0, skipped: 0, failed: 0 };
  const verificationTasks = new Set();
  let loginRequired = false;

  const isBusy = (p) => p.evaluate('!!window.__aaBusy').catch(() => false);

  /**
   * Look the job up in the site's own applied-list after submitting it.
   * Returns 'verified' | 'missing' | 'unknown' ('unknown' when the check itself could
   * not run, which must never be reported as a failed application).
   * Opens its own tab, registered in VERIFY_PAGES so the apply script is not injected
   * into it, and always closes it.
   */
  /**
   * Every /jobs/<id>-slug currently listed on the site's applied page.
   * Best-effort: an empty list simply means no seeding, never a failed run.
   */
  async function collectAppliedSlugs(context) {
    if (!site.appliedListUrl || !context) return [];
    let page;
    try {
      page = await context.newPage();
      VERIFY_PAGES.add(page);
      await page.goto(site.appliedListUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(
        () => /Ongoing|Archived|No applications/i.test(document.body.innerText),
        { timeout: 30000 }
      ).catch(() => {});
      await page.waitForTimeout(2500);
      // Applied rows link as /jobs/applications/<applicationId>-<jobId>; the job id is
      // the second number. An earlier version matched /jobs/<digits>, which never fires
      // on this page and silently seeded nothing.
      return await page.evaluate(() =>
        [...new Set([...document.querySelectorAll('a[href*="/jobs/applications/"]')]
          .map((a) => (a.getAttribute('href') || '').match(/\/jobs\/applications\/\d+-(\d+)/))
          .filter(Boolean).map((m) => '/jobs/' + m[1]))]
      );
    } catch (e) {
      log(`  (could not read applied list: ${String(e.message || e).split(String.fromCharCode(10))[0].slice(0, 80)})`);
      return [];
    } finally {
      if (page) { VERIFY_PAGES.delete(page); await page.close().catch(() => {}); }
    }
  }

  async function verifyInAppliedList(job, context) {
    if (!site.appliedListUrl || !job || !context) return 'unknown';
    let page;
    try {
      // The browser context is taken from the caller's page: `ctx` is created inside
      // session() and is not in scope here, which made every verification throw
      // "ctx is not defined" and report a real application as unverified.
      page = await context.newPage();
      VERIFY_PAGES.add(page);
      await page.goto(site.appliedListUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // the list is client-rendered; wait for a row to exist rather than a fixed sleep
      await page.waitForFunction(
        (siteName) => siteName === 'naukri'
          ? /Job application status|Total applies|Application sent/i.test(document.body.innerText)
          : /Ongoing|Archived|No applications/i.test(document.body.innerText),
        SITE_ARG,
        { timeout: 30000 }
      ).catch(() => {});
      await page.waitForTimeout(2500);
      if (SITE_ARG === 'naukri') {
        const id = ((job.link || '').match(/-(\d{6,})(?:[/?]|$)/) || [])[1] || '';
        const title = (job.title || '').trim();
        return await page.evaluate(([id, title]) => {
          const html = document.body.innerHTML;
          const text = document.body.innerText;
          if (!/Job application status|Total applies|Application sent/i.test(text)) return 'unknown';
          if (id && html.includes(id)) return 'verified';
          if (title.length > 3 && text.toLowerCase().includes(title.toLowerCase())) return 'verified';
          return id || title ? 'missing' : 'unknown';
        }, [id, title]);
      }
      const id = ((job.link || '').match(/\/jobs\/(\d+)/) || [])[1] || '';
      const company = (job.company || '').trim();
      // Wellfound's Applications list is eventually consistent. Live inspection
      // found all 19 submissions present even though checks made ~10 seconds after
      // Send said "missing". Poll the exact application-link job id for up to about
      // a minute before declaring a real miss.
      let lastResult = 'missing';
      for (const delay of [0, 15000, 45000]) {
        if (delay) {
          await page.waitForTimeout(delay);
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
          await page.waitForTimeout(2500);
        }
        const result = await page.evaluate(([id, company]) => {
          const text = document.body.innerText;
          if (!/Ongoing|Archived|No applications/i.test(text)) return 'unknown';
          const rows = [...document.querySelectorAll('a[href*="/jobs/applications/"]')];
          const ids = rows.map((a) => ((a.getAttribute('href') || '').match(/\/jobs\/applications\/\d+-(\d+)/) || [])[1]);
          if (id && ids.includes(id)) return 'verified';
          if (company.length > 2 && rows.some((a) => a.textContent.toLowerCase().includes(company.toLowerCase()))) return 'verified';
          if (!id && !company) return 'unknown';
          return 'missing';
        }, [id, company]);
        if (result === 'verified') return result;
        lastResult = result;
      }
      return lastResult;
    } catch (e) {
      // Say why. A bare "unavailable" gave no way to tell a slow page from a tab that
      // had been closed out from under the check.
      log(`  (verification error: ${String(e.message || e).split('\n')[0].slice(0, 90)})`);
      return 'unknown';
    } finally {
      if (page) { VERIFY_PAGES.delete(page); await page.close().catch(() => {}); }
    }
  }

  // Every full navigation wipes window.__aaBusy, so a page that keeps navigating
  // (role/* search pages navigate on every job click) used to get a fresh script
  // injected each time — four instances raced, and the human-pace delay vanished.
  // One injection per 20s per run is plenty; the script itself loops internally.
  let lastInject = 0;
  let readyForInjection = false;
  const inject = async (page) => {
    if (Date.now() - lastInject < 20000) return;
    lastInject = Date.now();
    await page.evaluate(buildInjection(TARGET - submitted)).catch(() => {}); // navigation mid-run is normal
  };

  const resetDailyPageState = async (page) => {
    if (!site.storeKey) return;
    await page.evaluate(([key, today]) => {
      try {
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        if (s.day !== today) {
          s.day = today; s.submitted = 0; s.applied = 0;
          s.seen = (s.seen || []).slice(-2000);
          s.seenDry = (s.seenDry || []).slice(-2000);
          localStorage.setItem(key, JSON.stringify(s));
        }
      } catch (e) {}
    }, [site.storeKey, new Date().toDateString()]).catch(() => {});
  };

  function wire(page) {
    page.on('console', (msg) => {
      const text = msg.text();
      if (!/auto-apply/.test(text)) return;
      lastActivity = Date.now();
      const clean = text.replace(/%c\[auto-apply\]\s*\S*/, '').trim();
      log('  ' + clean.slice(0, 160));

      // snapshot the wizard whenever it can't proceed, so the blocking field is visible
      if (/no Continue\/Submit button found|no Send button found/.test(clean)) {
        page.screenshot({ path: path.join(__dirname, `blocked-step-${SITE_ARG}.png`) }).catch(() => {});
      }

      // "▶ Applying: <title> @ <company>" (wellfound) / "▶ Opening: <title>" (indeed)
      const m = clean.match(/▶ (?:Applying|Opening)[^:]*: (.+)/);
      if (m) {
        const [main, link, cardSalary] = m[1].split(' | ');
        const atParts = main.split(' @ ');
        const company = atParts.length > 1 ? atParts.pop() : ''; // company is after the LAST ' @ ' — titles may contain '@'
        const title = atParts.join(' @ ');
        // Key on the numeric job id alone. Keying on the full slug meant an id seeded
        // from the applied list (/jobs/4662968) never matched a feed link
        // (/jobs/4662968-software-engineer), so seeding had no effect.
        const idm = (link || main).match(/\/jobs\/(\d+)/);
        const slug = idm ? '/jobs/' + idm[1] : undefined;
        if (slug) seenJobs.add(slug); // page storage is wiped across navigations; Node keeps it
        pendingJob = { title: title.trim(), company: (company || '').replace(/^\?$/, '').trim(), link: (link || '').trim(), salary: (cardSalary || '').trim(), skills: '', jd: '' };
        // scrape details once the job pane/description has rendered
        setTimeout(() => {
          page.evaluate(() => {
            const q = (s) => document.querySelector(s)?.textContent?.trim() || '';
            return {
              company: (document.body.innerText.match(/Apply to (.{2,60})/) || [])[1]?.trim() ||
                q('[data-testid="inlineHeader-companyName"]') || q('[data-company-name]') || q('a[href^="/company/"]'),
              salary: q('#salaryInfoAndJobType') || q('[data-testid*="salary" i]') ||
                (document.body.innerText.match(/(?:₹|\$)\s?[\d,.]+(?:\s?-\s?(?:₹|\$)?[\d,.]+)?[^\n]{0,30}/) || [''])[0],
              jd: (q('#jobDescriptionText') || q('[class*="jobDescription" i]') || q('[class*="description" i]')).slice(0, 1200),
            };
          }).then((d) => {
            if (!d || !pendingJob) return;
            pendingJob.company = pendingJob.company || d.company;
            pendingJob.salary = pendingJob.salary || d.salary;
            pendingJob.jd = d.jd;
            pendingJob.skills = matchSkills(pendingJob.title + ' ' + d.jd);
          }).catch(() => {});
        }, SITE_ARG === 'indeed' ? 6000 : 2000); // indeed pane loads slower; wellfound modal closes fast
      }

      // "🔗 EXTERNAL | <title> | <href>" — the console script can't cross origins,
      // so queue it and let applyExternal() drive the company site from Node.
      const ext = clean.match(/🔗 EXTERNAL \| (.+) \| (\S+)/);
      if (ext && !externalSeen.has(ext[2])) {
        externalSeen.add(ext[2]);
        externalQueue.push({ title: ext[1].trim(), href: ext[2].trim() });
      }

      if (site.submittedRe.test(text)) {
        submitted++;
        log(`==> ${submitted}/${TARGET} this run (${dayState.count + (LIVE ? 1 : 0)}/${DAILY_CAP} today)`);
        if (LIVE) { // dry runs don't pollute the CSV or the daily count
          bumpDayCount();
          const job = pendingJob || { title: 'unknown' };
          // Verify against the site's own applied-list before writing the CSV row, so
          // the CSV records what actually registered rather than what we hoped did.
          const task = verifyInAppliedList(job, page.context()).then((v) => {
            job.verified = v;
            if (v === 'verified') log(`  ✔ verified — job is in ${SITE_ARG}'s applied list`);
            else if (v === 'missing') log(`  ❌ NOT in ${SITE_ARG}'s applied list — the submission did not register`);
            else log('  ? verification unavailable — CSV row marked unverified');
            try { logApplication(job); } catch (e) { log('CSV write failed: ' + e.message); }
          }).finally(() => verificationTasks.delete(task));
          verificationTasks.add(task);
        }
        pendingJob = null;
      }
    });
    page.on('load', async () => {
      if (VERIFY_PAGES.has(page)) return; // verification tab: same origin, must stay untouched
      if (!site.injectOn(page.url())) return;
      if (!readyForInjection) return; // seed applied jobs before the first scan starts
      lastActivity = Date.now();
      // daily reset of the console script's submit counter (persists in localStorage)
      await resetDailyPageState(page);
      await inject(page);
    });
  }

  // One browser session. Returns as soon as it stops making progress (searches
  // exhausted, page wedged, crash) — the caller then closes and reopens the browser.
  async function session() {
  const ctx = await launch();
  let sessionAuthenticated = false;
  if (process.env.BROWSER_SESSION_SNAPSHOT === '1' && (SITE_ARG === 'naukri' || SITE_ARG === 'wellfound')) {
    await restoreSessionSnapshot(ctx, SITE_ARG);
  }
  await tuckAway(ctx);

  // Current Naukri pages can ignore synthetic DOM clicks. Expose one narrowly
  // scoped trusted-input operation to the injected script; success is still
  // verified separately before an application is counted or logged.
  if (SITE_ARG === 'naukri') {
    await ctx.exposeBinding('__nodeClickApply', async ({ page: sourcePage }, jobUrl) => {
      try {
        const normalized = String(jobUrl || '').split('?')[0].replace(/\/$/, '');
        const jobId = ((normalized.match(/-(\d{6,})(?:\/|$)/) || [])[1] || '');
        const popup = ctx.pages().find((p) => {
          if (p === sourcePage) return false;
          const current = p.url().split('?')[0].replace(/\/$/, '');
          return current === normalized || (jobId && current.includes(jobId));
        });
        if (!popup) return false;
        await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        const buttons = popup.locator('button, [role="button"], #apply-button');
        const count = await buttons.count();
        for (let i = 0; i < count; i++) {
          const button = buttons.nth(i);
          const text = (await button.innerText().catch(() => '')).trim();
          if (/^apply$/i.test(text) && await button.isVisible().catch(() => false)) {
            await button.click({ timeout: 10000 });
            return true;
          }
        }
        return false;
      } catch (e) {
        log(`  trusted Apply click error: ${String(e.message || e).split('\n')[0].slice(0, 100)}`);
        return false;
      }
    });
  }

  const mainPage = ctx.pages()[0] || (await ctx.newPage());
  searchIdx = 0;
  lastActivity = Date.now();
  let fruitless = 0;            // consecutive script cycles that applied to nothing
  let submittedAtCycle = submitted;
  try {
  ctx.pages().forEach(wire);
  ctx.on('page', wire);

  await mainPage.goto(site.searches[0], { waitUntil: 'domcontentloaded', timeout: 60000 });
  // not logged in? every flow needs a session — bail with a clear message
  await mainPage.waitForTimeout(8000);
  const bodyText = await mainPage.evaluate('document.body.innerText.slice(0, 3000)').catch(() => '');
  if (sessionLooksLoggedOut(SITE_ARG, { url: mainPage.url(), text: bodyText })) {
    loginRequired = true;
    log(`ERROR: ${SITE_ARG} session is logged out. Run: node auto-apply-runner.js ${SITE_ARG} login`);
    return;
  }
  if (/verify you are human/i.test(bodyText)) {
    log(`ERROR: ${SITE_ARG} is showing a human-verification check; use the login command to solve it once.`);
    return;
  }
  sessionAuthenticated = true;

  // Seed Wellfound's seen-list only after proving the session is authenticated.
  // Otherwise /jobs/applications redirects to a public page and a logged-out run
  // wastes all browser restarts browsing jobs it cannot submit.
  if (SITE_ARG === 'wellfound' && site.appliedListUrl && !LOGIN_MODE) {
    const before = seenJobs.size;
    const found = await collectAppliedSlugs(ctx);
    for (const slug of found) seenJobs.add(slug);
    if (seenJobs.size > before) log(`Seeded ${seenJobs.size - before} already-applied jobs from ${site.appliedListUrl}`);
    const corrected = reconcileWellfoundCsv(CSV_FILE, found);
    if (corrected) log(`Reconciled ${corrected} earlier CSV rows against Wellfound's live Applied list.`);
  }
  readyForInjection = true;
  await resetDailyPageState(mainPage);
  await inject(mainPage);

  // Supervisor: re-inject the search tab when idle, close finished form tabs,
  // rotate searches on inactivity, stop on target/time.
  while (submitted < TARGET && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 45000));

    const pages = ctx.pages();
    let anyBusy = false;
    for (const p of pages) {
      // A verification tab is same-origin with the feed, so both close-rules below
      // match it. Closing it mid-check made verifyInAppliedList() throw and report
      // "verification unavailable" for an application that had in fact registered.
      if (VERIFY_PAGES.has(p)) continue;
      if (await isBusy(p)) anyBusy = true;
      // finished smartapply/form tabs: close them so tabs don't pile up
      if (p !== mainPage && /smartapply|\/apply/.test(p.url()) && !(await isBusy(p))) {
        await p.close().catch(() => {});
      }
      // live mode: after submit the form tab returns to search — close that duplicate search tab
      if (p !== mainPage && site.injectOn(p.url()) && !/smartapply|\/apply/.test(p.url()) && !(await isBusy(p))) {
        await p.close().catch(() => {});
      }
    }

    // Work the external queue whenever the in-page script is idle, so the two
    // never drive the browser at the same time.
    while (site.externalApply && !anyBusy && externalQueue.length && submitted < TARGET && Date.now() < deadline) {
      const job = externalQueue.shift();
      log(`🔗 external: ${job.title}`);
      const res = await applyExternal(ctx, job, { CV, live: LIVE, resumePath: RESUME_PATH, log });
      lastActivity = Date.now();
      log(`   ${res.status}: ${res.detail}`);
      if (res.status === 'applied' || res.status === 'would-apply') {
        extStats.applied++;
        submitted++;
        log(`==> ${submitted}/${TARGET} this run (${dayState.count + (LIVE ? 1 : 0)}/${DAILY_CAP} today)`);
        if (LIVE) {
          bumpDayCount();
          try { logApplication({ title: job.title, company: '', salary: '', skills: matchSkills(job.title), link: job.href, jd: 'external (company site)' }); }
          catch (e) { log('CSV write failed: ' + e.message); }
        }
      } else extStats[res.status === 'skipped' ? 'skipped' : 'failed']++;
      await new Promise((r) => setTimeout(r, 20000 + Math.random() * 25000)); // human-ish gap
    }

    if (!anyBusy) {
      if (Date.now() - lastActivity > IDLE_ROTATE_MS) {
        searchIdx++;
        if (searchIdx >= site.searches.length) { log('All searches exhausted for today.'); break; }
        log(`Rotating to next search: ${site.searches[searchIdx]}`);
        await mainPage.goto(site.searches[searchIdx], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      } else {
        // Re-injecting forever in a wedged browser looks like progress but isn't:
        // a bot-check, a dead SPA or a stale session produce the same "script ran,
        // applied nothing" cycle every time. After 3 fruitless cycles, hand back to
        // the caller so the browser is closed and reopened fresh.
        if (submitted === submittedAtCycle) {
          if (++fruitless >= 3) {
            log('No applications in 3 script cycles — closing the browser and reopening.');
            return;
          }
        } else { fruitless = 0; submittedAtCycle = submitted; }
        await inject(mainPage); // continue with next job on this page
      }
    }
  }
  } finally {
    // The final submission can reach the target while its eventually-consistent
    // applied-list check is still polling. Do not close that verification tab early.
    if (verificationTasks.size) await Promise.allSettled([...verificationTasks]);
    if (sessionAuthenticated && process.env.BROWSER_SESSION_SNAPSHOT === '1' && (SITE_ARG === 'naukri' || SITE_ARG === 'wellfound')) {
      await saveSessionSnapshot(ctx, SITE_ARG).catch(() => {});
    }
    await ctx.close().catch(() => {});
  }
  }

  // Close-and-reopen loop: a session that ends early (feed exhausted, tab wedged,
  // browser crash) costs a fresh browser, not the run. `submitted` and `deadline`
  // live outside, so restarts resume toward the same 30 rather than starting over.
  for (let attempt = 1; submitted < TARGET && Date.now() < deadline; attempt++) {
    if (attempt > 1) log(`↻ Reopening browser (attempt ${attempt}/${MAX_RESTARTS}) — ${submitted}/${TARGET} done so far`);
    try {
      await session();
      if (loginRequired) break;
    } catch (e) {
      const msg = String(e && e.message || e).split('\n')[0];
      log('session ended with an error: ' + msg);
      // A previous Chrome still holding the profile is a wait-it-out problem, not a
      // dead run — don't spend one of the 8 restarts (and 8 of them burned in 2 min).
      if (/already in use|Opening in existing browser/i.test(msg)) {
        attempt--;
        log('profile still locked by another Chrome — waiting 30s');
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
    }
    if (submitted >= TARGET || Date.now() >= deadline) break;
    if (attempt >= MAX_RESTARTS) { log(`Stopping after ${MAX_RESTARTS} browser restarts — no more jobs to apply to.`); break; }
    await new Promise((r) => setTimeout(r, 15000)); // let the profile lock clear before relaunching
  }

  log(`Finished: ${submitted}/${TARGET} applications ${LIVE ? 'submitted' : 'simulated (dry run)'}.`);
  if (site.externalApply) {
    log(`External (company site): ${extStats.applied} applied, ${extStats.skipped} skipped (account required / not a form), ` +
        `${extStats.failed} failed, ${externalQueue.length} left in queue.`);
  }
})().catch((e) => { log('FATAL: ' + e.message.split('\n')[0]); process.exit(1); });
