#!/usr/bin/env node

/**
 * Run every configured job-site auto-applier sequentially.
 *
 * Live/dry-run mode comes from the git-ignored .env file. Command-line flags
 * override it so a one-off dry run never requires editing private config:
 *
 *   npm run apply:all
 *   npm run apply:all -- --dry-run --show
 *   npm run apply:all -- --live --max-applications=5
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoDir = __dirname;
const envFile = path.join(repoDir, '.env');
const sites = ['naukri', 'wellfound'];
const inputArgs = process.argv.slice(2);

function localEnvValue(name) {
  if (!fs.existsSync(envFile)) return '';
  const line = fs.readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((entry) => new RegExp(`^\\s*${name}\\s*=`).test(entry));
  if (!line) return '';
  return line.slice(line.indexOf('=') + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
}

const forceLive = inputArgs.includes('--live');
const forceDryRun = inputArgs.includes('--dry-run');
if (forceLive && forceDryRun) {
  console.error('Choose either --live or --dry-run, not both.');
  process.exit(2);
}

const live = forceLive || (!forceDryRun && localEnvValue('AUTO_APPLY_LIVE') === '1');
const forwardedArgs = inputArgs.filter((arg) => arg !== '--live' && arg !== '--dry-run');
let activeChild;

function stopActiveChild(signal) {
  if (activeChild && !activeChild.killed) activeChild.kill(signal);
}

process.on('SIGINT', () => stopActiveChild('SIGINT'));
process.on('SIGTERM', () => stopActiveChild('SIGTERM'));

function runSite(site) {
  return new Promise((resolve) => {
    const args = [path.join(repoDir, 'auto-apply-runner.js'), site];
    if (live) args.push('--live');
    args.push(...forwardedArgs);

    console.log(`\n=== ${site.toUpperCase()} — ${live ? 'LIVE APPLICATIONS' : 'DRY RUN'} ===`);
    activeChild = spawn(process.execPath, args, {
      cwd: repoDir,
      stdio: 'inherit',
      env: process.env,
    });
    activeChild.on('error', (error) => {
      console.error(`[${site}] could not start: ${error.message}`);
      resolve(1);
    });
    activeChild.on('exit', (code, signal) => {
      activeChild = null;
      if (signal) console.error(`[${site}] stopped by ${signal}.`);
      resolve(code == null ? 1 : code);
    });
  });
}

(async () => {
  console.log(`Running Naukri and Wellfound sequentially in ${live ? 'LIVE' : 'DRY-RUN'} mode.`);
  console.log(`Confirmed applications are appended locally to ${path.join(repoDir, 'applications.csv')}.`);

  let failed = false;
  for (const site of sites) {
    const code = await runSite(site);
    if (code !== 0) {
      failed = true;
      console.error(`[${site}] finished with exit code ${code}; continuing to the next site.`);
    }
  }

  console.log('\nAll site runners finished. Review applications.csv for confirmed applications.');
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
