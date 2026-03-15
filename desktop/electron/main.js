'use strict';

const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const rendererUrlOverride = String(process.env.ELECTRON_RENDERER_URL || '').trim();
const rendererHtmlOverride = String(process.env.ELECTRON_RENDERER_HTML || '').trim();
const isolatedUserDataDir = String(process.env.ELECTRON_USER_DATA_DIR || '').trim();
const isDev = !rendererUrlOverride && !rendererHtmlOverride && (
  process.env.NODE_ENV === 'development' || !app.isPackaged
);

if (isolatedUserDataDir) {
  app.setPath('userData', path.resolve(isolatedUserDataDir));
}

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
const HEALTH_CHECK_TIMEOUT_MS = 1500;
const WINDOWS_11_MIN_BUILD = 22_621;

function getWindowsBuildNumber() {
  if (process.platform !== 'win32') return 0;
  const parts = String(os.release() || '').split('.');
  const build = Number(parts[2]);
  return Number.isFinite(build) ? build : 0;
}

function supportsWindowsLiveCaptions() {
  return process.platform === 'win32' && getWindowsBuildNumber() >= WINDOWS_11_MIN_BUILD;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args = [], timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let completed = false;

    const timeoutId = setTimeout(() => {
      if (completed) return;
      completed = true;
      try {
        child.kill();
      } catch {
        // ignore kill errors
      }
      reject(new Error(`Command timed out: ${command}`));
    }, Math.max(1000, timeoutMs));

    child.stdout?.on('data', (buf) => {
      stdout += String(buf || '');
    });
    child.stderr?.on('data', (buf) => {
      stderr += String(buf || '');
    });

    child.once('error', (err) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      reject(err);
    });

    child.once('close', (code) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      resolve({
        code: Number.isInteger(code) ? code : -1,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

async function runPowerShellScript(script, timeoutMs = 8000) {
  const result = await runCommand(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    timeoutMs
  );
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `PowerShell exited with code ${result.code}`);
  }
  return result.stdout.trim();
}

async function isWindowsLiveCaptionsRunning() {
  if (!supportsWindowsLiveCaptions()) return false;
  try {
    const result = await runCommand(
      'tasklist',
      ['/FI', 'IMAGENAME eq LiveCaptions.exe'],
      5000
    );
    return /LiveCaptions\.exe/i.test(result.stdout || '');
  } catch {
    return false;
  }
}

async function sendWindowsLiveCaptionsHotkey() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class KeyboardNative {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@
$VK_LWIN = 0x5B
$VK_CTRL = 0x11
$VK_L = 0x4C
[KeyboardNative]::keybd_event($VK_LWIN, 0, 0, [UIntPtr]::Zero)
[KeyboardNative]::keybd_event($VK_CTRL, 0, 0, [UIntPtr]::Zero)
[KeyboardNative]::keybd_event($VK_L, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
[KeyboardNative]::keybd_event($VK_L, 0, [KeyboardNative]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
[KeyboardNative]::keybd_event($VK_CTRL, 0, [KeyboardNative]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
[KeyboardNative]::keybd_event($VK_LWIN, 0, [KeyboardNative]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
`;
  await runPowerShellScript(script, 5000);
}

async function launchWindowsLiveCaptionsProcess() {
  if (!supportsWindowsLiveCaptions()) return false;
  const launchScripts = [
    '$ErrorActionPreference = "Stop"; Start-Process -FilePath "LiveCaptions" -ErrorAction Stop; Write-Output "ok"',
    '$ErrorActionPreference = "Stop"; Start-Process -FilePath "LiveCaptions.exe" -ErrorAction Stop; Write-Output "ok"',
  ];

  for (const script of launchScripts) {
    try {
      const output = await runPowerShellScript(script, 6000);
      if (String(output || '').toLowerCase().includes('ok')) {
        return true;
      }
    } catch {
      // Try the next launch strategy.
    }
  }
  return false;
}

async function waitForWindowsLiveCaptionsRunning(timeoutMs = 12_000, pollMs = 400) {
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  while (Date.now() < deadline) {
    if (await isWindowsLiveCaptionsRunning()) {
      return true;
    }
    await sleep(Math.max(100, pollMs));
  }
  return false;
}

async function setWindowsLiveCaptionsMicrophoneAudioEnabled(enabled = true) {
  if (!supportsWindowsLiveCaptions()) return false;

  const desiredEnabled = enabled ? '$true' : '$false';
  const script = `
$ErrorActionPreference = "Stop"
$DesiredEnabled = ${desiredEnabled}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Normalize-Text([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return "" }
  return ($value -replace '\\s+', ' ').Trim()
}

function Get-LiveCaptionsWindow {
  $proc = Get-Process -Name LiveCaptions -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $proc) { return $null }

  try {
    if ($proc.MainWindowHandle -ne 0) {
      $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$proc.MainWindowHandle)
      if ($null -ne $window) { return $window }
    }
  } catch {}

  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    try {
      $element = $all[$i]
      $pid = $element.Current.ProcessId
      if ($pid -ne $proc.Id) { continue }
      return $element
    } catch {}
  }
  return $null
}

function Find-ElementByNames([System.Windows.Automation.AutomationElement]$scope, [string[]]$names) {
  if ($null -eq $scope) { return $null }
  $normalizedNames = $names | ForEach-Object { Normalize-Text $_ } | Where-Object { $_ }
  if ($normalizedNames.Count -eq 0) { return $null }

  $all = $scope.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    try {
      $candidate = $all[$i]
      $name = Normalize-Text([string]$candidate.Current.Name)
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      foreach ($expected in $normalizedNames) {
        if ($name -eq $expected) {
          return $candidate
        }
      }
    } catch {}
  }
  return $null
}

function Invoke-Element([System.Windows.Automation.AutomationElement]$element) {
  if ($null -eq $element) { return $false }
  try {
    $invokePattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invokePattern)) {
      $invokePattern.Invoke()
      return $true
    }
  } catch {}
  try {
    $selectionPattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
      $selectionPattern.Select()
      return $true
    }
  } catch {}
  try {
    $expandPattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$expandPattern)) {
      $expandPattern.Expand()
      return $true
    }
  } catch {}
  try {
    $legacyPattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {
      $legacyPattern.DoDefaultAction()
      return $true
    }
  } catch {}
  return $false
}

