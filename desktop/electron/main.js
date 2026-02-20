'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Hide window from screen sharing/recording (macOS native support)
  mainWindow.setContentProtection(true);

  // Keep window above all others including screen-saver level
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../build/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Window control ────────────────────────────────────────────────────

ipcMain.handle('set-content-protection', (_event, enabled) => {
  mainWindow.setContentProtection(enabled);
});

ipcMain.handle('set-always-on-top', (_event, enabled) => {
  mainWindow.setAlwaysOnTop(enabled, 'screen-saver');
});

ipcMain.handle('set-skip-taskbar', (_event, skip) => {
  mainWindow.setSkipTaskbar(skip);
});

ipcMain.handle('hide-window', () => {
  mainWindow.hide();
});

ipcMain.handle('show-window', () => {
  mainWindow.show();
});

ipcMain.handle('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.handle('close-window', () => {
  mainWindow.close();
});

ipcMain.handle('set-opacity', (_event, opacity) => {
  mainWindow.setOpacity(opacity);
});

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});
