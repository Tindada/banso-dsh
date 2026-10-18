import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../lib/types/index.js', import.meta.url), new URL('../lib/index.js', import.meta.url));
// Inline KaTeX styles and fonts into the client module: DSH loads this JS entry,
// so no separate CSS/font route or external CDN is required.
const katexStyles = await build({
  entryPoints: ['katex/dist/katex.min.css'], bundle: true, write: false, minify: true,
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
});
await build({
  entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', sourcemap: true,
  external: ['react', 'react/*', '@deepseek-ai/cordis'],
  define: { __KATEX_CSS__: JSON.stringify(katexStyles.outputFiles[0].text), 'process.env.NODE_ENV': '"production"' },
  banner: { js: 'window.__ModuleLoader__.load({ id: "banso-dsh-ui", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
});
