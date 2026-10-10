/**
 * `app://pdf-editor/` — the privileged scheme the production bundle is served
 * from. Serving from a custom scheme (instead of `file://`) gives the renderer
 * a real origin, so the CSP in index.html, `fetch`, web workers (pdf.js) and
 * module scripts all behave as they would on an https site.
 */
import { net, protocol } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_SCHEME = 'app';
export const APP_HOST = 'pdf-editor';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Must run before `app.whenReady()` resolves. */
export function registerAppSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

/**
 * Map a request path to a file inside `distDir`. Returns `null` when the path
 * would escape the directory (`..`, absolute paths, NUL bytes, bad encoding).
 * `/` maps to `index.html`; every other path must name a real file.
 */
export function resolveAppFile(distDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.replace(/^[/\\]+/, '').replace(/\\/g, '/') || 'index.html';
  const root = path.resolve(distDir);
  const file = path.resolve(root, relative);
  const rel = path.relative(root, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** Serve `distDir` (the Vite output) under `app://pdf-editor/`. Call after app ready. */
export function registerAppProtocol(distDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return notFound();
    }
    if (url.hostname !== APP_HOST) return notFound();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }
    const file = resolveAppFile(distDir, url.pathname);
    if (!file) return notFound();

    let size: number;
    try {
      const info = await stat(file);
      if (!info.isFile()) return notFound();
      size = info.size;
    } catch {
      return notFound();
    }

    const upstream = await net.fetch(pathToFileURL(file).toString());
    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => undefined);
      return notFound();
    }

    const headers = new Headers();
    headers.set('Content-Type', contentTypeFor(file));
    headers.set('Content-Length', String(size));
    headers.set('Cache-Control', 'no-cache');
    headers.set('X-Content-Type-Options', 'nosniff');
    if (request.method === 'HEAD') {
      // Nothing reads the body of a HEAD response: release the stream now.
      void upstream.body?.cancel().catch(() => undefined);
      return new Response(null, { status: 200, headers });
    }
    return new Response(upstream.body, { status: 200, headers });
  });
}
