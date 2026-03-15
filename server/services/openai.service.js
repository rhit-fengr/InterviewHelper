'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const OpenAI = require('openai');
const os = require('os');
const path = require('path');

const SUPPORTED_PROVIDERS = ['openai', 'gemini'];
const SUPPORTED_TRANSCRIBE_PROVIDERS = ['openai', 'gemini', 'local', 'windows-live-captions'];
const DEFAULT_PROVIDER = normalizeProvider(process.env.AI_PROVIDER || 'openai');

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_DETECT_MODEL = process.env.OPENAI_DETECT_MODEL || 'gpt-4o-mini';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const DEFAULT_AI_TRANSCRIBE_MAX_BYTES = 5 * 1024 * 1024;
const parsedTranscribeMaxBytes = Number(process.env.AI_TRANSCRIBE_MAX_BYTES);
const AI_TRANSCRIBE_MAX_BYTES =
  Number.isFinite(parsedTranscribeMaxBytes) && parsedTranscribeMaxBytes > 0
    ? parsedTranscribeMaxBytes
    : DEFAULT_AI_TRANSCRIBE_MAX_BYTES;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_DETECT_MODEL = process.env.GEMINI_DETECT_MODEL || GEMINI_MODEL;
const GEMINI_TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL || GEMINI_MODEL;
const GEMINI_BASE_URL = ensureTrailingSlash(
  process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/'
);
const GEMINI_NATIVE_BASE_URL = (
  process.env.GEMINI_NATIVE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'
).replace(/\/+$/, '');
const LOCAL_TRANSCRIBE_URL = String(process.env.LOCAL_TRANSCRIBE_URL || '').trim();
const parsedLocalTranscribeTimeoutMs = Number(process.env.LOCAL_TRANSCRIBE_TIMEOUT_MS);
const LOCAL_TRANSCRIBE_TIMEOUT_MS = Number.isFinite(parsedLocalTranscribeTimeoutMs)
  ? Math.max(5_000, parsedLocalTranscribeTimeoutMs)
  : 20_000;
const parsedLocalTranscribeRetries = Number(process.env.LOCAL_TRANSCRIBE_RETRIES);
const LOCAL_TRANSCRIBE_RETRIES = Number.isFinite(parsedLocalTranscribeRetries)
  ? Math.max(0, parsedLocalTranscribeRetries)
  : 1;
const parsedWindowsCaptionsTimeoutMs = Number(process.env.WINDOWS_CAPTIONS_TIMEOUT_MS);
const WINDOWS_CAPTIONS_TIMEOUT_MS = Number.isFinite(parsedWindowsCaptionsTimeoutMs)
  ? Math.max(800, parsedWindowsCaptionsTimeoutMs)
  : 6_000;
const parsedWindowsCaptionsBridgeIntervalMs = Number(process.env.WINDOWS_CAPTIONS_BRIDGE_INTERVAL_MS);
const WINDOWS_CAPTIONS_BRIDGE_INTERVAL_MS = Number.isFinite(parsedWindowsCaptionsBridgeIntervalMs)
  ? Math.max(250, parsedWindowsCaptionsBridgeIntervalMs)
  : 700;
const parsedWindowsCaptionsBridgeBootTimeoutMs = Number(process.env.WINDOWS_CAPTIONS_BRIDGE_BOOT_TIMEOUT_MS);
const WINDOWS_CAPTIONS_BRIDGE_BOOT_TIMEOUT_MS = Number.isFinite(parsedWindowsCaptionsBridgeBootTimeoutMs)
  ? Math.max(1_500, parsedWindowsCaptionsBridgeBootTimeoutMs)
  : 10_000;
const parsedWindowsCaptionsBridgeStaleMs = Number(process.env.WINDOWS_CAPTIONS_BRIDGE_STALE_MS);
const WINDOWS_CAPTIONS_BRIDGE_STALE_MS = Number.isFinite(parsedWindowsCaptionsBridgeStaleMs)
  ? Math.max(1_000, parsedWindowsCaptionsBridgeStaleMs)
  : 4_500;
const parsedWindowsCaptionsMinProbeIntervalMs = Number(process.env.WINDOWS_CAPTIONS_MIN_PROBE_INTERVAL_MS);
const WINDOWS_CAPTIONS_MIN_PROBE_INTERVAL_MS = Number.isFinite(parsedWindowsCaptionsMinProbeIntervalMs)
  ? Math.max(200, parsedWindowsCaptionsMinProbeIntervalMs)
  : 1_000;
const parsedWindowsCaptionsAutoLaunchCooldownMs = Number(process.env.WINDOWS_CAPTIONS_AUTO_LAUNCH_COOLDOWN_MS);
const WINDOWS_CAPTIONS_AUTO_LAUNCH_COOLDOWN_MS = Number.isFinite(parsedWindowsCaptionsAutoLaunchCooldownMs)
  ? Math.max(1_000, parsedWindowsCaptionsAutoLaunchCooldownMs)
  : 8_000;
const WINDOWS_CAPTIONS_SCRIPT_PATH = path.resolve(__dirname, '../scripts/get_windows_live_caption.ps1');
const WINDOWS_11_MIN_BUILD = 22_621;
const GEMINI_FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ||
  'gemini-2.0-flash,gemini-1.5-flash'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Backward-compatible flag: whether OPENAI_API_KEY exists.
 * Existing tests/routes can keep using this if needed.
 */
const isConfigured = Boolean(process.env.OPENAI_API_KEY);
const isGeminiConfigured = Boolean(process.env.GEMINI_API_KEY);

if (!isConfigured) {
  console.warn('[openai.service] WARNING: OPENAI_API_KEY is not set. OpenAI provider will return 503 until configured.');
}
if (!isGeminiConfigured) {
  console.warn('[openai.service] WARNING: GEMINI_API_KEY is not set. Gemini provider will return 503 until configured.');
}

