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

seconds_until_next_schedule() {
  now_epoch="$(date +%s)"

  if [ -n "${SCHEDULE_TIMES:-}" ]; then
    today="$(date +%F)"
    best=999999
    old_ifs="$IFS"
    IFS=','
    for scheduled_time in $SCHEDULE_TIMES; do
      target_epoch="$(date -d "$today $scheduled_time" +%s)"
      if [ "$target_epoch" -le "$now_epoch" ]; then
        target_epoch=$((target_epoch + 86400))
      fi
      delta=$((target_epoch - now_epoch))
      if [ "$delta" -lt "$best" ]; then best="$delta"; fi
    done
    IFS="$old_ifs"
    echo "$best"
    return
  fi

  if [ -n "${SCHEDULE_MINUTE:-}" ]; then
    schedule_minute="$(printf '%s' "$SCHEDULE_MINUTE" | sed 's/^0//')"
    current_minute="$(date +%M | sed 's/^0//')"
    current_second="$(date +%S | sed 's/^0//')"
    [ -n "$schedule_minute" ] || schedule_minute=0
    [ -n "$current_minute" ] || current_minute=0
    [ -n "$current_second" ] || current_second=0
    target=$((schedule_minute * 60))
    current=$((current_minute * 60 + current_second))
    wait_seconds=$((target - current))
    if [ "$wait_seconds" -le 0 ]; then wait_seconds=$((wait_seconds + 3600)); fi
    echo "$wait_seconds"
    return
  fi

  echo "${SCHEDULE_SECONDS:-3600}"
}

run_scheduled_job() {
  if [ -n "${SCHEDULER_LOCK_FILE:-}" ]; then
    status=0
    flock -n -E 75 "$SCHEDULER_LOCK_FILE" \
      gosu automation xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" node "$@" || status=$?
    if [ "$status" -eq 75 ]; then
      echo "[$(date -Iseconds)] skipped: another auto-apply job still holds the lock"
    elif [ "$status" -ne 0 ]; then
      echo "[$(date -Iseconds)] job failed with exit code $status"
    fi
  else
    gosu automation xvfb-run -a -s "-screen 0 1280x900x24 -nolisten tcp" node "$@" || true
  fi
}

if [ "${1:-}" = "scheduler" ]; then
  shift
  if [ "$#" -eq 0 ]; then set -- naukri-profile-refresh.js; fi
  if [ "${1:-}" = "auto-apply-runner.js" ] && [ "${AUTO_APPLY_LIVE:-0}" = "1" ]; then
    set -- "$@" --live
  fi
  while :; do
    wait_seconds="$(seconds_until_next_schedule)"
    echo "[$(date -Iseconds)] next run in ${wait_seconds}s: node $*"
    sleep "$wait_seconds"
    run_scheduled_job "$@"
  done
fi

if [ "${1:-}" = "interactive-login" ]; then
  # The Compose port is host-local only. Access it via an SSH tunnel, never by
  # opening a VNC/noVNC port in the Oracle security list.
  Xvfb :99 -screen 0 1280x900x24 -nolisten tcp &
  sleep 1
  x11vnc -display :99 -localhost -nopw -forever -shared >/tmp/x11vnc.log 2>&1 &
  websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
  case "${2:-refresh}" in
    refresh|naukri|wellfound|indeed)
      exec gosu automation env DISPLAY=:99 node manual-browser-login.js "$2"
      ;;
    *)
      echo "Unknown login target: ${2:-}. Use refresh, naukri, wellfound, or indeed." >&2
      exit 2
      ;;
  esac
fi

run_node "$@"
