import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Resolve the declared dependency, so this also works outside the workspace layout.
const require = createRequire(import.meta.url)
const baseDirectory = dirname(require.resolve('banso-dsh-base/package.json'))
await copyFile(
  join(baseDirectory, 'cordis.patch.yml'),
  new URL('../base.patch.yml', import.meta.url),
)
const license = await readFile(join(baseDirectory, 'LICENSE'), 'utf8')
await writeFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url),
  '# Third-Party Notices\n\n' +
  '`base.patch.yml` is copied from banso-dsh-base and adapted from DeepSeek Harness\n' +
  '(`packages/bundle/sdk-minimal/cordis.patch.yml`).\n' +
  'Upstream: https://github.com/deepseek-ai/deepseek-harness\n\n' +
  'This configuration remains under the following MIT license; the package\n' +
  'metadata license does not replace these upstream terms.\n\n' + license)
