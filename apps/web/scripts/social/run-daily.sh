#!/bin/zsh
#
# The entry point launchd calls. Everything the scheduled run needs that an
# interactive shell would have provided has to be set up here — launchd starts
# jobs with a near-empty environment, so `node` installed through nvm and
# `composio` in ~/.local/bin are both invisible without this.
#
# Sourcing nvm rather than hardcoding a version path means an nvm upgrade
# doesn't silently break the schedule at 11am some morning.

set -u

# The `social` scripts live in the web workspace, not at the monorepo root, and
# `daily.ts` resolves its own log directory from the working directory — so both
# the cd below and LOG_DIR have to point at the workspace, not at REPO.
REPO="/Users/khaleelmusleh/Desktop/Sailo"
APP="$REPO/apps/web"
LOG_DIR="$APP/scripts/social/.log"
mkdir -p "$LOG_DIR"

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" --no-use
  nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1
fi
export PATH="$HOME/.local/bin:$PATH"

cd "$APP" || exit 1

{
  echo "───────── $(date '+%Y-%m-%d %H:%M:%S %Z')"
  if ! command -v node >/dev/null 2>&1; then
    echo "node not on PATH — schedule cannot run"
    exit 1
  fi
  if ! command -v composio >/dev/null 2>&1; then
    echo "composio not on PATH — schedule cannot run"
    exit 1
  fi
  npm run --silent social
  echo "exit: $?"
} >> "$LOG_DIR/daily.log" 2>&1
