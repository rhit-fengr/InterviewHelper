function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
    ...init,
  });
}

function createSSEStream(events = []) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const event of events) {
        if (event.delayMs) {
          await delay(event.delayMs);
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`));
      }
      controller.close();
    },
  });
}

function normalizeConfig(config) {
  const capture = config?.capture || {};
  const screenshot = config?.screenshot || {};
  return {
    name: String(config?.name || 'unnamed-e2e-scenario'),
    fixtures: Array.isArray(config?.fixtures) ? config.fixtures : [],
    capture: {
      mic: {
        eager: capture.mic?.eager === true,
        emissions: Array.isArray(capture.mic?.emissions) ? capture.mic.emissions : [],
      },
      system: {
        eager: capture.system?.eager === true,
        emissions: Array.isArray(capture.system?.emissions) ? capture.system.emissions : [],
      },
    },
    detectQuestion: Array.isArray(config?.detectQuestion) ? config.detectQuestion : [],
    screenshot: {
      imageDataUrl: typeof screenshot.imageDataUrl === 'string' ? screenshot.imageDataUrl : '',
      question: typeof screenshot.question === 'string' ? screenshot.question : '',
      answer: typeof screenshot.answer === 'string' ? screenshot.answer : '',
    },
    answer: Array.isArray(config?.answer?.events)
      ? config.answer.events
      : [{ data: { text: 'Mock answer' } }, { data: { done: true } }],
  };
}

function decodeBase64ToArrayBuffer(base64 = '') {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function createCanvasStream(label = 'system') {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#38bdf8';
    context.font = '24px Segoe UI';
    context.fillText(`E2E ${label}`, 24, 48);
    context.fillStyle = '#94a3b8';
    context.font = '18px Segoe UI';
    context.fillText(`frame ${tick}`, 24, 88);
  }, 100);
  const stream = canvas.captureStream(10);
  stream.__e2eCleanup = () => clearInterval(timer);
  return stream;
}

function tagTrackSource(track, sourceMode) {
  if (track) {
    track.__e2eSourceMode = sourceMode;
  }
  return track;
}

function attachStreamCleanup(stream, cleanup) {
  let cleaned = false;
  const runCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };

  for (const track of stream.getTracks()) {
    const originalStop = typeof track.stop === 'function' ? track.stop.bind(track) : null;
    track.stop = () => {
      originalStop?.();
      runCleanup();
    };
  }

  stream.__e2eCleanup = runCleanup;
}

function createScenarioRuntime(config) {
  const fixturesById = Object.fromEntries((config.fixtures || []).map((fixture) => [fixture.id, fixture]));
  const transcriptQueues = {
    mic: [],
    system: [],
  };
  const scheduledSources = new Set();
  const debug = {
    enqueuedBySource: { mic: 0, system: 0 },
    dequeuedBySource: { mic: 0, system: 0 },
    lastDequeuedTextBySource: { mic: '', system: '' },
  };

  return {
    fixturesById,
    debug,
    scheduleSourceEmissions(sourceMode, emissions = []) {
      const key = `${sourceMode}`;
      if (scheduledSources.has(key)) return;
      scheduledSources.add(key);

      for (const emission of emissions) {
        setTimeout(() => {
          this.enqueueTranscript(sourceMode, {
            text: String(emission.text || fixturesById[emission.fixtureId]?.text || ''),
            delayMs: Number(emission.delayMs) || 0,
            fixtureId: emission.fixtureId,
          });
        }, Math.max(0, Number(emission.atMs) || 0) + 120);
      }
    },
    dequeueTranscript(sourceMode) {
      const queue = transcriptQueues[sourceMode] || [];
      const next = queue.length > 0 ? queue.shift() : null;
      if (next) {
        debug.dequeuedBySource[sourceMode] = (debug.dequeuedBySource[sourceMode] || 0) + 1;
        debug.lastDequeuedTextBySource[sourceMode] = next.text || '';
      }
      return next;
    },
    enqueueTranscript(sourceMode, payload) {
      const queue = transcriptQueues[sourceMode] || [];
      queue.push(payload);
      transcriptQueues[sourceMode] = queue;
      debug.enqueuedBySource[sourceMode] = (debug.enqueuedBySource[sourceMode] || 0) + 1;
    },
  };
}

async function createPlaybackStream(sourceMode, emissions, runtime) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('AudioContext is not available in this environment.');
  }

  const audioContext = new AudioContextClass();
  await audioContext.resume();
  const destination = audioContext.createMediaStreamDestination();
  const cleanupTimers = [];
  const startAt = audioContext.currentTime + 0.25;
  runtime.scheduleSourceEmissions(sourceMode, emissions);

  for (const emission of emissions) {
    const fixture = runtime.fixturesById[emission.fixtureId];
    if (!fixture?.filePath) continue;

    const fileResult = await window.electronE2E.readAudioFixture(fixture.filePath);
    if (!fileResult?.ok || !fileResult.base64) {
      throw new Error(fileResult?.error || `Unable to read audio fixture: ${fixture.filePath}`);
    }

    const arrayBuffer = decodeBase64ToArrayBuffer(fileResult.base64);
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const sourceNode = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();
    gainNode.gain.value = Math.max(0, Number(emission.gain ?? fixture.gain ?? 1) || 1);
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(gainNode);
    gainNode.connect(destination);
    sourceNode.start(startAt + (Math.max(0, Number(emission.atMs) || 0) / 1000));

  }

  let stream;
  let canvasStream = null;
  if (sourceMode === 'system') {
    canvasStream = createCanvasStream(sourceMode);
    stream = new window.MediaStream([
      ...destination.stream.getAudioTracks().map((track) => tagTrackSource(track, sourceMode)),
      ...canvasStream.getVideoTracks().map((track) => tagTrackSource(track, sourceMode)),
    ]);
  } else {
    stream = new window.MediaStream(
      destination.stream.getAudioTracks().map((track) => tagTrackSource(track, sourceMode))
    );
  }

  stream.__e2eSourceMode = sourceMode;
  attachStreamCleanup(stream, () => {
    cleanupTimers.forEach((timer) => clearTimeout(timer));
    canvasStream?.__e2eCleanup?.();
    try {
      audioContext.close();
    } catch {
      // ignore close failures
    }
  });

  return stream;
}

function installMediaDevicesHarness(config) {
  const runtime = createScenarioRuntime(config);
  window.__INTERVIEW_HELPER_E2E_RUNTIME__ = runtime;
  if (config.capture.system?.eager === true) {
    runtime.scheduleSourceEmissions('system', config.capture.system.emissions || []);
  }

  const currentMediaDevices = navigator.mediaDevices || {};
  const mediaDevices = {
    ...currentMediaDevices,
    async getUserMedia() {
      return createPlaybackStream('mic', config.capture.mic.emissions || [], runtime);
    },
    async getDisplayMedia() {
      return createPlaybackStream('system', config.capture.system.emissions || [], runtime);
    },
  };

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: mediaDevices,
  });
}

function installSpeechRecognitionHarness(config) {
  const runtime = window.__INTERVIEW_HELPER_E2E_RUNTIME__;
  if (!runtime) return;

  class MockSpeechRecognition {
    constructor() {
      this.continuous = true;
      this.interimResults = true;
      this.lang = 'en-US';
      this.onstart = null;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      this._running = false;
      this._timers = [];
    }

    start() {
      if (this._running) return;
      this._running = true;
      runtime.scheduleSourceEmissions('mic', config.capture.mic.emissions || []);
      this.onstart?.();

      const emissions = config.capture.mic.emissions || [];
      emissions.forEach((emission, index) => {
        const timer = setTimeout(() => {
          if (!this._running) return;
          const queued = runtime.dequeueTranscript('mic');
          const text = String(queued?.text || emission?.text || '').trim();
          if (!text || typeof this.onresult !== 'function') return;
          const result = {
            0: {
              transcript: text,
              confidence: 0.96,
            },
            isFinal: true,
            length: 1,
          };
          this.onresult({
            resultIndex: 0,
            results: [result],
          });

          if (index === emissions.length - 1) {
            const endTimer = setTimeout(() => {
              this.stop();
            }, 60);
            this._timers.push(endTimer);
          }
        }, Math.max(0, Number(emission.atMs) || 0) + 180);
        this._timers.push(timer);
      });
    }

    stop() {
      if (!this._running) return;
      this._running = false;
      this._timers.forEach((timer) => clearTimeout(timer));
      this._timers = [];
      this.onend?.();
    }

    abort() {
      this.stop();
    }
  }

  window.SpeechRecognition = MockSpeechRecognition;
  window.webkitSpeechRecognition = MockSpeechRecognition;
}

function findDetectedQuestion(config, transcript = '') {
  const text = String(transcript || '');
  for (const matcher of config.detectQuestion) {
    const needle = String(matcher.contains || '').trim();
    if (needle && text.includes(needle)) {
      return String(matcher.question || needle).trim();
    }
  }
  return '';
}

function installFetchHarness(config) {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('/api/ai/transcribe-chunk')) {
      const formData = init?.body;
      const sourceMode = String(formData?.get?.('sourceMode') || 'unknown').trim().toLowerCase();
      const emission = window.__INTERVIEW_HELPER_E2E_RUNTIME__?.dequeueTranscript(sourceMode);

      if (emission?.delayMs) {
        await delay(emission.delayMs);
      }

      return jsonResponse({
        text: String(emission?.text || ''),
        sourceMode,
        providerUsed: 'mock-e2e',
      });
    }

    if (url.includes('/api/ai/detect-question')) {
      const body = init?.body ? JSON.parse(init.body) : {};
      const question = findDetectedQuestion(config, body.transcript);
      return jsonResponse({
        isQuestion: Boolean(question),
        question,
      });
    }

    if (url.includes('/api/ai/answer-screenshot')) {
      return jsonResponse({
        question: String(config.screenshot?.question || ''),
        answer: String(config.screenshot?.answer || 'Mock screenshot answer'),
        providerUsed: 'mock-e2e',
      });
    }

    if (url.includes('/api/ai/answer')) {
      return new Response(createSSEStream(config.answer), {
        status: 200,
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'text/event-stream; charset=utf-8',
        },
      });
    }

    return originalFetch(input, init);
  };
}

function installElectronHarness(config) {
  if (!config?.screenshot?.imageDataUrl || !window?.electronAPI) return;
  try {
    window.electronAPI.capturePrimaryScreen = async () => ({
      ok: true,
      dataUrl: config.screenshot.imageDataUrl,
      width: 1280,
      height: 720,
    });
  } catch {
    // Ignore capture override failures and fall back to the real Electron API.
  }
}

export function installE2EHarness(rawConfig) {
  if (!rawConfig || rawConfig.error || window.__INTERVIEW_HELPER_E2E_INSTALLED__) {
    return;
  }

  window.__INTERVIEW_HELPER_E2E_INSTALLED__ = true;
  const config = normalizeConfig(rawConfig);
  window.__INTERVIEW_HELPER_E2E_CONFIG__ = config;

  installMediaDevicesHarness(config);
  installFetchHarness(config);
  installElectronHarness(config);
  installSpeechRecognitionHarness(config);
}
