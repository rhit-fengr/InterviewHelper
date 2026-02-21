'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Check if running inside Electron
  isElectron: true,
});
