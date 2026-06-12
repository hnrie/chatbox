import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rimrafSync } from 'rimraf'

const rootPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')
const distPaths = [
  path.join(rootPath, 'release/app/dist/main'),
  path.join(rootPath, 'release/app/dist/preload'),
  path.join(rootPath, 'release/app/dist/renderer'),
  path.join(rootPath, 'out/main'),
  path.join(rootPath, 'out/preload'),
  path.join(rootPath, 'out/renderer'),
]

for (const distPath of distPaths) {
  if (fs.existsSync(distPath)) {
    rimrafSync(path.join(distPath, '**/*.map'), { glob: true })
  }
}
