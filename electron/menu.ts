/**
 * Application menu. Items that the renderer already handles via keyboard
 * (Save, Undo, Redo) display their shortcut but do not register the
 * accelerator, so the keystroke reaches the page; clicking them sends the
 * matching `MenuCommand` instead.
 */
import { Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { APP_NAME } from './types';
import type { MenuCommand } from './types';

export interface MenuHandlers {
  isDev: boolean;
  sendCommand(command: MenuCommand): void;
  showAbout(): void;
}

export function buildMenuTemplate(h: MenuHandlers, platform: NodeJS.Platform = process.platform): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin';
  const label = (text: string): string => (isMac ? text.replace('&', '') : text);
  const command = (cmd: MenuCommand) => (): void => h.sendCommand(cmd);

  const file: MenuItemConstructorOptions = {
    label: label('&File'),
    submenu: [
      { id: 'open', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: command('open') },
      { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: command('save') },
      { type: 'separator' },
      { id: 'close-window', role: 'close', label: 'Close Window' },
      ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { id: 'quit', role: 'quit' } as MenuItemConstructorOptions]),
    ],
  };

  const edit: MenuItemConstructorOptions = {
    label: label('&Edit'),
    submenu: [
      { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: command('undo') },
      {
        id: 'redo',
        label: 'Redo',
        accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
        registerAccelerator: false,
        click: command('redo'),
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac ? [{ role: 'pasteAndMatchStyle' } as MenuItemConstructorOptions, { role: 'delete' } as MenuItemConstructorOptions] : []),
      { role: 'selectAll' },
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: label('&View'),
    submenu: [
      { id: 'zoom-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: command('zoom-in') },
      { id: 'zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: command('zoom-out') },
      { id: 'zoom-reset', label: 'Actual Size (Fit)', accelerator: 'CmdOrCtrl+0', click: command('zoom-reset') },
      // Hidden twins so Ctrl+Shift+= ("Ctrl++") and the numeric keypad work too.
      { id: 'zoom-in-plus', label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', visible: false, click: command('zoom-in') },
      { id: 'zoom-in-numpad', label: 'Zoom In', accelerator: 'CmdOrCtrl+numadd', visible: false, click: command('zoom-in') },
      { id: 'zoom-out-numpad', label: 'Zoom Out', accelerator: 'CmdOrCtrl+numsub', visible: false, click: command('zoom-out') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(h.isDev
        ? [
            { type: 'separator' } as MenuItemConstructorOptions,
            { role: 'reload' } as MenuItemConstructorOptions,
            { role: 'forceReload' } as MenuItemConstructorOptions,
            { role: 'toggleDevTools' } as MenuItemConstructorOptions,
          ]
        : []),
    ],
  };

  const window: MenuItemConstructorOptions = isMac
    ? { role: 'windowMenu' }
    : { label: label('&Window'), submenu: [{ role: 'minimize' }, { role: 'close' }] };

  const help: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [{ id: 'about', label: `About ${APP_NAME}`, click: (): void => h.showAbout() }],
  };

  return [...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []), file, edit, view, window, help];
}

export function installApplicationMenu(h: MenuHandlers): Menu {
  const menu = Menu.buildFromTemplate(buildMenuTemplate(h));
  Menu.setApplicationMenu(menu);
  return menu;
}
