/**
 * Chrome is used on a developer workstation; the Docker deployment uses the
 * distribution's Chromium binary. Keeping that choice in one place avoids
 * hard-coding a host-specific browser path in the automation scripts.
 */
function browserLaunchOptions(options = {}) {
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH;
  const containerArgs = process.env.CONTAINERIZED_BROWSER === "1"
    ? ["--disable-dev-shm-usage"]
    : [];
  // A one-time login is performed in normal Chrome. On macOS those cookies are
  // encrypted with the user's real Keychain. Playwright normally adds mock/basic
  // password-store flags, which makes the same persistent profile appear logged out.
  // A LaunchAgent has no Terminal app identity and cannot read Chrome's login
  // keychain. Scheduled runs use an owner-only session snapshot instead and keep
  // Playwright's mock/basic password store enabled.
  const keychainArgs = process.platform === "darwin" && process.env.BROWSER_SESSION_SNAPSHOT !== "1"
    ? { ignoreDefaultArgs: ["--use-mock-keychain", "--password-store=basic"] }
    : {};
  return {
    ...options,
    ...keychainArgs,
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    args: [...(options.args || []), ...containerArgs],
  };
}

module.exports = { browserLaunchOptions };
