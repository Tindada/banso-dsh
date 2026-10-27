import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

/** Keep page reads on web_read without disabling the underlying web service. */
export function registerFetchRestriction(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (_assembly, _options, next) => {
    const assembly = await next()
    return { ...assembly, tools: assembly.tools.filter(tool => tool.name !== 'web_fetch') }
  })
  ctx.tools.guard(exec => exec.name === 'web_fetch'
    ? 'web_fetch is disabled by materials; use web_read instead'
    : undefined)
}
