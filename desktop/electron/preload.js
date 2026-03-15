'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function readE2EScenarioConfig() {
  const rawConfig = String(process.env.ELECTRON_E2E_SCENARIO_JSON || '').trim();
  if (!rawConfig) return null;

  try {
    return JSON.parse(rawConfig);
  } catch (error) {
    console.error('[electron preload] failed to load E2E scenario config:', error);
    return {
      error: 'Failed to parse E2E scenario config from ELECTRON_E2E_SCENARIO_JSON',
    };
  }
}

const e2eScenarioConfig = readE2EScenarioConfig();

// Expose a safe, controlled API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Window management
  setContentProtection: (enabled) => ipcRenderer.invoke('set-content-protection', enabled),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('set-always-on-top', enabled),
  setSkipTaskbar: (skip) => ipcRenderer.invoke('set-skip-taskbar', skip),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  setOpacity: (opacity) => ipcRenderer.invoke('set-opacity', opacity),
  setZoomFactor: (factor) => ipcRenderer.invoke('set-zoom-factor', factor),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  ensureLocalWhisper: () => ipcRenderer.invoke('ensure-local-whisper'),
  releaseLocalWhisper: () => ipcRenderer.invoke('release-local-whisper'),
  getLocalWhisperStatus: () => ipcRenderer.invoke('local-whisper-status'),
  ensureWindowsLiveCaptions: (options = {}) => ipcRenderer.invoke('ensure-windows-live-captions', options),
  hideWindowsLiveCaptions: () => ipcRenderer.invoke('hide-windows-live-captions'),
  getWindowsLiveCaptionsStatus: () => ipcRenderer.invoke('windows-live-captions-status'),

  // Check if running inside Electron
  isElectron: true,
});

contextBridge.exposeInMainWorld('electronE2E', {
  config: e2eScenarioConfig,
});
