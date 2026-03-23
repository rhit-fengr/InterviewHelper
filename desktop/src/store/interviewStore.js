import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const PERSIST_KEY = 'interview-ai-hamburger-storage';
const LEGACY_PERSIST_KEY = 'interview-hammer-storage';
const MIC_PROVIDERS = new Set(['webspeech', 'openai', 'gemini', 'local']);
const SYSTEM_PROVIDERS = new Set(['windows-live-captions', 'openai', 'gemini', 'local']);

const storage = createJSONStorage(() => ({
  getItem: (name) => {
    const currentValue = window.localStorage.getItem(name);
    if (currentValue !== null) return currentValue;
    if (name === PERSIST_KEY) {
      return window.localStorage.getItem(LEGACY_PERSIST_KEY);
    }
    return null;
  },
  setItem: (name, value) => window.localStorage.setItem(name, value),
  removeItem: (name) => window.localStorage.removeItem(name),
}));

function normalizeLanguageList(value) {
  const values = Array.isArray(value) ? value : [value];
  const cleaned = values
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return cleaned.length > 0 ? [...new Set(cleaned)] : ['en-US'];
}

function normalizeMicProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return MIC_PROVIDERS.has(normalized) ? normalized : 'webspeech';
}

function normalizeSystemProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return SYSTEM_PROVIDERS.has(normalized) ? normalized : 'windows-live-captions';
}

function deriveSourceProvidersFromLegacySttProvider(sttProvider = 'auto') {
  const normalized = String(sttProvider || 'auto').trim().toLowerCase();

  if (normalized === 'windows-live-captions') {
    return {
      micProvider: 'webspeech',
      systemProvider: 'windows-live-captions',
      windowsLiveCaptionsMicrophoneAssist: true,
    };
  }

  if (normalized === 'local') {
    return {
      micProvider: 'local',
      systemProvider: 'local',
      windowsLiveCaptionsMicrophoneAssist: false,
    };
  }

  if (normalized === 'openai' || normalized === 'gemini') {
    return {
      micProvider: normalized,
      systemProvider: normalized,
      windowsLiveCaptionsMicrophoneAssist: false,
    };
  }

  return {
    micProvider: 'webspeech',
    systemProvider: 'windows-live-captions',
    windowsLiveCaptionsMicrophoneAssist: false,
  };
}

export function getDefaultSetup() {
  return {
    aiProvider: 'openai',
    sttProvider: 'auto',
    micProvider: 'webspeech',
    systemProvider: 'windows-live-captions',
    autoHideWindowsLiveCaptions: false,
    windowsLiveCaptionsIncludeMicrophoneAudio: false,
    windowsLiveCaptionsMicrophoneAssist: false,
    topic: 'software-engineering',
    interviewLangs: ['en-US'],
    answerLang: 'en-US',
    customInstructions: '',
  };
}

export function normalizeSetup(input = {}, options = {}) {
  const defaults = getDefaultSetup();
  const next = { ...defaults, ...(input || {}) };
  const presenceSource = options?.presenceSource && typeof options.presenceSource === 'object'
    ? options.presenceSource
    : input;
  const hasMicProvider = typeof presenceSource?.micProvider === 'string' && presenceSource.micProvider.trim();
  const hasSystemProvider = typeof presenceSource?.systemProvider === 'string' && presenceSource.systemProvider.trim();
  const hasCanonicalAssist = typeof presenceSource?.windowsLiveCaptionsMicrophoneAssist === 'boolean';
  const hasLegacyAssist = typeof presenceSource?.windowsLiveCaptionsIncludeMicrophoneAudio === 'boolean';

  const legacyMapping = deriveSourceProvidersFromLegacySttProvider(next.sttProvider);
  next.micProvider = hasMicProvider
    ? normalizeMicProvider(next.micProvider)
    : legacyMapping.micProvider;
  next.systemProvider = hasSystemProvider
    ? normalizeSystemProvider(next.systemProvider)
    : legacyMapping.systemProvider;

  if (hasCanonicalAssist) {
    next.windowsLiveCaptionsMicrophoneAssist = input.windowsLiveCaptionsMicrophoneAssist === true;
  } else if (hasLegacyAssist) {
    next.windowsLiveCaptionsMicrophoneAssist = input.windowsLiveCaptionsIncludeMicrophoneAudio === true;
  } else if (!hasMicProvider || !hasSystemProvider) {
    next.windowsLiveCaptionsMicrophoneAssist = legacyMapping.windowsLiveCaptionsMicrophoneAssist;
  } else {
    next.windowsLiveCaptionsMicrophoneAssist = defaults.windowsLiveCaptionsMicrophoneAssist;
  }

  next.windowsLiveCaptionsIncludeMicrophoneAudio = next.windowsLiveCaptionsMicrophoneAssist;
  next.autoHideWindowsLiveCaptions = next.autoHideWindowsLiveCaptions === true;
  next.interviewLangs = normalizeLanguageList(next.interviewLangs || next.interviewLang);
  return next;
}

function extractPersistedState(persistedState) {
  if (!persistedState || typeof persistedState !== 'object') return {};
  if (persistedState.state && typeof persistedState.state === 'object') {
    return persistedState.state;
  }
  return persistedState;
}