const clientCache = new Map();

const TOKEN_LIMITS = {
  short: 200,
  medium: 500,
  long: 1000,
};
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.AI_RATE_LIMIT_COOLDOWN_MS || 60_000);
const RATE_LIMIT_MAX_COOLDOWN_MS = Number(process.env.AI_RATE_LIMIT_MAX_COOLDOWN_MS || 300_000);
/** provider -> epoch ms */
const providerCooldownUntil = new Map();
let localWhisperBootPromise = null;
let localWhisperManagedProcess = null;
let localWhisperRecentLogs = [];
let localWhisperLastExitCode = null;
let localWhisperLastStartError = '';
let lastWindowsLiveCaptionsText = '';
let lastWindowsLiveCaptionsLaunchAttemptAt = 0;
let windowsCaptionsProbePromise = null;
let windowsCaptionsProbeCache = {
  at: 0,
  value: null,
};
let windowsCaptionsBridgeProcess = null;
let windowsCaptionsBridgeBootPromise = null;
let windowsCaptionsBridgeLastPayload = null;
let windowsCaptionsBridgeLastPayloadAt = 0;
let windowsCaptionsBridgeLastSeq = 0;
let windowsCaptionsBridgeStdoutBuffer = '';
let windowsCaptionsBridgeLastError = '';
let windowsCaptionsBridgeLastExitCode = null;
let windowsCaptionsBridgeExitHooksRegistered = false;

function ensureTrailingSlash(url) {
  return typeof url === 'string' && !url.endsWith('/')
    ? `${url}/`
    : url;
}

function normalizeProvider(raw) {
  if (!raw || typeof raw !== 'string') return 'openai';
  const normalized = raw.trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(normalized) ? normalized : 'openai';
}

function normalizeTranscribeProvider(raw) {
  if (!raw || typeof raw !== 'string') return 'openai';
  const normalized = raw.trim().toLowerCase();
  return SUPPORTED_TRANSCRIBE_PROVIDERS.includes(normalized) ? normalized : 'openai';
}

function getWindowsBuildNumber() {
  if (process.platform !== 'win32') return 0;
  const parts = String(os.release() || '').split('.');
  const build = Number(parts[2]);
  return Number.isFinite(build) ? build : 0;
}

function supportsWindowsLiveCaptions() {
  return process.platform === 'win32' && getWindowsBuildNumber() >= WINDOWS_11_MIN_BUILD;
}

function isProviderConfigured(provider) {
  const p = normalizeProvider(provider);
  return p === 'gemini' ? isGeminiConfigured : isConfigured;
}

function isTranscribeProviderConfigured(provider) {
  const p = normalizeTranscribeProvider(provider);
  if (p === 'local') return Boolean(LOCAL_TRANSCRIBE_URL);
  if (p === 'windows-live-captions') return supportsWindowsLiveCaptions();
  return isProviderConfigured(p);
}

function getClient(provider) {
  const p = normalizeProvider(provider);
  if (clientCache.has(p)) return clientCache.get(p);

  let client;
  if (p === 'gemini') {
    client = new OpenAI({
      apiKey: process.env.GEMINI_API_KEY || 'placeholder',
      baseURL: GEMINI_BASE_URL,
      maxRetries: 3,
      timeout: 30 * 1000,
    });
  } else {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'placeholder',
      maxRetries: 3,
      timeout: 30 * 1000,
    });
  }

  clientCache.set(p, client);
  return client;
}

function getAnswerModel(provider) {
  const p = normalizeProvider(provider);
  return p === 'gemini' ? GEMINI_MODEL : OPENAI_MODEL;
}

function getDetectModel(provider) {
  const p = normalizeProvider(provider);
  return p === 'gemini' ? GEMINI_DETECT_MODEL : OPENAI_DETECT_MODEL;
}

function isGeminiBadRequest(err) {
  return err?.status === 400;
}

function buildGeminiModelCandidates(primary) {
  return [...new Set([primary, ...GEMINI_FALLBACK_MODELS])];
}

function parseRetryAfterMs(headers = {}) {
  const raw = headers?.['retry-after'];
  if (!raw) return 0;
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && asNumber > 0) {
    return asNumber * 1000;
  }
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return 0;
}

function markProviderRateLimited(provider, err) {
  const retryAfterMs = parseRetryAfterMs(err?.headers);
  const rawCooldownMs = Math.max(RATE_LIMIT_COOLDOWN_MS, retryAfterMs);
  const cooldownMs = Math.min(rawCooldownMs, RATE_LIMIT_MAX_COOLDOWN_MS);
  providerCooldownUntil.set(provider, Date.now() + cooldownMs);
}

function isProviderOnCooldown(provider) {
  const until = providerCooldownUntil.get(provider) || 0;
  return until > Date.now();
}

function getProviderCooldownRemainingMs(provider) {
  const until = providerCooldownUntil.get(provider) || 0;
  return Math.max(0, until - Date.now());
}

function buildRateLimitError(provider) {
  const err = new Error(`Provider "${provider}" is temporarily rate-limited.`);
  err.status = 429;
  err.provider = provider;
  err.retryAfterMs = getProviderCooldownRemainingMs(provider);
  return err;
}

function sanitizeMessages(messages) {
  return (messages || [])
    .filter((m) => ['system', 'user', 'assistant'].includes(m?.role))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content || ''),
    }))
    .filter((m) => m.content.trim().length > 0);
}

function inferExtensionFromMime(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('mpeg')) return 'mp3';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('wav')) return 'wav';
  return 'webm';
}

function normalizeMimeType(mimeType = 'audio/webm') {
  const lower = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return lower || 'audio/webm';
}

