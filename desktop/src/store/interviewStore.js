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
    }),
    { name: PERSIST_KEY, storage }
  )
);
