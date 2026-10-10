# Installing PDF Editor

PDF Editor is a desktop app for Windows, macOS and Linux. Every release on the
repository's **GitHub Releases** page ships the installers listed below; they
are produced by `.github/workflows/release.yml` from a `v*` tag.

The builds are **not code-signed** (no Apple Developer / Windows signing
certificate), so each OS shows a one-time warning the first time you open the
app. The steps to get past it are below.

File names follow `PDF Editor-<version>-<os>-<arch>.<ext>`, for example
`PDF Editor-0.1.0-win-x64.exe`.

## Windows

Two downloads are offered:

| File | What it is |
| --- | --- |
| `PDF Editor-<version>-win-x64.exe` (NSIS) | Regular installer. Lets you pick the folder, adds a Start-menu entry, registers `.pdf` "Open with", and can be uninstalled from *Settings → Apps*. Installs per user (no administrator rights needed). |
| `PDF Editor-<version>-win-x64-portable.exe` | Single executable, nothing is installed. Keep it anywhere (USB stick included) and double-click it. |

If SmartScreen says *"Windows protected your PC"*: click **More info**, then
**Run anyway**. This happens because the binary is unsigned, not because
anything was flagged.

## macOS

| File | What it is |
| --- | --- |
| `PDF Editor-<version>-mac-arm64.dmg` | Apple Silicon (M1 and later). |
| `PDF Editor-<version>-mac-x64.dmg` | Intel Macs. |
| `…-mac-<arch>.zip` | Same app as a zip, for scripted installs. |

Open the `.dmg` and drag **PDF Editor** into *Applications*.

The first launch is blocked by Gatekeeper with *"PDF Editor" cannot be opened
because the developer cannot be verified* (or *"is damaged"* on recent
macOS). Use either of these once:

- **Right-click (or Control-click) the app in Applications and choose Open**,
  then click **Open** in the dialog. macOS remembers the choice.
- Or clear the quarantine flag from a terminal:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/PDF Editor.app"
  ```

If you downloaded the Intel build on an Apple Silicon Mac it still runs
(through Rosetta), but the arm64 build is faster.

## Linux

| File | What it is |
| --- | --- |
| `PDF Editor-<version>-linux-x86_64.AppImage` | Runs on any distribution, nothing to install. |
| `PDF Editor-<version>-linux-amd64.deb` | Debian / Ubuntu / Mint package. Adds a menu entry and the `.pdf` file association. |

AppImage:

```bash
chmod +x "PDF Editor-"*.AppImage
./"PDF Editor-"*.AppImage
```

On distributions without FUSE 2 (recent Ubuntu, Fedora) either install it
(`sudo apt install libfuse2t64` / `sudo dnf install fuse`) or run the AppImage
with `--appimage-extract-and-run`.

Debian package:

```bash
sudo apt install ./"PDF Editor-"*.deb     # installs to /opt/PDF Editor
pdf-editor                                 # or use the application menu
```

If the window fails to open on a machine without a usable GPU, start it with
`--disable-gpu`.

## Opening files

There are four ways to get files into the editor; all of them accept PDFs and
PNG/JPEG images (the renderer also converts WebP/GIF/BMP/AVIF when dropped):

1. **Drag and drop** files from your file manager onto the window. Several at
   once are merged in drop order.
2. **File → Open…** (`Ctrl+O` / `Cmd+O`) opens the native file picker with
   multi-select (PDF, PNG, JPEG, WebP, GIF, BMP, AVIF).
3. **"Open with" / double-click** — the installers register PDF Editor as an
   editor for `.pdf` files, so it appears in *Open with* on all platforms. On
   Windows and Linux the app is launched with the file path; on macOS the
   Finder hands the file to the running app. If the app is already open the
   files are appended to the current document instead of starting a second
   instance.
4. **Command line**: `pdf-editor a.pdf b.png` (Linux), `"PDF Editor.exe" a.pdf`
   (Windows), `open -a "PDF Editor" a.pdf` (macOS).

Saving (`Ctrl+S` / `Cmd+S`, or File → Save) always writes a **new PDF** through
the native save dialog; the original files are never modified. Closing the
window with unsaved changes asks whether to save first (*Save…* keeps the window
open and starts the save; close again once it is done).

Zoom in the page editor with `Ctrl+=` / `Ctrl++` / `Ctrl+Numpad +`, out with
`Ctrl+-`, and back to fit-to-width with `Ctrl+0` (`Cmd` on macOS).

Window size and position, and the last folder used in a dialog, are remembered
in `preferences.json` inside the app's user-data folder
(`%APPDATA%\PDF Editor` on Windows, `~/Library/Application Support/PDF Editor`
on macOS, `~/.config/PDF Editor` on Linux). Delete that file to reset them.

## Building from source

Requirements: Node.js 22 (or newer) and npm. Everything else is pulled in by
`npm install` (Electron, electron-builder, Playwright for the tests).

```bash
git clone <repository-url> pdf-editor
cd pdf-editor
npm install
npm run dev          # run the app with hot reload
npm run check        # typecheck + lint + unit tests
npm run package      # installers for the current OS, written to release/
npm run package:dir  # unpacked app in release/<platform>-unpacked (quick smoke test)
```

`npm run package` builds the installers for the operating system it runs on:
NSIS + portable on Windows, dmg + zip on macOS (both architectures when run on
Apple Silicon), AppImage + deb on Linux. Cross-building Windows installers on
Linux additionally needs Wine; the release workflow sidesteps that by building
each OS on its own runner.

The app icon is `build/icon.svg`; regenerate `build/icon.png` (from which
electron-builder derives `.ico`/`.icns`) with:

```bash
node scripts/make-icon.mjs
```

### Running the Electron smoke tests locally

```bash
npm run build
npm run test:e2e:electron                 # Windows / macOS / Linux desktop
xvfb-run -a npm run test:e2e:electron     # headless Linux (CI)
```

The tests launch the built app from `dist/` + `dist-electron/` with a
throw-away user-data directory (`PDF_EDITOR_USER_DATA_DIR`), so your real
preferences are untouched.

### Publishing a release

```bash
npm version 0.2.0            # bumps package.json and creates the v0.2.0 tag
git push --follow-tags
```

The `Release` workflow builds all three platforms and attaches the installers
to a GitHub Release for the tag, with generated release notes. Running the
workflow manually (*Actions → Release → Run workflow*) only builds and uploads
the artifacts without creating a release.
