#!/usr/bin/env bash
# Deploys the newest release tag (vX.Y.Z) to this VM. Runs every 10 minutes via safenight-update.timer.
#
# Safety rules:
#   - Only tags with a published GitHub Release are deployed. The release workflow publishes one
#     only after the full CI suite is green, so pushes to main never reach the server.
#   - Images are pulled from Docker Hub (<DOCKERHUB_USERNAME>/safenight-<service>:<sha>), published by
#     the backend publish workflow. Each SHA's images stay on disk as rollback points.
#   - If any service is not running or not healthy after `up`, the previous SHA is restored
#     automatically. Build failures leave the running stack untouched.
set -euo pipefail

REPO=/opt/safenight
STATE="$REPO/.deploy-state"          # line 1: deployed commit SHA, line 2: its tag
GH_REPO=${GH_REPO:-mzst-26/SafeNight}
HEALTH_WAIT_SECONDS=${HEALTH_WAIT_SECONDS:-240}

cd "$REPO"
git fetch --quiet --tags origin

LATEST=$(git tag --list 'v*.*.*' --sort=-v:refname | head -n1)
if [ -z "$LATEST" ]; then
  echo "no release tags yet"
  exit 0
fi

DEPLOYED_TAG=$(sed -n 2p "$STATE" 2>/dev/null || true)
if [ "$LATEST" = "$DEPLOYED_TAG" ]; then
  exit 0
fi

if ! curl -fsS -o /dev/null "https://api.github.com/repos/$GH_REPO/releases/tags/$LATEST"; then
  echo "release $LATEST is not published (CI not green or repo private); skipping"
  exit 0
fi

NEW_SHA=$(git rev-parse "$LATEST^{commit}")
PREV_SHA=$(sed -n 1p "$STATE" 2>/dev/null || true)
echo "deploying $LATEST ($(git rev-parse --short=12 "$NEW_SHA")), previous: ${PREV_SHA:-none}"

# Waits until every service is running and, where it has a healthcheck, healthy.
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_WAIT_SECONDS)) id state health
  while [ "$SECONDS" -lt "$deadline" ]; do
    local pending=0
    for id in $(docker compose ps -q); do
      state=$(docker inspect --format '{{.State.Status}}' "$id")
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")
      if [ "$state" != "running" ] || [ "$health" = "unhealthy" ]; then
        echo "service $(docker inspect --format '{{.Name}}' "$id") is $state/$health"
        return 1
      fi
      [ "$health" = "starting" ] && pending=1
    done
    [ "$pending" -eq 0 ] && return 0
    sleep 5
  done
  echo "timed out waiting for healthy services"
  return 1
}

# 1. Pull the images CI published for this commit. A failure here leaves the running stack untouched.
git checkout --quiet --detach "$NEW_SHA"
cd backend
if ! TAG="$NEW_SHA" docker compose pull; then
  echo "pull failed for $LATEST (images not published for $NEW_SHA?); running stack left as is"
  exit 1
fi

# 2. Switch over and verify.
TAG="$NEW_SHA" docker compose up -d --remove-orphans
if wait_healthy; then
  printf '%s\n%s\n' "$NEW_SHA" "$LATEST" > "$STATE"
  echo "deployed $LATEST"
  exit 0
fi

# 3. Roll back to the previous SHA's images (already built, so no rebuild).
echo "$LATEST failed health checks; rolling back"
if [ -z "$PREV_SHA" ]; then
  echo "no previous deploy to roll back to"
  exit 1
fi
cd "$REPO"
git checkout --quiet --detach "$PREV_SHA"
cd backend
TAG="$PREV_SHA" docker compose up -d --remove-orphans --no-build
if wait_healthy; then
  echo "rolled back to $(git -C "$REPO" describe --tags --exact-match "$PREV_SHA" 2>/dev/null || echo "$PREV_SHA")"
else
  echo "ROLLBACK ALSO UNHEALTHY: manual intervention needed"
fi
exit 1