function Get-CheckedState([System.Windows.Automation.AutomationElement]$element) {
  if ($null -eq $element) { return $null }
  try {
    $togglePattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$togglePattern)) {
      return [string]$togglePattern.Current.ToggleState
    }
  } catch {}
  try {
    $legacyPattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacyPattern)) {
      $state = [int]$legacyPattern.Current.State
      if (($state -band 0x10) -ne 0) { return "On" }
      return "Off"
    }
  } catch {}
  return $null
}

$window = Get-LiveCaptionsWindow
if ($null -eq $window) {
  Write-Output "not_running"
  exit 0
}

$settingsNames = @("Settings", "设置", "設定")
$preferenceNames = @("Preferences", "偏好设置", "偏好設定", "首选项", "喜好設定")
$includeMicNames = @(
  "Include microphone audio",
  "包括麦克风音频",
  "包含麦克风音频",
  "包括麥克風音訊",
  "包含麥克風音訊"
)

$settingsButton = Find-ElementByNames -scope $window -names $settingsNames
if ($null -eq $settingsButton) {
  Write-Output "settings_not_found"
  exit 0
}

if (-not (Invoke-Element $settingsButton)) {
  Write-Output "settings_not_invokable"
  exit 0
}
Start-Sleep -Milliseconds 250

$root = [System.Windows.Automation.AutomationElement]::RootElement
$preferencesItem = Find-ElementByNames -scope $root -names $preferenceNames
if ($null -eq $preferencesItem) {
  Write-Output "preferences_not_found"
  exit 0
}

