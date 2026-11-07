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
  return {
    ...options,
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    args: [...(options.args || []), ...containerArgs],
  };
}

module.exports = { browserLaunchOptions };
