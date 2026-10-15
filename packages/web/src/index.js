import { createRequire } from 'node:module';
import { Command } from 'commander';
import { parseCmdline } from '@deepseek-ai/dsh-cmdline';

export const inject = ['cmdlineArgs'];
export function apply(ctx) {
  const program = new Command().name('dsh --profile banso-web')
    .description('Serve the minimal Banso chat UI on localhost.')
    .option('--port <port>', 'localhost port (0 chooses a free port)', '3080');
  program.action(() => {
    const value = program.opts().port;
    if (!/^\d+$/.test(value) || Number(value) > 65535) program.error('port must be an integer from 0 to 65535');
    const require = createRequire(import.meta.url);
    ctx.provide('bansoWebStartup', {
      port: Number(value),
      distIndex: require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'),
    });
    ctx.inject(['webServer', 'connection'], child => {
      const report = () => console.log(`Banso Web: ${child.connection.authenticatedUrl(`http://127.0.0.1:${child.webServer.port}`)}`);
      if (ctx.appReady) child.effect(() => ctx.appReady.onReady(report));
    });
  });
  parseCmdline(ctx, program);
}
