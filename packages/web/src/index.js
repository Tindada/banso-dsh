import open from 'open';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { parseCmdline } from '@deepseek-ai/dsh-cmdline';

export const inject = ['cmdlineArgs'];
export function apply(ctx) {
  const program = new Command().name('dsh --profile banso-web')
    .description('Serve the minimal Banso chat UI on localhost.')
    .option('--port <port>', 'localhost port (0 chooses a free port)', '3080')
    .option('--no-open', 'do not open the default browser');
  program.action(() => {
    const value = program.opts().port;
    if (!/^\d+$/.test(value) || Number(value) > 65535) program.error('port must be an integer from 0 to 65535');
    const require = createRequire(import.meta.url);
    ctx.provide('bansoWebStartup', {
      port: Number(value),
      distIndex: require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'),
    });
    ctx.inject(['webServer', 'connection'], child => {
      const report = () => {
        const url = child.connection.authenticatedUrl(`http://127.0.0.1:${child.webServer.port}`);
        void reportReady(url, program.opts().open);
      };
      if (ctx.appReady) child.effect(() => ctx.appReady.onReady(report));
    });
  });
  parseCmdline(ctx, program);
}

// Opening the browser is best-effort and never blocks server readiness.
export async function reportReady(url, shouldOpen = true, openUrl = open, logger = console) {
  logger.log(`Banso Web: ${url}`);
  if (!shouldOpen) return;
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    logger.warn('无法自动打开浏览器，请手动打开上方 Banso Web 地址。');
  };
  try {
    const launcher = await openUrl(url);
    launcher.once('error', warn);
    if (launcher.exitCode !== null) {
      if (launcher.exitCode !== 0) warn();
    } else {
      launcher.once('close', code => { if (code !== 0) warn(); });
    }
  } catch {
    warn();
  }
}
