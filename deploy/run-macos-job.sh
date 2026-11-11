#!/bin/zsh
set -u

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
node_bin="${NODE_BINARY:-/opt/homebrew/bin/node}"
job="${1:-}"
lock_root="$repo_dir/runtime/locks"
mkdir -p "$lock_root"

case "$job" in
  refresh)
    lock_dir="$lock_root/naukri-refresh.lock"
    command_args=(naukri-profile-refresh.js)
    ;;
  naukri)
    lock_dir="$lock_root/auto-apply.lock"
    command_args=(auto-apply-runner.js naukri --scheduled)
    ;;
  wellfound)
    lock_dir="$lock_root/auto-apply.lock"
    command_args=(auto-apply-runner.js wellfound --scheduled)
    ;;
  *)
    print -u2 "Usage: $0 <refresh|naukri|wellfound>"
    exit 2
    ;;
esac

if ! mkdir "$lock_dir" 2>/dev/null; then
  print "[$(date -Iseconds)] skipped $job: another job owns $lock_dir"
  exit 0
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT INT TERM

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
/usr/bin/caffeinate -i "$node_bin" "${command_args[@]}"
exit_code=$?
print "[$(date -Iseconds)] finished $job with exit code $exit_code"
exit "$exit_code"
