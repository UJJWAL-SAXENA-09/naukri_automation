#!/bin/zsh
set -u

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
node_bin="${NODE_BINARY:-/opt/homebrew/bin/node}"
job="${1:-}"
lock_root="$repo_dir/runtime/locks"
mkdir -p "$lock_root"
job_pid=""
awake_pid=""

case "$job" in
  refresh)
    lock_dir="$lock_root/naukri-refresh.lock"
    command_args=(naukri-profile-refresh.js)
    ;;
  naukri)
    lock_dir="$lock_root/naukri-auto-apply.lock"
    command_args=(auto-apply-runner.js naukri --scheduled)
    ;;
  wellfound)
    lock_dir="$lock_root/wellfound-auto-apply.lock"
    command_args=(auto-apply-runner.js wellfound --scheduled)
    ;;
  *)
    print -u2 "Usage: $0 <refresh|naukri|wellfound>"
    exit 2
    ;;
esac

cleanup_lock() {
  /bin/rm -f "$lock_dir/pid" "$lock_dir/job" 2>/dev/null || true
  /bin/rmdir "$lock_dir" 2>/dev/null || true
}

lock_is_live() {
  [[ -f "$lock_dir/pid" ]] || return 1
  owner_pid="$(<"$lock_dir/pid")"
  [[ "$owner_pid" == <-> ]] || return 1
  /bin/kill -0 "$owner_pid" 2>/dev/null || return 1
  owner_command="$(/bin/ps -p "$owner_pid" -o command= 2>/dev/null)"
  [[ "$owner_command" == *"run-macos-job.sh $job"* ]]
}

if ! /bin/mkdir "$lock_dir" 2>/dev/null; then
  if lock_is_live; then
    print "[$(date -Iseconds)] skipped $job: live process $(<"$lock_dir/pid") owns $lock_dir"
    exit 0
  fi
  print "[$(date -Iseconds)] removing stale $job lock: $lock_dir"
  cleanup_lock
  if ! /bin/mkdir "$lock_dir" 2>/dev/null; then
    print -u2 "[$(date -Iseconds)] failed to acquire $job lock: $lock_dir"
    exit 1
  fi
fi
print -r -- "$$" > "$lock_dir/pid"
print -r -- "$job" > "$lock_dir/job"

stop_children() {
  trap - INT TERM
  [[ -n "$job_pid" ]] && /bin/kill -TERM "$job_pid" 2>/dev/null || true
  [[ -n "$job_pid" ]] && wait "$job_pid" 2>/dev/null || true
  [[ -n "$awake_pid" ]] && /bin/kill -TERM "$awake_pid" 2>/dev/null || true
  cleanup_lock
  exit 143
}
trap cleanup_lock EXIT
trap stop_children INT TERM

cd "$repo_dir"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ="Asia/Kolkata"
export BROWSER_SESSION_SNAPSHOT=1

# The same private flag controls Docker and macOS. Scheduled auto-apply is dry-run
# unless the user explicitly sets AUTO_APPLY_LIVE=1 in the git-ignored .env.
if [[ "$job" != "refresh" ]] && /usr/bin/grep -Eq '^[[:space:]]*AUTO_APPLY_LIVE[[:space:]]*=[[:space:]]*1[[:space:]]*$' .env; then
  command_args+=(--live)
fi

print "[$(date -Iseconds)] starting $job: $node_bin ${command_args[*]}"
# Keep both the display and system awake for the full job. -u also declares user
# activity so macOS does not immediately dim/lock while an unattended form is open.
/usr/bin/caffeinate -d -i -u -w $$ >/dev/null 2>&1 &
awake_pid=$!
"$node_bin" "${command_args[@]}" &
job_pid=$!
wait "$job_pid"
exit_code=$?
job_pid=""
[[ -n "$awake_pid" ]] && /bin/kill -TERM "$awake_pid" 2>/dev/null || true
awake_pid=""
print "[$(date -Iseconds)] finished $job with exit code $exit_code"
exit "$exit_code"
