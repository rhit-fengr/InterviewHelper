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
  return {
    name: String(config?.name || 'unnamed-e2e-scenario'),
    capture: {
      mic: {
        emissions: Array.isArray(capture.mic?.emissions) ? capture.mic.emissions : [],
      },
      system: {
        emissions: Array.isArray(capture.system?.emissions) ? capture.system.emissions : [],
      },
    },
    detectQuestion: Array.isArray(config?.detectQuestion) ? config.detectQuestion : [],
    answer: Array.isArray(config?.answer?.events)
      ? config.answer.events
      : [{ data: { text: 'Mock answer' } }, { data: { done: true } }],
  };
}

function createFakeTrack(kind, sourceMode) {
  return {
    kind,
    enabled: true,
    label: `e2e-${sourceMode}-${kind}`,
    __e2eSourceMode: sourceMode,
    muted: false,
    readyState: 'live',
    stop() {
      this.readyState = 'ended';
      if (typeof this.onended === 'function') {
        this.onended();
      }
    },
    addEventListener() {},
    removeEventListener() {},
    onended: null,
  };
}

class FakeMediaStream {
  constructor(tracks = [], sourceMode = null) {
    const providedTracks = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    const inferredSourceMode = sourceMode || providedTracks[0]?.__e2eSourceMode || 'mic';

    if (providedTracks.length > 0) {
      this._tracks = providedTracks;
    } else {
      const audioTrack = createFakeTrack('audio', inferredSourceMode);
      const videoTrack = inferredSourceMode === 'system' ? createFakeTrack('video', inferredSourceMode) : null;
      this._tracks = [audioTrack, videoTrack].filter(Boolean);
    }

    this.__e2eSourceMode = inferredSourceMode;
  }

  getTracks() {
    return [...this._tracks];
  }

  getAudioTracks() {
    return this._tracks.filter((track) => track.kind === 'audio');
  }

  getVideoTracks() {
    return this._tracks.filter((track) => track.kind === 'video');
  }
}

function installMediaDevicesHarness(config) {
  window.MediaStream = FakeMediaStream;
  const currentMediaDevices = navigator.mediaDevices || {};
  const mediaDevices = {
    ...currentMediaDevices,
    async getUserMedia() {
      return new FakeMediaStream([], 'mic');
    },
    async getDisplayMedia() {
      return new FakeMediaStream([], 'system');
    },
  };

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: mediaDevices,
  });

  class FakeMediaRecorder {
    static isTypeSupported() {
      return true;
    }

    constructor(stream) {
      this.stream = stream;
      this.state = 'inactive';
      this.mimeType = 'application/json';
      this.ondataavailable = null;
      this.onerror = null;
      this.onstart = null;
      this.onstop = null;
      this._sourceMode = String(stream?.__e2eSourceMode || 'mic');
      this._timers = [];
      this._emissionCursor = 0;
    }

    start() {
      if (this.state !== 'inactive') return;
      this.state = 'recording';
      this.onstart?.();

      const emissions = config.capture[this._sourceMode]?.emissions || [];
      emissions.forEach((emission, index) => {
        const timer = setTimeout(() => {
          if (this.state !== 'recording') return;
          this._emissionCursor = Math.max(this._emissionCursor, index + 1);
          const payload = JSON.stringify({
            ...emission,
            sourceMode: this._sourceMode,
            emissionIndex: index,
            padding: 'x'.repeat(1400),
          });
          this.ondataavailable?.({
            data: new Blob([payload], { type: 'application/json' }),
          });
        }, Math.max(0, Number(emission.atMs) || 0));
        this._timers.push(timer);
      });
    }

    requestData() {
      return undefined;
    }

    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this._timers.forEach((timer) => clearTimeout(timer));
      this._timers = [];
      this.onstop?.();
    }
  }

  window.MediaRecorder = FakeMediaRecorder;
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
      const audioBlob = formData?.get?.('audio');
      let emission = {};

      try {
        emission = JSON.parse(await audioBlob.text());
      } catch {
        emission = {};
      }

      if (emission.delayMs) {
        await delay(emission.delayMs);
      }

      return jsonResponse({
        text: String(emission.text || ''),
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

export function installE2EHarness(rawConfig) {
  if (!rawConfig || rawConfig.error || window.__INTERVIEW_HELPER_E2E_INSTALLED__) {
    return;
  }

  window.__INTERVIEW_HELPER_E2E_INSTALLED__ = true;
  const config = normalizeConfig(rawConfig);
  window.__INTERVIEW_HELPER_E2E_CONFIG__ = config;

  installMediaDevicesHarness(config);
  installFetchHarness(config);
}
