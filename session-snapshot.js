const fs = require('fs');
const path = require('path');

const privateDir = path.join(__dirname, 'private');
const snapshotFiles = {
  refresh: path.join(privateDir, 'naukri-refresh-session.json'),
  naukri: path.join(privateDir, 'naukri-apply-session.json'),
  wellfound: path.join(privateDir, 'wellfound-session.json'),
};

function snapshotPath(name) {
  const file = snapshotFiles[name];
  if (!file) throw new Error(`No session snapshot is configured for ${name}`);
  return file;
}

function writePrivateJson(file, value) {
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDir, 0o700);
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}

async function restoreSessionSnapshot(context, name) {
  const file = snapshotPath(name);
  if (!fs.existsSync(file)) return 0;
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cookies = Array.isArray(state.cookies) ? state.cookies : [];
  if (cookies.length) await context.addCookies(cookies);

  const origins = Array.isArray(state.origins) ? state.origins : [];
  if (origins.length) {
    await context.addInitScript(({ savedOrigins }) => {
      const saved = savedOrigins.find((entry) => entry.origin === location.origin);
      if (!saved) return;
      for (const item of saved.localStorage || []) localStorage.setItem(item.name, item.value);
    }, { savedOrigins: origins });
  }
  return cookies.length;
}

async function saveSessionSnapshot(context, name) {
  const state = await context.storageState();
  if (!state.cookies?.length) return 0;
  writePrivateJson(snapshotPath(name), state);
  return state.cookies.length;
}

module.exports = {
  restoreSessionSnapshot,
  saveSessionSnapshot,
  snapshotPath,
};