function toGeminiAudioMimeType(mimeType = 'audio/webm') {
  const normalized = normalizeMimeType(mimeType);
  if (normalized === 'audio/mp3') return 'audio/mpeg';
  return normalized;
}

function sanitizeLanguageHint(languageHint) {
  const candidate = String(languageHint || '').trim();
  if (!candidate) return '';
  // Keep BCP-47-ish values only.
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(candidate) ? candidate : '';
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
    let finished = false;

    const timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error(`Command timed out: ${command}`));
    }, Math.max(1_000, timeoutMs));

    child.stdout?.on('data', (buf) => {
      stdout += String(buf || '');
    });
    child.stderr?.on('data', (buf) => {
      stderr += String(buf || '');
    });

    child.once('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      reject(err);
    });

    child.once('close', (code) => {
      if (finished) return;
      finished = true;
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
    const result = await runCommand('tasklist', ['/FI', 'IMAGENAME eq LiveCaptions.exe'], 5000);
    return /LiveCaptions\.exe/i.test(result.stdout || '');
  } catch {
    return false;
  }
}

async function launchWindowsLiveCaptionsProcess() {
  if (!supportsWindowsLiveCaptions()) return false;
  const launchScripts = [
    '$ErrorActionPreference = "Stop"; Start-Process -FilePath "LiveCaptions" -ErrorAction Stop; Write-Output "ok"',
    '$ErrorActionPreference = "Stop"; Start-Process -FilePath "LiveCaptions.exe" -ErrorAction Stop; Write-Output "ok"',
  ];

  for (const script of launchScripts) {
    try {
      const output = await runPowerShellScript(script, 6_000);
      if (String(output || '').toLowerCase().includes('ok')) {
        return true;
      }
    } catch {
      // Try the next strategy.
    }
  }
  return false;
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
  await runPowerShellScript(script, 5_000);
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

async function ensureWindowsLiveCaptionsRunning() {
  if (!supportsWindowsLiveCaptions()) return false;
  if (await isWindowsLiveCaptionsRunning()) return true;

  const now = Date.now();
  if (now - lastWindowsLiveCaptionsLaunchAttemptAt < WINDOWS_CAPTIONS_AUTO_LAUNCH_COOLDOWN_MS) {
    return false;
  }
  lastWindowsLiveCaptionsLaunchAttemptAt = now;

  try {
    const launchedByProcess = await launchWindowsLiveCaptionsProcess();
    if (launchedByProcess && await waitForWindowsLiveCaptionsRunning()) {
      return true;
    }
  } catch {
    // Continue with hotkey fallback.
  }

  try {
    await sendWindowsLiveCaptionsHotkey();
    if (await waitForWindowsLiveCaptionsRunning()) {
      return true;
    }
  } catch {
    // ignore and return false
  }

  return false;
}

function appendLocalWhisperLog(text) {
  const line = String(text || '').trim();
  if (!line) return;
  localWhisperRecentLogs.push(line);
  if (localWhisperRecentLogs.length > 80) {
    localWhisperRecentLogs = localWhisperRecentLogs.slice(-80);
  }
}

function getLocalWhisperFailureMessage(baseMessage) {
  const recent = localWhisperRecentLogs.slice(-12);
  const joined = recent.join('\n');
  let hint = '';

  if (/python was not found/i.test(joined) || /python.+not found/i.test(joined)) {
    hint = 'Python 3.10+ is required for local transcription, or bundle runtime/service in the installer build.';
  } else if (/no module named/i.test(joined) || /module not found/i.test(joined)) {
    hint = 'Local whisper dependencies are missing. Re-run local whisper runtime preparation.';
  } else if (/operable program or batch file/i.test(joined)) {
    hint = 'A runtime command failed to start. Verify local-whisper-service/start_local_whisper.bat and bundled runtime files.';
  }

  const lastLine = recent.length > 0 ? recent[recent.length - 1] : '';
  return [baseMessage, hint, lastLine ? `Last log: ${lastLine}` : '']
    .filter(Boolean)
    .join(' ')
    .trim();
}

function isTransientLocalFetchError(err) {
  const code = err?.cause?.code || err?.code || '';
  return [
    'ECONNREFUSED',
    'ECONNRESET',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
  ].includes(code);
}

function getLocalWhisperHealthUrl() {
  try {
    const parsed = new URL(LOCAL_TRANSCRIBE_URL);
    parsed.pathname = '/health';
    parsed.search = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function getLocalWhisperPortFromUrl() {
  try {
    const parsed = new URL(LOCAL_TRANSCRIBE_URL);
    return parsed.port || '8765';
  } catch {
    return '8765';
  }
}

function resolveLocalWhisperLauncherPath() {
  // Server lives in "<repo>/server/services"; launcher is in "<repo>/local-whisper-service".
  return path.resolve(__dirname, '../../local-whisper-service/start_local_whisper.bat');
}

const HEALTH_CHECK_TIMEOUT_MS = 1500;

async function isLocalWhisperHealthy() {
  const healthUrl = getLocalWhisperHealthUrl();
  if (!healthUrl) return false;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function canAutoStartLocalWhisper() {
  if (process.platform !== 'win32') return false;
  if (!LOCAL_TRANSCRIBE_URL) return false;
  try {
    const parsed = new URL(LOCAL_TRANSCRIBE_URL);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

function spawnLocalWhisperForServer() {
  const launcher = resolveLocalWhisperLauncherPath();
  if (!fs.existsSync(launcher)) {
    throw new Error(`local whisper launcher not found: ${launcher}`);
  }
  localWhisperRecentLogs = [];
  localWhisperLastExitCode = null;
  localWhisperLastStartError = '';
  const cmd = `"${launcher}" --quiet`;
  const child = spawn(cmd, {
    shell: true,
    cwd: path.dirname(launcher),
    env: {
      ...process.env,
      LOCAL_WHISPER_PORT: getLocalWhisperPortFromUrl(),
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (buf) => {
    const lines = String(buf || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      appendLocalWhisperLog(line);
      console.log('[local-whisper]', line);
    }
  });
  child.stderr?.on('data', (buf) => {
    const lines = String(buf || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      appendLocalWhisperLog(line);
      console.error('[local-whisper]', line);
    }
  });

  localWhisperManagedProcess = child;
  child.once('exit', (code) => {
    localWhisperLastExitCode = Number.isInteger(code) ? code : -1;
    if (localWhisperManagedProcess && localWhisperManagedProcess.pid === child.pid) {
      localWhisperManagedProcess = null;
    }
    if (code !== 0) {
      console.error(`[local-whisper] launcher exited with code ${code}`);
    }
  });
  return child;
}

async function ensureLocalWhisperRunning() {
  if (!canAutoStartLocalWhisper()) return false;
  if (await isLocalWhisperHealthy()) return true;

  if (!localWhisperBootPromise) {
    localWhisperBootPromise = (async () => {
      const child = spawnLocalWhisperForServer();
      const expectedPid = child?.pid;
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        if (await isLocalWhisperHealthy()) return true;
        if (!localWhisperManagedProcess || localWhisperManagedProcess.pid !== expectedPid) {
          const exitSuffix = localWhisperLastExitCode !== null
            ? ` (exit code ${localWhisperLastExitCode})`
            : '';
          localWhisperLastStartError = getLocalWhisperFailureMessage(
            `Local whisper launcher exited before health check${exitSuffix}.`
          );
          return false;
        }
        await sleep(1000);
      }
      localWhisperLastStartError = getLocalWhisperFailureMessage(
        'Timed out waiting for local whisper service health check.'
      );
      return false;
    })().catch((err) => {
      localWhisperLastStartError = getLocalWhisperFailureMessage(
        err?.message || 'Failed to start local whisper service.'
      );
      return false;
    }).finally(() => {
      localWhisperBootPromise = null;
    });
  }
  return Boolean(await localWhisperBootPromise);
}

function normalizeWindowsCaptionText(text = '') {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (
    /^(change language|include microphone audio|change language include microphone audio)$/i.test(cleaned)
    || /^(更改语言|切换语言|包括麦克风音频|包含麦克风音频|包含麥克風音訊|包括麥克風音訊)$/u.test(cleaned)
  ) {
    return '';
  }
  return cleaned;
}

function toComparableCaptionChars(text = '') {
  return Array.from(String(text || ''))
    .map((char) => {
      const lower = char.toLowerCase();
      return /[\p{L}\p{N}\u4e00-\u9fa5]/u.test(lower) ? lower : '';
    })
    .filter(Boolean);
}

function findComparableCommonPrefix(current = '', previous = '') {
  const left = String(previous || '');
  const right = String(current || '');
  let leftIndex = 0;
  let rightIndex = 0;
  let matchedComparableChars = 0;
  let lastMatchedRightRawIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    const leftChar = left[leftIndex];
    const rightChar = right[rightIndex];
    const leftComparable = /[\p{L}\p{N}\u4e00-\u9fa5]/u.test(leftChar) ? leftChar.toLowerCase() : '';
    const rightComparable = /[\p{L}\p{N}\u4e00-\u9fa5]/u.test(rightChar) ? rightChar.toLowerCase() : '';

    if (!leftComparable) {
      leftIndex += 1;
      continue;
    }
    if (!rightComparable) {
      rightIndex += 1;
      continue;
    }
    if (leftComparable !== rightComparable) break;

    matchedComparableChars += 1;
    leftIndex += 1;
    rightIndex += 1;
    lastMatchedRightRawIndex = rightIndex;
  }

  return {
    matchedComparableChars,
    rawCurrentSliceIndex: lastMatchedRightRawIndex,
  };
}

function computeWindowsCaptionDelta(nextText = '') {
  const current = normalizeWindowsCaptionText(nextText);
  if (!current) {
    lastWindowsLiveCaptionsText = '';
    return '';
  }

  const previous = lastWindowsLiveCaptionsText;
  lastWindowsLiveCaptionsText = current;
  if (!previous) return current;
  if (current === previous) return '';
  if (current.startsWith(previous)) {
    return current.slice(previous.length).trim();
  }

  const currentComparable = toComparableCaptionChars(current);
  const previousComparable = toComparableCaptionChars(previous);
  if (currentComparable.length === 0) return '';
  if (previousComparable.length === 0) return current;

  const prefixInfo = findComparableCommonPrefix(current, previous);
  const matchedRatioAgainstPrevious = prefixInfo.matchedComparableChars / Math.max(1, previousComparable.length);
  const matchedRatioAgainstCurrent = prefixInfo.matchedComparableChars / Math.max(1, currentComparable.length);

  if (matchedRatioAgainstCurrent >= 0.98 && currentComparable.length <= previousComparable.length) {
    return '';
  }

  if (
    prefixInfo.matchedComparableChars >= 12
    && matchedRatioAgainstPrevious >= 0.55
    && prefixInfo.rawCurrentSliceIndex < current.length
  ) {
    return current.slice(prefixInfo.rawCurrentSliceIndex).trim();
  }

  if (previous.includes(current)) return '';
  if (current.includes(previous)) {
    const index = current.indexOf(previous);
    return current.slice(index + previous.length).trim();
  }

  return current;
}

function normalizeWindowsProbePayload(rawPayload = {}) {
  const parsed = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  return {
    ok: parsed.ok === true,
    status: String(parsed.status || '').trim().toLowerCase() || 'unknown',
    text: String(parsed.text || '').trim(),
    error: String(parsed.error || '').trim(),
  };
}

function parseWindowsProbeLine(rawLine = '') {
  const line = String(rawLine || '').trim();
  if (!line) return null;
  try {
    return normalizeWindowsProbePayload(JSON.parse(line));
  } catch {
    return null;
  }
}

function stopWindowsCaptionsBridge() {
  const child = windowsCaptionsBridgeProcess;
  windowsCaptionsBridgeProcess = null;
  windowsCaptionsBridgeBootPromise = null;
  windowsCaptionsBridgeStdoutBuffer = '';
  if (!child) return;
  try {
    child.kill();
  } catch {
    // ignore kill errors
  }
}

function registerWindowsCaptionsExitHooks() {
  if (windowsCaptionsBridgeExitHooksRegistered) return;
  windowsCaptionsBridgeExitHooksRegistered = true;
  process.once('exit', stopWindowsCaptionsBridge);
  process.once('SIGINT', () => {
    stopWindowsCaptionsBridge();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    stopWindowsCaptionsBridge();
    process.exit(0);
  });
}

function handleWindowsCaptionsBridgeStdout(chunk) {
  windowsCaptionsBridgeStdoutBuffer += String(chunk || '');
  const lines = windowsCaptionsBridgeStdoutBuffer.split(/\r?\n/);
  windowsCaptionsBridgeStdoutBuffer = lines.pop() || '';
  for (const line of lines) {
    const payload = parseWindowsProbeLine(line);
    if (!payload) continue;
    windowsCaptionsBridgeLastPayload = payload;
    windowsCaptionsBridgeLastPayloadAt = Date.now();
    windowsCaptionsBridgeLastSeq += 1;
  }
}

function spawnWindowsCaptionsBridge() {
  if (!supportsWindowsLiveCaptions()) {
    const err = new Error(
      process.platform !== 'win32'
        ? 'Windows Live Captions provider is only available on Windows.'
        : `Windows Live Captions requires Windows 11 22H2+ (build ${WINDOWS_11_MIN_BUILD}+).`
    );
    err.status = 503;
    throw err;
  }
  if (!fs.existsSync(WINDOWS_CAPTIONS_SCRIPT_PATH)) {
    const err = new Error(`Windows captions probe script not found: ${WINDOWS_CAPTIONS_SCRIPT_PATH}`);
    err.status = 503;
    throw err;
  }

  registerWindowsCaptionsExitHooks();
  windowsCaptionsBridgeLastError = '';
  windowsCaptionsBridgeLastExitCode = null;

  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', WINDOWS_CAPTIONS_SCRIPT_PATH,
    '-Watch',
    '-IntervalMs', String(WINDOWS_CAPTIONS_BRIDGE_INTERVAL_MS),
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', handleWindowsCaptionsBridgeStdout);
  child.stderr?.on('data', (buf) => {
    const line = String(buf || '').trim();
    if (!line) return;
    windowsCaptionsBridgeLastError = line;
  });
  child.once('error', (err) => {
    windowsCaptionsBridgeLastError = String(err?.message || err || 'Unknown bridge spawn error');
    windowsCaptionsBridgeLastExitCode = -1;
  });
  child.once('close', (code) => {
    windowsCaptionsBridgeLastExitCode = Number.isInteger(code) ? code : -1;
    if (windowsCaptionsBridgeProcess && windowsCaptionsBridgeProcess.pid === child.pid) {
      windowsCaptionsBridgeProcess = null;
    }
  });

  windowsCaptionsBridgeProcess = child;
  return child;
}

function isWindowsCaptionsBridgeAlive() {
  return Boolean(
    windowsCaptionsBridgeProcess
      && windowsCaptionsBridgeProcess.exitCode === null
      && !windowsCaptionsBridgeProcess.killed
  );
}

async function ensureWindowsCaptionsBridgeRunning() {
  if (isWindowsCaptionsBridgeAlive()) return true;

  if (!windowsCaptionsBridgeBootPromise) {
    windowsCaptionsBridgeBootPromise = (async () => {
      const startSeq = windowsCaptionsBridgeLastSeq;
      const child = spawnWindowsCaptionsBridge();
      const deadline = Date.now() + WINDOWS_CAPTIONS_BRIDGE_BOOT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (!isWindowsCaptionsBridgeAlive() || windowsCaptionsBridgeProcess?.pid !== child.pid) {
          const suffix = windowsCaptionsBridgeLastExitCode !== null
            ? ` (exit code ${windowsCaptionsBridgeLastExitCode})`
            : '';
          const err = new Error(
            `Windows Live Captions bridge exited before first payload${suffix}. ${windowsCaptionsBridgeLastError}`.trim()
          );
          err.status = 503;
          throw err;
        }
        if (windowsCaptionsBridgeLastSeq > startSeq) {
          return true;
        }
        await sleep(120);
      }

      const timeoutErr = new Error('Windows Live Captions bridge did not become ready in time.');
      timeoutErr.status = 504;
      throw timeoutErr;
    })().finally(() => {
      windowsCaptionsBridgeBootPromise = null;
    });
  }

  return windowsCaptionsBridgeBootPromise;
}

async function runWindowsCaptionsProbe({ maxWaitMs = WINDOWS_CAPTIONS_TIMEOUT_MS, preferFresh = true } = {}) {
  await ensureWindowsCaptionsBridgeRunning();

  const waitMs = Math.max(400, Number(maxWaitMs) || WINDOWS_CAPTIONS_TIMEOUT_MS);
  const deadline = Date.now() + waitMs;
  const startSeq = windowsCaptionsBridgeLastSeq;
  const now = Date.now();
  const currentAge = now - windowsCaptionsBridgeLastPayloadAt;

  if (windowsCaptionsBridgeLastPayload && (!preferFresh || currentAge <= WINDOWS_CAPTIONS_BRIDGE_STALE_MS)) {
    return windowsCaptionsBridgeLastPayload;
  }

  while (Date.now() < deadline) {
    if (!isWindowsCaptionsBridgeAlive()) {
      const err = new Error(
        `Windows Live Captions bridge stopped unexpectedly. ${windowsCaptionsBridgeLastError}`.trim()
      );
      err.status = 503;
      throw err;
    }
    if (windowsCaptionsBridgeLastPayload && windowsCaptionsBridgeLastSeq > startSeq) {
      return windowsCaptionsBridgeLastPayload;
    }
    await sleep(120);
  }

  if (windowsCaptionsBridgeLastPayload) {
    return windowsCaptionsBridgeLastPayload;
  }
  const err = new Error('Windows Live Captions probe timed out.');
  err.status = 504;
  throw err;
}

async function runWindowsCaptionsProbeCached() {
  const now = Date.now();
  const cachedValue = windowsCaptionsProbeCache.value;
  if (cachedValue && (now - windowsCaptionsProbeCache.at) < WINDOWS_CAPTIONS_MIN_PROBE_INTERVAL_MS) {
    return cachedValue;
  }

  if (!windowsCaptionsProbePromise) {
    windowsCaptionsProbePromise = runWindowsCaptionsProbe({
      maxWaitMs: WINDOWS_CAPTIONS_TIMEOUT_MS,
      preferFresh: true,
    })
      .then((result) => {
        windowsCaptionsProbeCache = {
          at: Date.now(),
          value: result,
        };
        return result;
      })
      .finally(() => {
        windowsCaptionsProbePromise = null;
      });
  }

  if (cachedValue) {
    return cachedValue;
  }
  return windowsCaptionsProbePromise;
}

async function transcribeWithWindowsLiveCaptions({ sourceMode }) {
  const normalizedSourceMode = String(sourceMode || '').trim().toLowerCase();
  if (normalizedSourceMode && normalizedSourceMode !== 'system') {
    // This provider is intended for system/interviewer stream only.
    return '';
  }

  let result;
  try {
    result = await runWindowsCaptionsProbeCached();
  } catch (err) {
    // Probe timeout is a soft failure in real-time polling mode.
    if (Number(err?.status) === 504) return '';
    throw err;
  }

  if (result && result.ok === false && String(result.status || '').toLowerCase() === 'not_running') {
    await ensureWindowsLiveCaptionsRunning();
    windowsCaptionsProbeCache = { at: 0, value: null };
    try {
      result = await runWindowsCaptionsProbe({
        maxWaitMs: WINDOWS_CAPTIONS_TIMEOUT_MS,
        preferFresh: true,
      });
      windowsCaptionsProbeCache = { at: Date.now(), value: result };
    } catch (err) {
      if (Number(err?.status) === 504) return '';
      throw err;
    }
  }

  if (result && result.ok === false) {
    return '';
  }
  return computeWindowsCaptionDelta(result?.text || '');
}

function extractGeminiText(response = {}) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
}

async function transcribeWithGemini({ audioBuffer, mimeType, languageHint }) {
  const model = encodeURIComponent(GEMINI_TRANSCRIBE_MODEL);
  const url = `${GEMINI_NATIVE_BASE_URL}/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const normalizedLang = sanitizeLanguageHint(languageHint);
  const languageHintLine = normalizedLang
    ? `Language hint: ${normalizedLang}. Keep the output in this language when possible.`
    : 'No language hint provided. Detect language automatically.';

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              'You are a speech-to-text engine.',
              'Transcribe the provided audio exactly.',
              'Do not add commentary.',
              languageHintLine,
            ].join(' '),
          },
          {
            inlineData: {
              mimeType: toGeminiAudioMimeType(mimeType),
              data: audioBuffer.toString('base64'),
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body?.error?.message || `Gemini transcription failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  const body = await response.json();
  const text = extractGeminiText(body);
  if (!text) {
    const err = new Error(
      'Gemini returned empty transcription for this chunk. For stable real-time STT, use OpenAI Whisper.'
    );
    err.status = 502;
    throw err;
  }
  return text;
}

async function transcribeWithLocal({ audioBuffer, mimeType, languageHint, allowAutoStart = true }) {
  if (!LOCAL_TRANSCRIBE_URL) {
    const err = new Error('Audio transcription requires LOCAL_TRANSCRIBE_URL for local provider.');
    err.status = 503;
    throw err;
  }

  const normalizedMime = normalizeMimeType(mimeType);
  const ext = inferExtensionFromMime(normalizedMime);
  const fileName = `chunk.${ext}`;

  const normalizedLang = sanitizeLanguageHint(languageHint);
  let response;
  let lastFetchError = null;

  for (let attempt = 0; attempt <= LOCAL_TRANSCRIBE_RETRIES; attempt += 1) {
    const form = new FormData();
    form.append('audio', new Blob([audioBuffer], { type: normalizedMime }), fileName);
    if (normalizedLang) form.append('language', normalizedLang);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOCAL_TRANSCRIBE_TIMEOUT_MS);
    try {
      response = await fetch(LOCAL_TRANSCRIBE_URL, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      lastFetchError = null;
      break;
    } catch (err) {
      clearTimeout(timeout);
      lastFetchError = err;
      if (attempt >= LOCAL_TRANSCRIBE_RETRIES || !isTransientLocalFetchError(err)) {
        break;
      }
      await sleep(250 * (attempt + 1));
    }
  }

  if (!response) {
    if (
      allowAutoStart &&
      canAutoStartLocalWhisper() &&
      isTransientLocalFetchError(lastFetchError)
    ) {
      const started = await ensureLocalWhisperRunning();
      if (started) {
        return transcribeWithLocal({
          audioBuffer,
          mimeType,
          languageHint,
          allowAutoStart: false,
        });
      }
    }
    if (lastFetchError?.name === 'AbortError') {
      const timeoutErr = new Error(
        `Local transcription timed out after ${Math.ceil(LOCAL_TRANSCRIBE_TIMEOUT_MS / 1000)}s.`
      );
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    const details = localWhisperLastStartError
      || (lastFetchError?.cause?.code ? `Last error code: ${lastFetchError.cause.code}.` : '');
    const fetchErr = new Error([
      'Cannot reach local transcription service. Check that local whisper is running.',
      details,
    ].filter(Boolean).join(' '));
    fetchErr.status = 503;
    throw fetchErr;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body?.error || body?.message || body?.detail || `Local transcription failed (${response.status})`;
    if (/tuple index out of range|invalid data found when processing input/i.test(String(message))) {
      // Corrupted/partial container chunks happen in real-time recording. Skip this chunk.
      return '';
    }
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  const body = await response.json().catch(() => ({}));
  return String(body?.text || body?.transcript || '').trim();
}

/**
 * Build a system prompt personalised for the candidate.
 */
function buildSystemPrompt(personalInfo = {}, answerSettings = {}, setup = {}) {
  return `You are an expert interview coach helping ${personalInfo.fullName || 'the candidate'} in a ${setup.topic || 'general'} interview.

Candidate Profile:
- Role: ${personalInfo.currentRole || 'Not specified'}
- Company: ${personalInfo.company || 'Not specified'}
- Experience: ${personalInfo.yearsOfExperience || 'Not specified'} years
- Skills: ${personalInfo.skills || 'Not specified'}
- Work History: ${personalInfo.workHistory || 'Not specified'}
- Education: ${personalInfo.education || 'Not specified'}

Answer Settings:
- Structure: ${answerSettings.behavioralStructure || 'STAR'} (use for behavioral questions)
- Style: ${answerSettings.responseStyle || 'conversational'}
- Length: ${answerSettings.answerLength || 'medium'}
- Answer Language: ${setup.answerLang || 'en-US'}

Additional Context: ${setup.customInstructions || 'None'}

Respond naturally as if the candidate is speaking. Do not mention you are an AI. Keep answers focused and well-structured.`.trim();
}

/**
 * Generate a streaming AI answer for the given question.
 * Returns a provider stream object compatible with `for await ... of`.
 */
async function generateAnswer({
  provider,
  question,
  personalInfo,
  answerSettings,
  setup,
  conversationHistory = [],
}) {
  const selectedProvider = normalizeProvider(provider || setup?.aiProvider);
  if (isProviderOnCooldown(selectedProvider)) {
    throw buildRateLimitError(selectedProvider);
  }
  const client = getClient(selectedProvider);
  const systemPrompt = buildSystemPrompt(personalInfo, answerSettings, setup);
  const maxTokens = TOKEN_LIMITS[answerSettings?.answerLength] || TOKEN_LIMITS.medium;

  const messages = sanitizeMessages([
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-(answerSettings?.memoryLimit || 10)),
    { role: 'user', content: question },
  ]);

  const requestPayload = {
    model: getAnswerModel(selectedProvider),
    messages,
    stream: true,
  };
  if (selectedProvider !== 'gemini') {
    requestPayload.max_tokens = maxTokens;
  }

  try {
    return await client.chat.completions.create(requestPayload);
  } catch (err) {
    // Gemini's OpenAI-compatible endpoint can return HTTP 400 for payloads that are valid for
    // OpenAI (e.g., long or complex conversation histories or certain role combinations).
    // In that case, retry with model/payload fallbacks to maximize compatibility.
    if (err?.status === 429) {
      markProviderRateLimited(selectedProvider, err);
      throw err;
    }

    if (selectedProvider === 'gemini' && isGeminiBadRequest(err)) {
      const candidates = buildGeminiModelCandidates(getAnswerModel(selectedProvider));
      const minimalWithSystem = sanitizeMessages([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ]);
      const userOnly = sanitizeMessages([{ role: 'user', content: question }]);

      for (const model of candidates) {
        try {
          return await client.chat.completions.create({
            model,
            messages: minimalWithSystem,
            stream: true,
          });
        } catch (retryErr) {
          if (retryErr?.status === 429) {
            markProviderRateLimited(selectedProvider, retryErr);
            throw retryErr;
          }
          if (!isGeminiBadRequest(retryErr)) throw retryErr;
        }

        try {
          return await client.chat.completions.create({
            model,
            messages: userOnly,
            stream: true,
          });
        } catch (retryErr) {
          if (retryErr?.status === 429) {
            markProviderRateLimited(selectedProvider, retryErr);
            throw retryErr;
          }
          if (!isGeminiBadRequest(retryErr)) throw retryErr;
        }
      }
    }
    throw err;
  }
}

async function transcribeAudioChunk({
  provider,
  audioBuffer,
  mimeType = 'audio/webm',
  languageHint,
  sourceMode = 'unknown',
}) {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    const err = new Error('audio chunk is required');
    err.status = 400;
    throw err;
  }

  if (audioBuffer.length > AI_TRANSCRIBE_MAX_BYTES) {
    const err = new Error(`audio chunk exceeds max size (${AI_TRANSCRIBE_MAX_BYTES} bytes)`);
    err.status = 413;
    throw err;
  }

  const transcriptionProvider = normalizeTranscribeProvider(provider);

  if (!isTranscribeProviderConfigured(transcriptionProvider)) {
    const err = new Error(
      transcriptionProvider === 'gemini'
        ? 'Audio transcription requires GEMINI_API_KEY.'
        : transcriptionProvider === 'local'
          ? 'Audio transcription requires LOCAL_TRANSCRIBE_URL.'
          : transcriptionProvider === 'windows-live-captions'
            ? `Windows Live Captions provider requires Windows 11 22H2+ (build ${WINDOWS_11_MIN_BUILD}+) and enabled accessibility captions.`
        : 'Audio transcription requires OPENAI_API_KEY.'
    );
    err.status = 503;
    throw err;
  }

  if (isProviderOnCooldown(transcriptionProvider)) {
    throw buildRateLimitError(transcriptionProvider);
  }

  try {
    if (transcriptionProvider === 'windows-live-captions') {
      return await transcribeWithWindowsLiveCaptions({ sourceMode });
    }
    if (transcriptionProvider === 'gemini') {
      return await transcribeWithGemini({ audioBuffer, mimeType, languageHint });
    }
    if (transcriptionProvider === 'local') {
      return await transcribeWithLocal({ audioBuffer, mimeType, languageHint });
    }

    const client = getClient(transcriptionProvider);
    const file = await OpenAI.toFile(
      audioBuffer,
      `chunk.${inferExtensionFromMime(mimeType)}`,
      { type: normalizeMimeType(mimeType) }
    );

    const payload = {
      file,
      model: OPENAI_TRANSCRIBE_MODEL,
    };
    const normalizedLang = sanitizeLanguageHint(languageHint);
    if (normalizedLang) payload.language = normalizedLang;

    const result = await client.audio.transcriptions.create(payload);
    return String(result?.text || '').trim();
  } catch (err) {
    if (err?.status === 429) {
      markProviderRateLimited(transcriptionProvider, err);
      throw buildRateLimitError(transcriptionProvider);
    }
    throw err;
  }
}

function tryParseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;

  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenced?.[1]) return null;
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return null;
    }
  }
}

