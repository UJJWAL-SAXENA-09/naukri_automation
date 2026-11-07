#!/bin/sh
set -eu

STATE_DIR=/state
APP_DIR=/app

# Chrome profiles and runtime output must survive image rebuilds and container restarts.
for dir in .naukri-chrome-profile .naukri-apply-profile .wellfound-chrome-profile .indeed-chrome-profile; do
  target="$STATE_DIR/${dir#.}"
  mkdir -p "$target"
  rm -rf "$APP_DIR/$dir"
  ln -s "$target" "$APP_DIR/$dir"
done

for file in naukri-refresh.log applications.csv apply-state-naukri.json apply-state-wellfound.json apply-state-indeed.json; do
  target="$STATE_DIR/$file"
  [ -e "$target" ] || : > "$target"
  rm -f "$APP_DIR/$file"
  ln -s "$target" "$APP_DIR/$file"
done

chown -R automation:automation "$STATE_DIR"

run_node() {
  exec gosu automation xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" node "$@"
}

if [ "${1:-}" = "scheduler" ]; then
  interval="${SCHEDULE_SECONDS:-3600}"
  while :; do
    gosu automation xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" node naukri-profile-refresh.js || true
    sleep "$interval"
  done
fi

if [ "${1:-}" = "interactive-login" ]; then
  # The Compose port is host-local only. Access it via an SSH tunnel, never by
  # opening a VNC/noVNC port in the Oracle security list.
  Xvfb :99 -screen 0 1280x900x24 -nolisten tcp &
  sleep 1
  x11vnc -display :99 -localhost -nopw -forever -shared >/tmp/x11vnc.log 2>&1 &
  websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
  exec gosu automation env DISPLAY=:99 node naukri-profile-refresh.js login --show
fi

run_node "$@"
