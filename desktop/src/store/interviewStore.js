import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const PERSIST_KEY = 'interview-ai-hamburger-storage';
const LEGACY_PERSIST_KEY = 'interview-hammer-storage';

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

export const useInterviewStore = create(
  persist(
    (set) => ({
      // ── Interview Setup ──────────────────────────────────────────────────
      setup: {
        aiProvider: 'openai',
        sttProvider: 'auto',
        autoHideWindowsLiveCaptions: false,
        windowsLiveCaptionsIncludeMicrophoneAudio: true,
        topic: 'software-engineering',
        interviewLangs: ['en-US'],
        answerLang: 'en-US',
        customInstructions: '',
      },

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
        set((state) => ({ setup: { ...state.setup, ...data } })),
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