/**
 * Detect whether a transcript contains an interview question.
 * Returns { isQuestion: boolean, question: string|null }.
 */
async function detectQuestion(transcript, sensitivity = 'medium', provider) {
  const selectedProvider = normalizeProvider(provider);
  if (isProviderOnCooldown(selectedProvider)) {
    return heuristicQuestionDetection(transcript);
  }
  const client = getClient(selectedProvider);
  const sensitivityPrompts = {
    low: 'Only return true if there is a very clear, explicit question with a question mark.',
    medium: 'Return true for clear questions and reasonably implied questions.',
    high: 'Return true for explicit questions, implicit questions, and subtle prompts like "tell me about..." or "walk me through..."',
  };

  const requestPayload = {
    model: getDetectModel(selectedProvider),
    messages: [
      {
        role: 'user',
        content: `Transcript: "${transcript}"\n\n${sensitivityPrompts[sensitivity] || sensitivityPrompts.medium}\n\nReturn valid JSON only: {"isQuestion": boolean, "question": "extracted question or null"}`,
      },
    ],
  };
  if (selectedProvider !== 'gemini') {
    requestPayload.max_tokens = 150;
  }

  let response;
  try {
    response = await client.chat.completions.create(requestPayload);
  } catch (err) {
    if (err?.status === 429) {
      markProviderRateLimited(selectedProvider, err);
      return heuristicQuestionDetection(transcript);
    }

    if (selectedProvider === 'gemini' && isGeminiBadRequest(err)) {
      console.warn('[detectQuestion] Gemini returned 400; using heuristic fallback.');
      return heuristicQuestionDetection(transcript);
    }
    throw err;
  }

  const raw = response.choices?.[0]?.message?.content || '';
  const parsed = tryParseJson(raw);

  if (parsed && typeof parsed.isQuestion === 'boolean') {
    return {
      isQuestion: parsed.isQuestion,
      question: parsed.question || null,
    };
  }

  // Fallback: basic heuristic based on position of the last '?' and log usage for monitoring.
  console.warn('[detectQuestion] Falling back to heuristic question detection; raw response was not valid JSON:', raw);

  return heuristicQuestionDetection(transcript);
}

