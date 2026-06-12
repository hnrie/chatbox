#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "==> Building Chatbox web (static SPA)..."
pnpm build:web

OUTPUT_DIR="$ROOT_DIR/release/app/dist/renderer"

if [[ ! -f "$OUTPUT_DIR/index.html" ]]; then
  echo "error: web build output missing at $OUTPUT_DIR/index.html" >&2
  exit 1
fi

echo "==> Web build ready: $OUTPUT_DIR"
echo "    Local preview: pnpm preview:web"
echo "    Deploy output directory to Vercel, Netlify, Cloudflare Pages, or any static host."
