'use strict';

const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;
let localWhisperProcess = null;
let localWhisperManaged = false;
let localWhisperLeaseCount = 0;
let localWhisperStartPromise = null;
let localWhisperLastExitCode = null;
let localWhisperRecentLogs = [];

const LOCAL_WHISPER_HEALTH_URL = String(
  process.env.LOCAL_WHISPER_HEALTH_URL || 'http://127.0.0.1:8765/health'
).trim();
const LOCAL_WHISPER_START_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.LOCAL_WHISPER_START_TIMEOUT_MS || 90_000)
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLocalWhisperLog(text) {
  const line = String(text || '').trim();
  if (!line) return;
  localWhisperRecentLogs.push(line);
  if (localWhisperRecentLogs.length > 60) {
    localWhisperRecentLogs = localWhisperRecentLogs.slice(-60);
  }
}

function getLocalWhisperFailureMessage(baseMessage) {
  const recent = localWhisperRecentLogs.slice(-12);
  const joined = recent.join('\n');
  let hint = '';

  if (/python was not found/i.test(joined) || /python.+not found/i.test(joined)) {
    hint = 'Python 3.10+ is required for Local STT. Install Python, reopen the app, and retry.';
  } else if (/no module named/i.test(joined) || /module not found/i.test(joined)) {
    hint = 'Python environment is missing dependencies. Re-run local-whisper setup and retry.';
  }

  const lastLine = recent.length > 0 ? recent[recent.length - 1] : '';
  const extra = [hint, lastLine ? `Last log: ${lastLine}` : ''].filter(Boolean).join(' ');
  return [baseMessage, extra].filter(Boolean).join(' ').trim();
}

function getLocalWhisperPortFromHealthUrl() {
  try {
    const parsed = new URL(LOCAL_WHISPER_HEALTH_URL);
    return parsed.port || '8765';
  } catch {
    return '8765';
  }
}

function resolveLocalWhisperScriptPath() {
  if (isDev) {
    return path.resolve(__dirname, '../../local-whisper-service/start_local_whisper.bat');
  }
  return path.join(process.resourcesPath, 'local-whisper-service', 'start_local_whisper.bat');
}

async function isLocalWhisperHealthy() {
  try {
    const res = await fetch(LOCAL_WHISPER_HEALTH_URL, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

function stopManagedLocalWhisper() {
  if (!localWhisperManaged || !localWhisperProcess) return;

  const pid = localWhisperProcess.pid;
  localWhisperProcess = null;
  localWhisperManaged = false;

  if (!pid) return;
  try {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    // Ignore kill errors.
  }
}

function spawnLocalWhisperProcess() {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      message: 'Auto local-whisper start is currently implemented for Windows packaging/runtime.',
    };
  }

  const scriptPath = resolveLocalWhisperScriptPath();
  if (!fs.existsSync(scriptPath)) {
    return {
      ok: false,
      message: `Local whisper launcher not found: ${scriptPath}`,
    };
  }

  const command = `"${scriptPath}" --quiet`;
  localWhisperRecentLogs = [];
  localWhisperLastExitCode = null;
  const child = spawn(command, {
    cwd: path.dirname(scriptPath),
    env: {
      ...process.env,
      LOCAL_WHISPER_PORT: getLocalWhisperPortFromHealthUrl(),
    },
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (buf) => {
    const lines = String(buf || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      appendLocalWhisperLog(line);
      console.log('[local-whisper]', line);
    }
  });
  child.stderr?.on('data', (buf) => {
    const lines = String(buf || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      appendLocalWhisperLog(line);
      console.error('[local-whisper]', line);
    }
  });

  child.once('exit', (code) => {
    localWhisperLastExitCode = Number.isInteger(code) ? code : -1;
    const exitedPid = child.pid;
    if (localWhisperProcess && localWhisperProcess.pid === exitedPid) {
      localWhisperProcess = null;
      localWhisperManaged = false;
    }
    if (code !== 0) {
      console.error(`[local-whisper] launcher exited with code ${code}`);
    }
  });

  localWhisperProcess = child;
  localWhisperManaged = true;
  return { ok: true, pid: child.pid };
}

async function ensureLocalWhisper() {
  localWhisperLeaseCount += 1;

  if (await isLocalWhisperHealthy()) {
    return {
      ok: true,
      status: localWhisperManaged ? 'managed-running' : 'external-running',
      leaseCount: localWhisperLeaseCount,
    };
  }

  if (!localWhisperStartPromise) {
    localWhisperStartPromise = (async () => {
      const spawnResult = spawnLocalWhisperProcess();
      if (!spawnResult.ok) {
        throw new Error(spawnResult.message || 'Failed to start local whisper service.');
      }
      const expectedPid = spawnResult.pid;
      const deadline = Date.now() + LOCAL_WHISPER_START_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await isLocalWhisperHealthy()) return true;
        if (!localWhisperProcess || localWhisperProcess.pid !== expectedPid) {
          const exitSuffix = localWhisperLastExitCode !== null
            ? ` (exit code ${localWhisperLastExitCode})`
            : '';
          throw new Error(getLocalWhisperFailureMessage(
            `Local whisper launcher exited before health check${exitSuffix}.`
          ));
        }
        await sleep(1_000);
      }
      throw new Error(getLocalWhisperFailureMessage('Timed out waiting for local whisper service health check.'));
    })().finally(() => {
      localWhisperStartPromise = null;
    });
  }

  try {
    await localWhisperStartPromise;
    return {
      ok: true,
      status: 'managed-started',
      leaseCount: localWhisperLeaseCount,
    };
  } catch (err) {
    localWhisperLeaseCount = Math.max(0, localWhisperLeaseCount - 1);
    stopManagedLocalWhisper();
    return {
      ok: false,
      status: 'failed',
      leaseCount: localWhisperLeaseCount,
      message: err?.message || 'Failed to start local whisper service.',
    };
  }
}

function releaseLocalWhisper() {
  localWhisperLeaseCount = Math.max(0, localWhisperLeaseCount - 1);
  if (localWhisperLeaseCount === 0) {
    stopManagedLocalWhisper();
  }
  return {
    ok: true,
    status: localWhisperManaged ? 'managed-running' : 'idle',
    leaseCount: localWhisperLeaseCount,
  };
}

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
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const preferredSource = sources[0];
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
  }, { useSystemPicker: false });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopManagedLocalWhisper();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  localWhisperLeaseCount = 0;
  stopManagedLocalWhisper();
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

ipcMain.handle('ensure-local-whisper', async () => ensureLocalWhisper());

ipcMain.handle('release-local-whisper', async () => releaseLocalWhisper());

ipcMain.handle('local-whisper-status', async () => ({
  healthy: await isLocalWhisperHealthy(),
  managed: localWhisperManaged,
  leaseCount: localWhisperLeaseCount,
  healthUrl: LOCAL_WHISPER_HEALTH_URL,
}));