function heuristicQuestionDetection(transcript) {
  const text = typeof transcript === 'string' ? transcript.trim() : '';
  let fallbackIsQuestion = false;
  let fallbackQuestion = null;

  if (text) {
    const lastQuestionMarkIndex = text.lastIndexOf('?');

    if (lastQuestionMarkIndex !== -1) {
      // Consider it a question only if the '?' is at/near the end (little or no trailing text).
      const trailingText = text.slice(lastQuestionMarkIndex + 1).trim();
      if (trailingText.length === 0 || trailingText.length <= 20) {
        fallbackIsQuestion = true;

        // Extract the likely question: from the last sentence boundary up to and including the '?'.
        const lastPeriod = text.lastIndexOf('.', lastQuestionMarkIndex);
        const lastExclamation = text.lastIndexOf('!', lastQuestionMarkIndex);
        const lastNewline = text.lastIndexOf('\n', lastQuestionMarkIndex);
        const lastBoundary = Math.max(lastPeriod, lastExclamation, lastNewline);

        fallbackQuestion = text
          .slice(lastBoundary + 1, lastQuestionMarkIndex + 1)
          .trim();

        if (!fallbackQuestion) {
          fallbackQuestion = text;
        }
      }
    }
  }

  return {
    isQuestion: fallbackIsQuestion,
    question: fallbackIsQuestion ? fallbackQuestion : null,
  };
}

module.exports = {
  generateAnswer,
  detectQuestion,
  transcribeAudioChunk,
  buildSystemPrompt,
  normalizeProvider,
  normalizeTranscribeProvider,
  isProviderConfigured,
  isTranscribeProviderConfigured,
  getProviderCooldownRemainingMs,
  isConfigured,
  AI_TRANSCRIBE_MAX_BYTES,
};