if (-not (Invoke-Element $preferencesItem)) {
  Write-Output "preferences_not_invokable"
  exit 0
}
Start-Sleep -Milliseconds 250

$includeMicItem = Find-ElementByNames -scope $root -names $includeMicNames
if ($null -eq $includeMicItem) {
  Write-Output "include_mic_not_found"
  exit 0
}

$currentState = Get-CheckedState $includeMicItem
if ($DesiredEnabled -and $currentState -eq "On") {
  Write-Output "already_enabled"
  exit 0
}
if ((-not $DesiredEnabled) -and $currentState -eq "Off") {
  Write-Output "already_disabled"
  exit 0
}

try {
  $togglePattern = $null
  if ($includeMicItem.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$togglePattern)) {
    $togglePattern.Toggle()
    Write-Output "ok"
    exit 0
  }
} catch {}

if (Invoke-Element $includeMicItem) {
  Write-Output "ok"
  exit 0
}

Write-Output "include_mic_not_invokable"
`;

  try {
    const output = String(await runPowerShellScript(script, 10_000) || '').trim().toLowerCase();
    return output.includes('ok') || output.includes('already_enabled');
  } catch {
    return false;
  }
}

async function hideWindowsLiveCaptionsWindowOnce() {
  if (!supportsWindowsLiveCaptions()) return false;
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WindowNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  public const int SW_HIDE = 0;
  public const int SW_SHOWNOACTIVATE = 4;
  public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint SWP_SHOWWINDOW = 0x0040;
}
"@
$proc = Get-Process -Name LiveCaptions -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $proc) { Write-Output "not_running"; exit 0 }
$targets = New-Object System.Collections.Generic.List[IntPtr]
$callback = [WindowNative+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [WindowNative]::IsWindowVisible($hWnd)) { return $true }
  $pid = 0
  [WindowNative]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
  if ($pid -ne [uint32]$proc.Id) { return $true }

  $builder = New-Object System.Text.StringBuilder 512
  [WindowNative]::GetWindowText($hWnd, $builder, $builder.Capacity) | Out-Null
  $title = ($builder.ToString() -replace '\s+', ' ').Trim()
  if ([string]::IsNullOrWhiteSpace($title) -or $title -match '(?i)^live captions$|^实时字幕$|^即時字幕$|^字幕$') {
    [void]$targets.Add($hWnd)
  }
  return $true
}
[WindowNative]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($targets.Count -eq 0 -and $proc.MainWindowHandle -ne 0) {
  [void]$targets.Add([IntPtr]$proc.MainWindowHandle)
}

if ($targets.Count -eq 0) { Write-Output "no_window"; exit 0 }

foreach ($hWnd in $targets) {
  [WindowNative]::ShowWindowAsync($hWnd, [WindowNative]::SW_SHOWNOACTIVATE) | Out-Null
  [WindowNative]::SetWindowPos(
    $hWnd,
    [WindowNative]::HWND_BOTTOM,
    -32000,
    -32000,
    0,
    0,
    [WindowNative]::SWP_NOSIZE -bor [WindowNative]::SWP_NOACTIVATE -bor [WindowNative]::SWP_SHOWWINDOW
  ) | Out-Null
}

Write-Output "ok"
`;
  const output = String(await runPowerShellScript(script, 5000) || '').trim().toLowerCase();
  return output;
}

async function hideWindowsLiveCaptionsWindow() {
  if (!supportsWindowsLiveCaptions()) return false;

  const attempts = 7;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const status = await hideWindowsLiveCaptionsWindowOnce();
      if (status.includes('ok')) {
        return true;
      }
      if (status.includes('not_running')) {
        return false;
      }
    } catch {
      // Retry: the captions window can appear a little after the process boots.
    }
    await sleep(450);
  }
  return false;
}

