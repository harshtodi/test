/**
 * Electron smoke tests: launch the packaged-style app (dist/ served over
 * app://, dist-electron/main.cjs) and exercise the shell end to end.
 *
 *   npm run build && xvfb-run -a npx playwright test -c playwright.electron.config.ts
 *
 * Each test gets its own userData directory (PDF_EDITOR_USER_DATA_DIR), so the
 * single-instance lock and the persisted window state never leak between tests.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLabeledPdf } from '../../helpers/make-pdf';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
// Chromium's sandbox cannot be used as root, and GitHub's Ubuntu runners
// restrict unprivileged user namespaces; the app itself still runs with
// `sandbox: true` web preferences in both cases.
const sandboxArgs = runningAsRoot || process.env.CI ? ['--no-sandbox'] : [];

interface Launched {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

async function launch(extraArgs: string[] = [], userData?: string): Promise<Launched> {
  const dir = userData ?? (await mkdtemp(path.join(os.tmpdir(), 'pdf-editor-e2e-')));
  const app = await electron.launch({
    args: ['.', ...sandboxArgs, ...extraArgs],
    cwd: repoRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', PDF_EDITOR_USER_DATA_DIR: dir },
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId('app')).toBeVisible();
  return { app, page, userData: dir };
}

let scratch: string;
test.beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'pdf-editor-files-'));
});
test.afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

test('serves the production bundle over app:// in a hardened window', async () => {
  const { app, page, userData } = await launch();
  try {
    await expect(page).toHaveTitle('PDF Editor');
    expect(page.url()).toMatch(/^app:\/\/pdf-editor\//);
    await expect(page.getByTestId('empty-state')).toBeVisible();

    const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle());
    expect(title).toBe('PDF Editor');

    // No Node in the page, and the bridge is the only thing exposed.
    const exposure = await page.evaluate(() => ({
      require: typeof (window as unknown as Record<string, unknown>).require,
      process: typeof (window as unknown as Record<string, unknown>).process,
      bridge: typeof window.pdfEditor,
    }));
    expect(exposure).toEqual({ require: 'undefined', process: 'undefined', bridge: 'object' });

    // The CSP from index.html is in force (served with the right content type).
    const contentType = await page.evaluate(() => document.contentType);
    expect(contentType).toBe('text/html');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('exposes window.pdfEditor with versions that match the main process', async () => {
  const { app, page, userData } = await launch();
  try {
    const versions = await page.evaluate(() => window.pdfEditor?.versions);
    expect(versions).toBeDefined();
    expect(typeof versions?.electron).toBe('string');
    expect(versions?.electron.length).toBeGreaterThan(0);
    expect(typeof versions?.chrome).toBe('string');
    expect(typeof versions?.node).toBe('string');

    const mainVersions = await app.evaluate(() => ({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    }));
    expect(versions).toEqual(mainVersions);

    const api = await page.evaluate(() => Object.keys(window.pdfEditor ?? {}).sort());
    expect(api).toEqual(['onMenuCommand', 'onOpenFiles', 'openFiles', 'saveFile', 'setDirty', 'versions']);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('openFiles and saveFile round-trip bytes through IPC', async () => {
  const fixture = path.join(scratch, 'fixture.pdf');
  const pdfBytes = await makeLabeledPdf(2, 'Smoke');
  await writeFile(fixture, pdfBytes);

  const { app, page, userData } = await launch();
  try {
    // Stub the native dialogs in the main process (they would block under xvfb).
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
    }, fixture);
    const opened = await page.evaluate(async () => {
      const files = await window.pdfEditor!.openFiles();
      return files?.map((f) => ({ name: f.name, length: f.bytes.length, isU8: f.bytes instanceof Uint8Array, head: Array.from(f.bytes.slice(0, 5)) }));
    });
    expect(opened).toEqual([
      { name: 'fixture.pdf', length: pdfBytes.length, isU8: true, head: [0x25, 0x50, 0x44, 0x46, 0x2d] },
    ]);

    // Cancelled open returns null.
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
    });
    expect(await page.evaluate(() => window.pdfEditor!.openFiles())).toBeNull();

    // Save: the main process writes exactly the bytes the renderer sent
    // (and appends .pdf when the chosen name lacks it).
    const target = path.join(scratch, 'out', 'saved');
    await mkdir(path.dirname(target), { recursive: true });
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    }, target);
    const result = await page.evaluate(() => window.pdfEditor!.saveFile(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a, 0xff]), 'result.pdf'));
    expect(result).toEqual({ saved: true, location: `${target}.pdf` });
    expect(Array.from(await readFile(`${target}.pdf`))).toEqual([0x25, 0x50, 0x44, 0x46, 0x0a, 0xff]);
    // The bytes went through a temporary sibling that was renamed over the target.
    expect(await readdir(path.dirname(target))).toEqual(['saved.pdf']);

    // Saving over an existing file replaces it (the dialog allows overwriting).
    const replaced = await page.evaluate(() => window.pdfEditor!.saveFile(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x0a, 0x01]), 'result.pdf'));
    expect(replaced).toEqual({ saved: true, location: `${target}.pdf` });
    expect(Array.from(await readFile(`${target}.pdf`))).toEqual([0x25, 0x50, 0x44, 0x46, 0x0a, 0x01]);

    // A save that fails after the temporary file was written (here: the chosen
    // name is taken by a directory, so the rename fails) rejects, leaves the
    // existing entry alone and cleans up the temporary file.
    const taken = path.join(scratch, 'out', 'taken.pdf');
    await mkdir(taken);
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    }, taken);
    const failed = await page.evaluate(() =>
      window.pdfEditor!.saveFile(new Uint8Array([1, 2, 3]), 'x.pdf').then(() => 'resolved', (err: Error) => `rejected: ${err.message}`),
    );
    expect(failed).toMatch(/^rejected: /);
    expect((await readdir(path.dirname(target))).sort()).toEqual(['saved.pdf', 'taken.pdf']);
    expect((await stat(taken)).isDirectory()).toBe(true);

    // Cancelled save.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof dialog.showSaveDialog;
    });
    expect(await page.evaluate(() => window.pdfEditor!.saveFile(new Uint8Array([1]), 'x.pdf'))).toEqual({ saved: false });

    // The last used directory is remembered for the next dialog.
    const prefs = JSON.parse(await readFile(path.join(userData, 'preferences.json'), 'utf8')) as { lastDir?: string };
    expect(prefs.lastDir).toBe(path.join(scratch, 'out'));
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('opens PDFs passed on the command line and prompts before closing unsaved work', async () => {
  const fixture = path.join(scratch, 'cli-open.pdf');
  await writeFile(fixture, await makeLabeledPdf(3, 'CLI'));

  const { app, page, userData } = await launch([fixture]);
  try {
    // The main process read the file, queued it until the renderer was ready,
    // and the renderer imported it (3 page tiles, empty state gone).
    await expect(page.getByTestId('empty-state')).toBeHidden();
    await expect(page.getByTestId('page-thumb')).toHaveCount(3);

    // Importing marks the document dirty (a React effect sends app:set-dirty).
    // Messages from one frame arrive in order, so a round trip on the invoke
    // channel guarantees main has processed that flag before we close.
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
    });
    expect(await page.evaluate(() => window.pdfEditor!.openFiles())).toBeNull();

    // Closing must prompt. Stub the modal dialog: first answer Cancel (2),
    // then "Don't save" (1).
    await app.evaluate(({ dialog }) => {
      const answers = [2, 1];
      const calls: string[] = [];
      (globalThis as unknown as { __prompts: string[] }).__prompts = calls;
      dialog.showMessageBoxSync = ((_win: unknown, opts: { message: string }) => {
        calls.push(opts.message);
        return answers.shift() ?? 1;
      }) as unknown as typeof dialog.showMessageBoxSync;
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __prompts: string[] }).__prompts)).toEqual([
      'You have unsaved changes',
    ]);
    // Cancel kept the window open.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await expect(page.getByTestId('page-thumb')).toHaveCount(3);
  } finally {
    // The stub now answers "Don't save", so quitting proceeds.
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('a second instance forwards its files to the running window', async () => {
  const first = path.join(scratch, 'first.pdf');
  const second = path.join(scratch, 'second.pdf');
  await writeFile(first, await makeLabeledPdf(1, 'First'));
  await writeFile(second, await makeLabeledPdf(2, 'Second'));

  const { app, page, userData } = await launch([first]);
  try {
    // The document becomes dirty below; answer the close prompt with "Don't
    // save" up front so a failed assertion cannot leave a native dialog open.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = (() => 1) as unknown as typeof dialog.showMessageBoxSync;
    });
    await expect(page.getByTestId('page-thumb')).toHaveCount(1);

    const electronBinary = createRequire(import.meta.url)('electron') as string;
    const child = spawn(electronBinary, ['.', ...sandboxArgs, second], {
      cwd: repoRoot,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', PDF_EDITOR_USER_DATA_DIR: userData },
      stdio: 'ignore',
    });
    const exitCode = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(exitCode).toBe(0);

    // The first instance received the path and appended the pages.
    await expect(page.getByTestId('page-thumb')).toHaveCount(3);
    expect(app.windows()).toHaveLength(1);

    // A navigation the main process denies (external link -> system browser)
    // starts and stops loading without replacing the document. Delivery must
    // keep working afterwards: the preload is still the one that reported ready.
    // (From here on use expect.poll + locator.count(): Playwright's locator
    // assertions wait for that cancelled navigation to "finish", which Chromium
    // never reports over CDP, so expect(locator).toHaveCount() would time out.)
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { __opened: string[] }).__opened = opened;
      shell.openExternal = (async (url: string) => {
        opened.push(url);
      }) as typeof shell.openExternal;
    });
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'https://example.org/page';
      document.body.appendChild(a);
      a.click();
    });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)).toEqual([
      'https://example.org/page',
    ]);
    expect(page.url()).toMatch(/^app:\/\/pdf-editor\//);

    const third = path.join(scratch, 'third.pdf');
    await writeFile(third, await makeLabeledPdf(1, 'Third'));
    const again = spawn(electronBinary, ['.', ...sandboxArgs, third], {
      cwd: repoRoot,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', PDF_EDITOR_USER_DATA_DIR: userData },
      stdio: 'ignore',
    });
    expect(await new Promise<number | null>((resolve) => again.on('exit', resolve))).toBe(0);
    await expect.poll(() => page.getByTestId('page-thumb').count()).toBe(4);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('open-file with no window left opens a new window showing the file', async () => {
  // macOS keeps the app running after Cmd+W; a Finder double-click then emits
  // `open-file` (not `activate`). Simulate that on any platform: drop the
  // window-all-closed quit, close the only window, then emit open-file.
  const fixture = path.join(scratch, 'later.pdf');
  await writeFile(fixture, await makeLabeledPdf(2, 'Later'));

  const { app, page, userData } = await launch();
  try {
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await app.evaluate(({ app }) => {
      app.removeAllListeners('window-all-closed');
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);

    const reopened = app.waitForEvent('window');
    await app.evaluate(({ app }, file) => {
      app.emit('open-file', { preventDefault() {} }, file);
    }, fixture);
    const next = await reopened;
    await expect(next.getByTestId('app')).toBeVisible();
    await expect(next.getByTestId('page-thumb')).toHaveCount(2);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = (() => 1) as unknown as typeof dialog.showMessageBoxSync;
    });
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('the app:// protocol serves assets with correct types and rejects unknown paths', async () => {
  const { app, page, userData } = await launch();
  try {
    const probe = async (url: string, method: 'GET' | 'HEAD' = 'GET') =>
      page.evaluate(
        async ([u, m]) => {
          const res = await fetch(u!, { method: m });
          const body = m === 'GET' ? await res.text() : '';
          return { status: res.status, type: res.headers.get('content-type'), length: body.length };
        },
        [url, method] as const,
      );

    const index = await probe('app://pdf-editor/index.html');
    expect(index.status).toBe(200);
    expect(index.type).toBe('text/html; charset=utf-8');
    expect(index.length).toBeGreaterThan(100);

    const root = await probe('app://pdf-editor/');
    expect(root).toEqual(index);

    const scripts = await page.evaluate(() => Array.from(document.scripts, (s) => s.src).filter(Boolean));
    expect(scripts.length).toBeGreaterThan(0);
    const script = await probe(scripts[0]!, 'HEAD');
    expect(script.status).toBe(200);
    expect(script.type).toBe('text/javascript; charset=utf-8');

    const css = await page.evaluate(() => Array.from(document.styleSheets, (s) => s.href).filter(Boolean));
    if (css.length) expect((await probe(css[0]!, 'HEAD')).type).toBe('text/css; charset=utf-8');

    expect((await probe('app://pdf-editor/does-not-exist.js')).status).toBe(404);
    expect((await probe('app://pdf-editor/assets/')).status).toBe(404);
    // Dot segments are normalized by the URL parser and the handler never leaves dist/.
    expect((await probe('app://pdf-editor/%2e%2e/package.json')).status).toBe(404);
    // Another host on the scheme is a different origin: blocked by CORS or answered 404.
    const otherHost = await probe('app://other-host/index.html').then(
      (r) => r.status,
      (err: Error) => err.message,
    );
    expect(otherHost === 404 || /Failed to fetch/.test(String(otherHost))).toBe(true);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('menu commands reach the renderer', async () => {
  const { app, page, userData } = await launch();
  try {
    // Windows/Linux labels carry `&` mnemonics; macOS labels do not.
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label.replace('&', '')));
    expect(labels).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Window', 'Help']));

    // Production menu has no devtools items.
    const viewIds = await app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find((i) => i.label.replace('&', '') === 'View');
      return view?.submenu?.items.map((i) => i.role ?? i.id ?? i.type) ?? [];
    });
    expect(viewIds).toEqual(expect.arrayContaining(['zoom-in', 'zoom-out', 'zoom-reset', 'togglefullscreen']));
    expect(viewIds).not.toEqual(expect.arrayContaining(['toggledevtools']));
    // Hidden twins give Ctrl++ and the numeric keypad the same zoom commands.
    const hiddenZoom = await app.evaluate(({ Menu }) =>
      ['zoom-in-plus', 'zoom-in-numpad', 'zoom-out-numpad'].map((id) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(id);
        return item ? { visible: item.visible, accelerator: item.accelerator } : null;
      }),
    );
    expect(hiddenZoom).toEqual([
      { visible: false, accelerator: 'CmdOrCtrl+Plus' },
      { visible: false, accelerator: 'CmdOrCtrl+numadd' },
      { visible: false, accelerator: 'CmdOrCtrl+numsub' },
    ]);

    // Clicking File > Save with an empty document: the renderer reacts with a notice.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('save')?.click());
    await expect(page.getByTestId('notice')).toContainText('Nothing to save yet');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('validates IPC payloads and refuses the bridge to pages from other origins', async () => {
  const { app, page, userData } = await launch();
  try {
    // Malformed saveFile arguments are rejected before any dialog opens.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => {
        throw new Error('the save dialog must not open for a rejected payload');
      }) as typeof dialog.showSaveDialog;
    });
    const results = await page.evaluate(async () => {
      const outcomeOf = (p: Promise<unknown>) => p.then(() => 'resolved', (err: Error) => `rejected: ${err.message}`);
      return {
        string: await outcomeOf(window.pdfEditor!.saveFile('nope' as unknown as Uint8Array, 'x.pdf')),
        empty: await outcomeOf(window.pdfEditor!.saveFile(new Uint8Array(0), 'x.pdf')),
      };
    });
    expect(results.string).toMatch(/^rejected: .*Uint8Array/);
    expect(results.empty).toMatch(/^rejected: .*empty/);

    // A window showing any other origin gets nothing, even with the preload attached.
    const foreign = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const win = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } });
      try {
        await win.loadURL('about:blank');
        return (await win.webContents.executeJavaScript(
          `window.pdfEditor.openFiles().then(() => 'resolved', (e) => 'rejected: ' + e.message)`,
        )) as string;
      } finally {
        win.destroy();
      }
    }, path.join(repoRoot, 'dist-electron', 'preload.cjs'));
    expect(foreign).toMatch(/^rejected: .*Untrusted sender/);
    await expect.poll(() => app.windows().length).toBe(1);

    // The real page is unaffected.
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
    });
    expect(await page.evaluate(() => window.pdfEditor!.openFiles())).toBeNull();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('denies popups and external navigation', async () => {
  const { app, page, userData } = await launch();
  try {
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { __opened: string[] }).__opened = opened;
      shell.openExternal = (async (url: string) => {
        opened.push(url);
      }) as typeof shell.openExternal;
    });
    const popup = await page.evaluate(() => window.open('https://example.com/') === null);
    expect(popup).toBe(true);
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'https://example.org/page';
      document.body.appendChild(a);
      a.click();
    });
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)).toEqual([
      'https://example.com/',
      'https://example.org/page',
    ]);
    expect(app.windows()).toHaveLength(1);
    expect(page.url()).toMatch(/^app:\/\/pdf-editor\//);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('remembers the window size between launches', async () => {
  const first = await launch();
  try {
    await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 700));
    await expect
      .poll(() => first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getSize()))
      .toEqual([1000, 700]);
  } finally {
    await first.app.close();
  }
  const saved = JSON.parse(await readFile(path.join(first.userData, 'preferences.json'), 'utf8')) as {
    window?: { width: number; height: number };
  };
  expect(saved.window).toMatchObject({ width: 1000, height: 700 });

  const second = await launch([], first.userData);
  try {
    const size = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getSize());
    expect(size).toEqual([1000, 700]);
  } finally {
    await second.app.close();
    await rm(first.userData, { recursive: true, force: true });
  }
});
