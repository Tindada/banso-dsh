import { copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Resolve the declared dependency, so this also works outside the workspace layout.
const require = createRequire(import.meta.url)
const baseDirectory = dirname(require.resolve('banso-dsh-base/package.json'))
await copyFile(
  join(baseDirectory, 'cordis.patch.yml'),
  new URL('../base.patch.yml', import.meta.url),
)
