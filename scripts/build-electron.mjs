// Bundles the Electron main and preload scripts to CommonJS with esbuild.
// Output: dist-electron/main.cjs, dist-electron/preload.cjs
import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
rmSync('dist-electron', { recursive: true, force: true });
mkdirSync('dist-electron', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
};

await Promise.all([
  build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' }),
  build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' }),
]);

if (watch) {
  console.log('(watch mode is not implemented; re-run to rebuild)');
}
