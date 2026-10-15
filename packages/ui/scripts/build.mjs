import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../lib/types/index.js', import.meta.url), new URL('../lib/index.js', import.meta.url));
await build({
  entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', sourcemap: true,
  external: ['react', 'react/*', '@deepseek-ai/cordis'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: 'window.__ModuleLoader__.load({ id: "banso-dsh-ui", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
});
