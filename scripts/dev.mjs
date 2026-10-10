// Development entry: starts the Vite dev server, builds the Electron main and
// preload bundles, then launches Electron pointed at the dev server with HMR.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
console.log(`[dev] vite dev server at ${url}`);

const buildMain = spawn(process.execPath, ['scripts/build-electron.mjs'], { stdio: 'inherit' });
await new Promise((resolve, reject) => {
  buildMain.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build-electron exited ${code}`))));
});

const child = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
