#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
OUTPUT_AAB="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"

if [[ ! -d "$ANDROID_DIR" ]]; then
  echo "[error] Android directory not found at: $ANDROID_DIR"
  exit 1
fi

if [[ ! -f "$ANDROID_DIR/gradlew" ]]; then
  echo "[error] Gradle wrapper not found at: $ANDROID_DIR/gradlew"
  exit 1
fi

# Reject any EXPO_PUBLIC_*_URL that is not https://, whether it comes from the
# process environment or from the env file the build reads. Only names are printed.
check_public_https_urls() {
  local failed=0 name value line env_file="${SAFENIGHT_ENV_FILE:-.env.android}"

  case "$env_file" in
    /*) ;;
    *) env_file="$ROOT_DIR/$env_file" ;;
  esac

  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    if [[ "${!name}" != https://* ]]; then
      echo "[error] $name must start with https:// (set in the environment)."
      failed=1
    fi
  done < <(compgen -e | grep -E '^EXPO_PUBLIC_.*_URL$')

  if [[ -f "$env_file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line#export }"
      case "$line" in
        EXPO_PUBLIC_*_URL=*) ;;
        *) continue ;;
      esac
      name="${line%%=*}"
      value="${line#*=}"
      value="${value#\"}"; value="${value%\"}"
      value="${value#\'}"; value="${value%\'}"
      if [[ "$value" != https://* ]]; then
        echo "[error] $name must start with https:// (in $(basename "$env_file"))."
        failed=1
      fi
    done < "$env_file"
  fi

  if [[ "$failed" -ne 0 ]]; then
    echo "[error] Refusing to build with non-https EXPO_PUBLIC URLs."
    exit 1
  fi
}

check_public_https_urls

# Default Android SDK paths for macOS if not already set.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export SAFENIGHT_ENV_FILE="${SAFENIGHT_ENV_FILE:-.env.android}"

if [[ ! -d "$ANDROID_SDK_ROOT" ]]; then
  echo "[error] Android SDK not found at: $ANDROID_SDK_ROOT"
  echo "Set ANDROID_HOME / ANDROID_SDK_ROOT to your SDK path."
  exit 1
fi

echo "[build] Bumping Android version code..."
node "$ROOT_DIR/scripts/bump-android-version-code.js"

echo "[build] Building signed release AAB..."
(
  cd "$ANDROID_DIR"
  chmod +x ./gradlew
  ./gradlew --no-daemon clean :app:bundleRelease
)

if [[ -f "$OUTPUT_AAB" ]]; then
  echo "[success] Production AAB generated:"
  echo "$OUTPUT_AAB"
else
  echo "[error] Build finished but AAB was not found at expected location:"
  echo "$OUTPUT_AAB"
  exit 1
fi
