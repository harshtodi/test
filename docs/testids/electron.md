# Electron shell (M5) — test hooks

The desktop shell has no React UI of its own, so it adds no `data-testid`
attributes. This file lists what the Electron smoke tests
(`tests/e2e/electron/smoke.spec.ts`) rely on instead, and how to drive the
shell headlessly.

## Renderer-side test ids used by the smoke tests (owned by other modules)

| test id | used for |
| --- | --- |
| `app` | app mounted (launch readiness) |
| `empty-state` | no document loaded |
| `page-thumb` | one per page after a file was opened from the CLI / second instance |
| `page-thumb-image` / `page-thumb-placeholder` | a rendered thumbnail vs. the loading/error placeholder (class `error` when pdf.js failed) — see docs/testids/page-grid.md |
| `notice` | toast after a menu command reached the renderer (`File → Save` on an empty document shows "Nothing to save yet") |
| `window.pdfEditor` | the preload bridge (`ElectronBridge` in `src/platform/index.ts`): `saveFile`, `openFiles`, `onOpenFiles`, `onMenuCommand`, `setDirty`, `versions` |

## Main-process hooks

| hook | purpose |
| --- | --- |
| env `PDF_EDITOR_USER_DATA_DIR` | overrides `app.getPath('userData')` so each test gets a private `preferences.json` and single-instance lock. |
| env `VITE_DEV_SERVER_URL` | when set, dev mode (loads that URL, detached devtools, Reload/DevTools menu items, IPC trusted from that origin). Tests set it to `""` to force the production `app://` path. |
| `preferences.json` in userData | `{ window: { x, y, width, height, maximized }, lastDir }` — written on window close and after a dialog is used. `lastDir` is only used when it still names an existing directory. |
| menu item ids | `open`, `save`, `close-window`, `quit` (not on macOS), `undo`, `redo`, `zoom-in`, `zoom-out`, `zoom-reset`, `about`, plus the hidden accelerator twins `zoom-in-plus` (`CmdOrCtrl+Plus`), `zoom-in-numpad` (`CmdOrCtrl+numadd`), `zoom-out-numpad` (`CmdOrCtrl+numsub`). `Menu.getApplicationMenu().getMenuItemById(id).click()` sends the matching `MenuCommand` to the focused window. Top-level labels carry `&` mnemonics on Windows/Linux (`&File`), none on macOS. |
| `dialog.showOpenDialog` / `showSaveDialog` / `showMessageBoxSync` | native dialogs; stub them from `electronApp.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [...] }); })` — the handlers look the functions up on the module at call time. The unsaved-changes prompt is `showMessageBoxSync` with buttons `['Save…', "Don't save", 'Cancel']` (indices 0/1/2). |
| `shell.openExternal` | called for `http(s)` links/popups; stub it to assert external navigation without launching a browser. |

## IPC channels (preload ⇄ main)

| channel | direction | payload |
| --- | --- | --- |
| `dialog:open-files` | invoke | → `OpenedFile[] \| null` (null when cancelled) |
| `dialog:save-file` | invoke `(bytes: Uint8Array, suggestedName)` | → `{ saved, location? }`; rejects for a non-`Uint8Array` or empty payload, and on write errors |
| `app:set-dirty` | send `(boolean)` | per-window unsaved flag (anything but `true` clears it) |
| `renderer:ready` | send | preload installed; main flushes queued files |
| `host:open-files` | main → renderer | `OpenedFile[]` (buffered in the preload until `onOpenFiles` has a subscriber) |
| `host:menu-command` | main → renderer | `MenuCommand` |

Every handler validates the sender: only the **main frame** of a page on the
`app://pdf-editor` origin (or the dev-server origin in dev mode) is served;
anything else is ignored (`send` channels) or rejected with
`Untrusted sender for <channel>` (`invoke` channels). A `BrowserWindow`
loading `about:blank` with the same preload therefore gets a rejection — the
smoke suite checks this.

## Recipes

Launch (after `npm run build`):

```ts
const app = await _electron.launch({
  args: ['.', ...(process.getuid?.() === 0 || process.env.CI ? ['--no-sandbox'] : []), ...filePaths],
  env: { ...process.env, VITE_DEV_SERVER_URL: '', PDF_EDITOR_USER_DATA_DIR: tmpDir },
});
```

Wait for the dirty flag before closing: the renderer sends `app:set-dirty`
from a React effect. IPC from one frame is ordered, so after stubbing
`showOpenDialog` to cancel, `await page.evaluate(() => window.pdfEditor.openFiles())`
guarantees main has processed every earlier message from that page.
