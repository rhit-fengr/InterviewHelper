'use strict';

const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 380,
    minHeight: 540,
    frame: false,
    transparent: false,
    backgroundColor: '#0f141e',
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Keep protection opt-in from renderer settings instead of forcing it on by default.
  mainWindow.setContentProtection(false);

  // Keep window above all others including screen-saver level
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    const failedUrl = validatedURL || '(unknown)';
    const detail = `${errorCode}: ${errorDescription}`;
    console.error('[electron] failed to load renderer:', failedUrl, detail);
    const escaped = String(detail)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const fallbackHtml = `<!doctype html><html><body style="margin:0;background:#0f141e;color:#e2e8f0;font-family:Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><div style="max-width:320px;padding:18px;border:1px solid #334155;border-radius:10px;background:#111827;"><h3 style="margin:0 0 8px 0;font-size:16px;">Interview AI Hamburger</h3><p style="margin:0 0 8px 0;font-size:13px;line-height:1.45;">UI failed to load.</p><p style="margin:0;font-size:12px;opacity:.85;">${escaped}</p></div></body></html>`;
    mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[electron] renderer process gone:', details?.reason || 'unknown');
  });

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

ipcMain.handle('set-zoom-factor', withWindow((_event, factor) => {
  const numeric = Number(factor);
  const safe = Number.isFinite(numeric) ? numeric : 1;
  const clamped = Math.max(0.8, Math.min(1.6, safe));
  mainWindow.webContents.setZoomFactor(clamped);
}));

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});
