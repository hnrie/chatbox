// Removes generated source maps from the production build output.
// Used by `pnpm build:web` (and other release builds) after `electron-vite build`.
const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '../../release/app/dist')

function deleteSourceMaps(dir) {
  if (!fs.existsSync(dir)) {
    return 0
  }
  let deleted = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      deleted += deleteSourceMaps(fullPath)
    } else if (entry.name.endsWith('.js.map') || entry.name.endsWith('.css.map')) {
      fs.rmSync(fullPath)
      deleted += 1
    }
  }
  return deleted
}

const deleted = deleteSourceMaps(distDir)
console.log(`delete-sourcemaps: removed ${deleted} source map file(s) from ${distDir}`)