export const useInterviewStore = create(
  persist(
    (set) => ({
      // ── Interview Setup ──────────────────────────────────────────────────
      setup: getDefaultSetup(),

      // ── Session Settings ─────────────────────────────────────────────────
      session: {
        autoAnswer: true,
        showTranscript: true,
        showTranslation: false,
        showCustomInput: true,
        audioInputMode: 'mic',
      },

      // ── Personal Info ────────────────────────────────────────────────────
      personalInfo: {
        fullName: '',
        currentRole: '',
        company: '',
        yearsOfExperience: '',
        workHistory: '',
        skills: '',
        education: '',
        additionalInfo: '',
      },

      // ── Answer Settings ──────────────────────────────────────────────────
      answerSettings: {
        behavioralStructure: 'STAR',
        responseStyle: 'conversational',
        answerLength: 'medium',
        detectionSensitivity: 'medium',
        screenshotLimit: 3,
        memoryLimit: 10,
      },

      // ── Display Settings ─────────────────────────────────────────────────
      displaySettings: {
        fontSize: 14,
        windowOpacity: 0.95,
        alwaysOnTop: true,
      },

      // ── Advanced Settings ────────────────────────────────────────────────
      advancedSettings: {
        hideAppIcon: false,
        hideFromScreenSharing: false,
      },

      // ── Auth State (persisted) ───────────────────────────────────────────
      auth: {
        token: '',
        user: null,
        loading: false,
        error: '',
      },

      // ── Runtime State (transient, not persisted) ──────────────────────────
      runtime: {
        activeProvider: 'idle',
        providerDetail: '',
        sourceMode: 'idle',
        status: 'idle',
        isListening: false,
        startedAt: null,
        lastError: '',
        diagnostics: {
          platform: '',
          providerUsed: '',
          sourceLabel: '',
          activeLanguage: '',
          windowsLiveCaptionsRunning: false,
          windowsLiveCaptionsHidden: false,
          windowsLiveCaptionsAutoHidePending: false,
          windowsLiveCaptionsMicrophoneAudioEnabled: false,
          localWhisperHealthy: false,
          localWhisperManaged: false,
          localWhisperLeaseCount: 0,
          localWhisperHealthUrl: '',
        },
      },

      // ── Actions ──────────────────────────────────────────────────────────
      updateSetup: (data) =>
        set((state) => ({
          setup: normalizeSetup(
            { ...state.setup, ...data },
            { presenceSource: data }
          ),
        })),
      updateSession: (data) =>
        set((state) => ({ session: { ...state.session, ...data } })),
      updatePersonalInfo: (data) =>
        set((state) => ({ personalInfo: { ...state.personalInfo, ...data } })),
      updateAnswerSettings: (data) =>
        set((state) => ({ answerSettings: { ...state.answerSettings, ...data } })),
      updateDisplaySettings: (data) =>
        set((state) => ({ displaySettings: { ...state.displaySettings, ...data } })),
      updateAdvancedSettings: (data) =>
        set((state) => ({ advancedSettings: { ...state.advancedSettings, ...data } })),
      
      // ── Auth Actions ──────────────────────────────────────────────────────
      setAuth: ({ token, user }) =>
        set(() => ({ auth: { token: token || '', user: user || null, loading: false, error: '' } })),
      clearAuth: () =>
        set(() => ({ auth: { token: '', user: null, loading: false, error: '' } })),
      setAuthLoading: (loading) =>
        set((state) => ({ auth: { ...state.auth, loading, error: loading ? '' : state.auth.error } })),
      setAuthError: (error) =>
        set((state) => ({ auth: { ...state.auth, error: error || '', loading: false } })),
      
      updateRuntime: (data) =>
        set((state) => ({
          runtime: {
            ...state.runtime,
            ...data,
            diagnostics: {
              ...state.runtime.diagnostics,
              ...(data?.diagnostics || {}),
            },
          },
        })),
      resetRuntime: () =>
        set(() => ({
          runtime: {
            activeProvider: 'idle',
            providerDetail: '',
            sourceMode: 'idle',
            status: 'idle',
            isListening: false,
            startedAt: null,
            lastError: '',
            diagnostics: {
              platform: '',
              providerUsed: '',
              sourceLabel: '',
              activeLanguage: '',
              windowsLiveCaptionsRunning: false,
              windowsLiveCaptionsHidden: false,
              windowsLiveCaptionsAutoHidePending: false,
              windowsLiveCaptionsMicrophoneAudioEnabled: false,
              localWhisperHealthy: false,
              localWhisperManaged: false,
              localWhisperLeaseCount: 0,
              localWhisperHealthUrl: '',
            },
          },
        })),
    }),
    {
      name: PERSIST_KEY,
      storage,
      version: 1,
      merge: (persistedState, currentState) => {
        const persisted = extractPersistedState(persistedState);
        return {
          ...currentState,
          ...persisted,
          setup: normalizeSetup(
            {
              ...currentState.setup,
              ...(persisted.setup || {}),
            },
            { presenceSource: persisted.setup || {} }
          ),
        };
      },
      partialize: (state) => ({
        setup: state.setup,
        session: state.session,
        personalInfo: state.personalInfo,
        answerSettings: state.answerSettings,
        displaySettings: state.displaySettings,
        advancedSettings: state.advancedSettings,
        auth: state.auth,
      }),
    }
  )
);
