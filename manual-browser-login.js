/**
 * One-time sign-in in a normal, human-controlled browser.
 *
 * Google blocks authentication in browsers controlled through automation. This
 * launcher deliberately does not use Playwright, remote debugging, stealth flags,
 * or password automation. It only selects the same persistent profile directory
 * that later scheduled runs reuse.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const TARGETS = {
  refresh: {
    profile: ".naukri-chrome-profile",
    url: "https://www.naukri.com/nlogin/login?URL=https://www.naukri.com/mnjuser/profile",
  },
  naukri: {
    profile: ".naukri-apply-profile",
    url: "https://www.naukri.com/nlogin/login",
  },
  wellfound: {
    profile: ".wellfound-chrome-profile",
    url: "https://wellfound.com/login",
  },
  indeed: {
    profile: ".indeed-chrome-profile",
    url: "https://in.indeed.com/account/login",
  },
};

function browserExecutable() {
  if (process.env.BROWSER_EXECUTABLE_PATH) return process.env.BROWSER_EXECUTABLE_PATH;
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (process.platform === "win32") {
    return path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe");
  }
  return "/usr/bin/google-chrome";
}

async function runManualBrowserLogin(targetName) {
  const target = TARGETS[targetName];
  if (!target) throw new Error(`Unknown login target: ${targetName}`);

  const executable = browserExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(`Normal browser executable not found: ${executable}`);
  }

  const profile = path.join(__dirname, target.profile);
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });

  // Chromium records the owning PID in a SingletonLock symlink on macOS/Linux.
  // Give a useful message instead of letting a second browser silently fail or
  // attach to the still-running Playwright instance.
  const singletonLock = path.join(profile, "SingletonLock");
  try {
    const lockTarget = fs.readlinkSync(singletonLock);
    const pid = Number(lockTarget.match(/-(\d+)$/)?.[1]);
    if (pid) {
      process.kill(pid, 0);
      throw new Error(
        `The ${targetName} profile is still open in Chrome (PID ${pid}). Quit that Chrome instance, then run the login command again.`,
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ESRCH" && !/invalid argument/i.test(error.message)) {
      throw error;
    }
  }

  console.log(`Opening normal Chrome for ${targetName} login.`);
  console.log("Sign in manually, verify the account page loads, then QUIT this isolated Chrome instance (Chrome > Quit Google Chrome). ");
  console.log("No password is read or stored by this project.");

  const args = [
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    target.url,
  ];
  const child = spawn(executable, args, {
    stdio: "ignore",
    env: process.env,
  });

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Chrome exited because of signal ${signal}`));
      else if (code && code !== 0) reject(new Error(`Chrome exited with code ${code}`));
      else resolve();
    });
  });
  console.log(`${targetName} browser closed; the local session profile is saved.`);
}

if (require.main === module) {
  runManualBrowserLogin(process.argv[2] || "refresh").catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runManualBrowserLogin };
