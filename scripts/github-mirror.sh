#!/bin/bash
# github-mirror.sh — Push current HEAD to GitHub mirror (main + master)
# Reads GITHUB_PAT and GITHUB_MIRROR_REPO from .env
# Usage: bash scripts/github-mirror.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/nextjs_space/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "[mirror] ERROR: .env not found at $ENV_FILE"
  exit 1
fi

# Source env vars (handle quoted values)
export $(grep -E '^GITHUB_(PAT|MIRROR_REPO)=' "$ENV_FILE" | sed "s/'//g" | xargs)

if [ -z "${GITHUB_PAT:-}" ] || [ -z "${GITHUB_MIRROR_REPO:-}" ]; then
  echo "[mirror] ERROR: GITHUB_PAT or GITHUB_MIRROR_REPO not set in .env"
  echo "[mirror] Add these to $ENV_FILE:"
  echo "  GITHUB_PAT=ghp_..."
  echo "  GITHUB_MIRROR_REPO=github.com/cwc2030-oss/TFP.git"
  exit 1
fi

MIRROR_URL="https://cwc2030-oss:${GITHUB_PAT}@${GITHUB_MIRROR_REPO}"

cd "$PROJECT_DIR"

# Ensure origin is set correctly (survives conversation restarts)
current_url=$(git remote get-url origin 2>/dev/null || echo "")
if [ "$current_url" != "$MIRROR_URL" ]; then
  echo "[mirror] Updating origin remote URL..."
  if [ -n "$current_url" ]; then
    git remote set-url origin "$MIRROR_URL"
  else
    git remote add origin "$MIRROR_URL"
  fi
fi

# Push to both branches
echo "[mirror] Pushing to main + master..."
git push origin HEAD:main HEAD:master 2>&1

# Verify
echo "[mirror] Verifying..."
git ls-remote origin HEAD refs/heads/main refs/heads/master
echo "[mirror] Done."
