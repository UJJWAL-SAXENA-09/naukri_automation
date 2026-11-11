#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const action = process.argv[2] || "status";
const repo = path.resolve(__dirname, "..");
const wrapper = path.join(repo, "deploy", "run-macos-job.sh");
const launchAgents = path.join(os.homedir(), "Library", "LaunchAgents");
const logs = path.join(repo, "runtime", "logs");
const domain = `gui/${process.getuid()}`;

const jobs = [
  {
    name: "refresh",
    label: "com.ujjwal.naukri-profile-refresh",
    schedule: [{ Minute: 5 }],
  },
  {
    name: "naukri",
    label: "com.ujjwal.naukri-auto-apply",
    schedule: [{ Hour: 9, Minute: 20 }, { Hour: 15, Minute: 20 }],
  },
  {
    name: "wellfound",
    label: "com.ujjwal.wellfound-auto-apply",
    schedule: [{ Hour: 12, Minute: 30 }],
  },
];

const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

function scheduleXml(schedule) {
  const dict = (entry) => `
      <dict>${Object.entries(entry).map(([key, value]) => `
        <key>${key}</key><integer>${value}</integer>`).join("")}
      </dict>`;
  return schedule.length === 1 ? dict(schedule[0]) : `
      <array>${schedule.map(dict).join("")}
      </array>`;
}

function plist(job) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${job.label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${esc(wrapper)}</string>
      <string>${job.name}</string>
    </array>
    <key>WorkingDirectory</key><string>${esc(repo)}</string>
    <key>StartCalendarInterval</key>${scheduleXml(job.schedule)}
    <key>ProcessType</key><string>Background</string>
    <key>LimitLoadToSessionType</key><string>Aqua</string>
    <key>StandardOutPath</key><string>${esc(path.join(logs, `${job.name}.log`))}</string>
    <key>StandardErrorPath</key><string>${esc(path.join(logs, `${job.name}.error.log`))}</string>
  </dict>
</plist>
`;
}

function launchctl(args, quiet = false) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8" });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (!quiet && result.stderr) process.stderr.write(result.stderr);
  return result;
}

function plistPath(job) {
  return path.join(launchAgents, `${job.label}.plist`);
}

if (action === "install") {
  fs.mkdirSync(launchAgents, { recursive: true });
  fs.mkdirSync(logs, { recursive: true });
  fs.chmodSync(wrapper, 0o755);
  for (const job of jobs) {
    const file = plistPath(job);
    launchctl(["bootout", domain, file], true);
    fs.writeFileSync(file, plist(job), { mode: 0o600 });
    const check = spawnSync("/usr/bin/plutil", ["-lint", file], { encoding: "utf8" });
    if (check.status !== 0) throw new Error(check.stderr || check.stdout);
    const loaded = launchctl(["bootstrap", domain, file]);
    if (loaded.status !== 0) process.exit(loaded.status || 1);
    console.log(`installed ${job.label}`);
  }
  console.log("Schedules installed. Auto-apply remains dry-run while AUTO_APPLY_LIVE=0.");
} else if (action === "remove") {
  for (const job of jobs) {
    const file = plistPath(job);
    launchctl(["bootout", domain, file], true);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    console.log(`removed ${job.label}`);
  }
} else if (action === "status") {
  for (const job of jobs) {
    const result = launchctl(["print", `${domain}/${job.label}`], true);
    console.log(`${job.label}: ${result.status === 0 ? "loaded" : "not loaded"}`);
  }
} else {
  console.error("Usage: node deploy/setup-macos-schedule.js <install|status|remove>");
  process.exit(2);
}
