#!/usr/bin/env bash
# Builds the static web version and packages it for deployment.
# Output:
#   release/app/dist/renderer   deployable static site
#   release/chatbox-web.tar.gz  same content as a tarball
set -euo pipefail
cd "$(dirname "$0")"

pnpm build:web

tar -czf release/chatbox-web.tar.gz -C release/app/dist/renderer .

echo ""
echo "Web build complete."
echo "  Static site:  release/app/dist/renderer"
echo "  Tarball:      release/chatbox-web.tar.gz"
echo ""
echo "Deploy options (see docs/web-deployment.md):"
echo "  - Vercel / Netlify: push the repo, configs are picked up automatically"
echo "  - Self-host:        node scripts/web-server.mjs"
