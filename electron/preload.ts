// STUB — full bridge implemented in milestone M5. Must stay in sync with
// `ElectronBridge` in src/platform/index.ts.
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('pdfEditorVersions', {
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
});
