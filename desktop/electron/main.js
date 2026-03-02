'use strict';

const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require('electron');
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
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const preferredSource = sources.find((source) => source.name === 'Entire Screen') || sources[0];
      if (!preferredSource) {
        callback({ video: null, audio: null });
        return;
      }
      const response = { video: preferredSource };
      if (process.platform === 'win32') {
        // Windows loopback captures system output audio for meeting/interviewer speech.
        response.audio = 'loopback';
      }
      callback(response);
    } catch {
      callback({ video: null, audio: null });
    }
  }, { useSystemPicker: true });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Window control ────────────────────────────────────────────────────

function withWindow(fn) {
  return (...args) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    return fn(...args);
  };
}

ipcMain.handle('set-content-protection', withWindow((_event, enabled) => {
  mainWindow.setContentProtection(enabled);
}));

ipcMain.handle('set-always-on-top', withWindow((_event, enabled) => {
  mainWindow.setAlwaysOnTop(enabled, 'screen-saver');
}));

ipcMain.handle('set-skip-taskbar', withWindow((_event, skip) => {
  mainWindow.setSkipTaskbar(skip);
}));

ipcMain.handle('hide-window', withWindow(() => {
  mainWindow.hide();
}));

ipcMain.handle('show-window', withWindow(() => {
  mainWindow.show();
}));

ipcMain.handle('minimize-window', withWindow(() => {
  mainWindow.minimize();
}));

ipcMain.handle('close-window', withWindow(() => {
  mainWindow.close();
}));

ipcMain.handle('set-opacity', withWindow((_event, opacity) => {
  mainWindow.setOpacity(opacity);
}));

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});
