import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const distDir = join(process.cwd(), 'release', 'app', 'dist')

async function deleteSourceMaps(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return 0
    }
    throw error
  }

  let deleted = 0
  for (const entry of entries) {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      deleted += await deleteSourceMaps(entryPath)
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      await rm(entryPath)
      deleted += 1
    }
  }
  return deleted
}

const deleted = await deleteSourceMaps(distDir)
console.log(`Deleted ${deleted} source map file${deleted === 1 ? '' : 's'} from ${distDir}`)