async function ensureWindowsLiveCaptions(options = {}) {
  const autoHide = options?.autoHide !== false;
  const includeMicrophoneAudio = options?.includeMicrophoneAudio === true;
  const silent = Boolean(options?.silent);

  if (!supportsWindowsLiveCaptions()) {
    const message = process.platform !== 'win32'
      ? 'Windows Live Captions is only available on Windows 11.'
      : `Windows Live Captions requires Windows 11 22H2+ (build ${WINDOWS_11_MIN_BUILD}+).`;
    return {
      ok: false,
      status: 'unsupported',
      message,
      running: false,
      hidden: false,
      silent,
    };
  }

  try {
    let running = await isWindowsLiveCaptionsRunning();
    let launched = false;
    let launchMethod = 'none';
    if (!running) {
      const launchedByProcess = await launchWindowsLiveCaptionsProcess();
      if (launchedByProcess) {
        running = await waitForWindowsLiveCaptionsRunning();
        if (running) {
          launched = true;
          launchMethod = 'process';
        }
      }

      if (!running) {
        await sendWindowsLiveCaptionsHotkey();
        running = await waitForWindowsLiveCaptionsRunning();
        if (running) {
          launched = true;
          launchMethod = 'hotkey';
        }
      }
    }

    if (!running) {
      return {
        ok: false,
        status: 'launch_failed',
        message: 'Unable to start Windows Live Captions automatically. Press Win+Ctrl+L once, then retry.',
        running: false,
        hidden: false,
        silent,
      };
    }

    let microphoneAudioEnabled = false;
    if (includeMicrophoneAudio) {
      try {
        await sleep(350);
        microphoneAudioEnabled = await setWindowsLiveCaptionsMicrophoneAudioEnabled(true);
      } catch {
        microphoneAudioEnabled = false;
      }
    }

    let hidden = false;
    if (autoHide) {
      try {
        await sleep(1_200);
        hidden = await hideWindowsLiveCaptionsWindow();
      } catch {
        hidden = false;
      }
    }

    return {
      ok: true,
      status: launched ? 'launched' : 'running',
      message: launched
        ? `Windows Live Captions started (${launchMethod}).`
        : 'Windows Live Captions already running.',
      running: true,
      hidden,
      microphoneAudioEnabled,
      launchMethod,
      silent,
    };
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      message: `Failed to prepare Windows Live Captions: ${err?.message || err}`,
      running: false,
      hidden: false,
      silent,
    };
  }
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(LOCAL_WHISPER_HEALTH_URL, { method: 'GET', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
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

  if (rendererUrlOverride) {
    mainWindow.loadURL(rendererUrlOverride);
  } else if (rendererHtmlOverride) {
    mainWindow.loadFile(path.resolve(app.getAppPath(), rendererHtmlOverride));
  } else if (isDev) {
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

ipcMain.handle('read-e2e-audio-file', async (_event, filePath) => {
  try {
    const resolvedPath = path.resolve(String(filePath || ''));
    const buffer = await fs.promises.readFile(resolvedPath);
    return {
      ok: true,
      base64: buffer.toString('base64'),
      filePath: resolvedPath,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'Failed to read E2E audio file.',
    };
  }
});

ipcMain.handle('ensure-local-whisper', async () => ensureLocalWhisper());

ipcMain.handle('release-local-whisper', async () => releaseLocalWhisper());

ipcMain.handle('local-whisper-status', async () => ({
  healthy: await isLocalWhisperHealthy(),
  managed: localWhisperManaged,
  leaseCount: localWhisperLeaseCount,
  healthUrl: LOCAL_WHISPER_HEALTH_URL,
}));

ipcMain.handle('ensure-windows-live-captions', async (_event, options) => (
  ensureWindowsLiveCaptions(options || {})
));

ipcMain.handle('hide-windows-live-captions', async () => ({
  ok: await hideWindowsLiveCaptionsWindow(),
}));

ipcMain.handle('windows-live-captions-status', async () => ({
  supported: supportsWindowsLiveCaptions(),
  running: await isWindowsLiveCaptionsRunning(),
  platform: process.platform,
  build: getWindowsBuildNumber(),
}));
