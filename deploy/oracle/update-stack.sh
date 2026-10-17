#!/usr/bin/env bash
# Pulls the latest main from GitHub and redeploys the stack when it has changed.
# Runs on the VM every 10 minutes via safenight-update.timer. Output goes to the journal.
# If a build fails, docker compose stops before replacing anything, so the running stack stays up.
set -euo pipefail

REPO=/opt/safenight
cd "$REPO"

git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "updating $(git rev-parse --short "$LOCAL") -> $(git rev-parse --short "$REMOTE")"
git merge --ff-only origin/main
cd backend
docker compose up -d --build
echo "deployed $(git -C "$REPO" rev-parse --short HEAD)"
