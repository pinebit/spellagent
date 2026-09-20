#!/usr/bin/env bash
set -euo pipefail

# Development verification only. Product commands never invoke Docker or npm.
spellagent_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
spellagent_image='node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c'
spellagent_volume=$(docker volume create)
cleanup() {
  docker volume rm "$spellagent_volume" >/dev/null
}
trap cleanup EXIT

cd -- "$spellagent_root"
# Copy only development inputs, excluding host dependencies, local credentials,
# version-control metadata, generated assets, and saved application runs.
COPYFILE_DISABLE=1 tar --no-xattrs --exclude='._*' -cf - package.json package-lock.json tsconfig.json tsconfig.build.json \
  vitest.config.ts .npmrc LICENSE README.md AGENTS.md docs src tests scripts |
  docker run --rm -i --mount "type=volume,source=$spellagent_volume,target=/workspace" \
    --env npm_config_cache=/workspace/npm-cache --env npm_config_update_notifier=false --env NO_COLOR=1 \
    "$spellagent_image" sh -ec '
      mkdir -p "/workspace/project with spaces"
      cd "/workspace/project with spaces"
      tar -xf -
      npm ci --no-audit --no-fund
      npm run prepare:pack-cache
    '

# Dependency installation is the only network-enabled stage. The same volume
# carries the Linux dependencies and npm cache into a fresh, offline container.
docker run --rm --network none \
  --mount "type=volume,source=$spellagent_volume,target=/workspace" \
  --workdir '/workspace/project with spaces' \
  --env npm_config_cache=/workspace/npm-cache --env npm_config_update_notifier=false --env NO_COLOR=1 \
  "$spellagent_image" sh -ec '
    node --version
    npm --version
    uname -sm
    npm run check
    npm run test:pack
  '
