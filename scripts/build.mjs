// Bundles the app into self-contained single-file HTML builds:
//   dist/index.html     – complete document (open directly or host anywhere static)
//   dist/artifact.html  – body-only variant used for the claude.ai artifact
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require('esbuild'); } catch { esbuild = require('/home/claude/.npm-global/lib/node_modules/tsx/node_modules/esbuild'); }
const root = join(fileURLToPath(import.meta.url), '../..');
const res = await esbuild.build({
  entryPoints: [join(root, 'src/main.js')], bundle: true, format: 'esm', minify: true, write: false, target: 'es2020',
  alias: { three: join(root, 'vendor/three.module.js') }, legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(join(root, 'src/ui/style.css'), 'utf8');
const html = await readFile(join(root, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"')).trim();
const title = html.match(/<title>.*?<\/title>/)[0];
const lang = html.match(/<html lang="([^"]+)"/)?.[1] ?? 'en';
const desc = html.match(/<meta name="description"[^>]*>/)[0];
const inner = `${title}\n${desc}\n<style>\n${css}\n</style>\n${body}\n<script type="module">\n${js}\n</script>\n`;
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/artifact.html'), inner);
await writeFile(join(root, 'dist/index.html'), `<!doctype html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${inner.replace(body, '').replace(/<script type="module">[\s\S]*<\/script>\n$/, '')}</head>\n<body>\n${body}\n<script type="module">\n${js}\n</script>\n</body>\n</html>\n`);
console.log(`dist/index.html ${(js.length / 1024).toFixed(0)} KB of JS`);
