import { getDefaultSetup, migratePersistedStoreState, normalizeSetup, useInterviewStore } from './interviewStore';

describe('interviewStore setup migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    const state = useInterviewStore.getState();
    state.updateSetup(getDefaultSetup());
    state.updateSession({
      autoAnswer: true,
      showTranscript: true,
      showTranslation: false,
      showCustomInput: true,
      audioInputMode: 'mic',
    });
    state.resetRuntime();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('defaults to source-specific providers', () => {
    const { setup } = useInterviewStore.getState();

    expect(setup.sttProvider).toBeUndefined();
    expect(setup.micProvider).toBe('webspeech');
    expect(setup.systemProvider).toBe('windows-live-captions');
    expect(setup.windowsLiveCaptionsMicrophoneAssist).toBe(false);
    expect(setup.windowsLiveCaptionsIncludeMicrophoneAudio).toBe(false);
  });

  it('normalizes direct source-specific setup updates', () => {
    const { updateSetup } = useInterviewStore.getState();

    updateSetup({
      micProvider: 'openai',
      systemProvider: 'gemini',
      windowsLiveCaptionsMicrophoneAssist: true,
    });

    const { setup } = useInterviewStore.getState();
    expect(setup.micProvider).toBe('openai');
    expect(setup.systemProvider).toBe('gemini');
    expect(setup.windowsLiveCaptionsMicrophoneAssist).toBe(true);
    expect(setup.windowsLiveCaptionsIncludeMicrophoneAudio).toBe(true);
  });

  it('maps legacy windows-live-captions to source-specific defaults', () => {
    const migrated = normalizeSetup({
      sttProvider: 'windows-live-captions',
    });

    expect(migrated.micProvider).toBe('webspeech');
    expect(migrated.systemProvider).toBe('windows-live-captions');
    expect(migrated.windowsLiveCaptionsMicrophoneAssist).toBe(true);
    expect(migrated.windowsLiveCaptionsIncludeMicrophoneAudio).toBe(true);
    expect(migrated.sttProvider).toBeUndefined();
  });

  it('maps legacy local provider to both sources explicitly', () => {
    const migrated = normalizeSetup({
      sttProvider: 'local',
    });

    expect(migrated.micProvider).toBe('local');
    expect(migrated.systemProvider).toBe('local');
    expect(migrated.windowsLiveCaptionsMicrophoneAssist).toBe(false);
  });

  it('maps legacy cloud provider to both sources', () => {
    const migrated = normalizeSetup({
      sttProvider: 'openai',
    });

    expect(migrated.micProvider).toBe('openai');
    expect(migrated.systemProvider).toBe('openai');
  });

  it('maps legacy auto or missing provider to webspeech + windows-live-captions', () => {
    const migratedAuto = normalizeSetup({
      sttProvider: 'auto',
    });
    const migratedMissing = normalizeSetup({
      sttProvider: '',
    });

    expect(migratedAuto.micProvider).toBe('webspeech');
    expect(migratedAuto.systemProvider).toBe('windows-live-captions');
    expect(migratedMissing.micProvider).toBe('webspeech');
    expect(migratedMissing.systemProvider).toBe('windows-live-captions');
  });

  it('migrates legacy windowsLiveCaptionsIncludeMicrophoneAudio into canonical assist field', () => {
    const migratedTrue = normalizeSetup({
      windowsLiveCaptionsIncludeMicrophoneAudio: true,
    });
    const migratedFalse = normalizeSetup({
      windowsLiveCaptionsIncludeMicrophoneAudio: false,
    });

    expect(migratedTrue.windowsLiveCaptionsMicrophoneAssist).toBe(true);
    expect(migratedTrue.windowsLiveCaptionsIncludeMicrophoneAudio).toBe(true);
    expect(migratedFalse.windowsLiveCaptionsMicrophoneAssist).toBe(false);
    expect(migratedFalse.windowsLiveCaptionsIncludeMicrophoneAudio).toBe(false);
  });

  it('prefers canonical microphone assist when both canonical and legacy fields exist', () => {
    const migrated = normalizeSetup({
      windowsLiveCaptionsMicrophoneAssist: false,
      windowsLiveCaptionsIncludeMicrophoneAudio: true,
    });

    expect(migrated.windowsLiveCaptionsMicrophoneAssist).toBe(false);
    expect(migrated.windowsLiveCaptionsIncludeMicrophoneAudio).toBe(false);
  });

  it('keeps runtime transient and setup persisted separately', () => {
    const { updateSetup, updateRuntime } = useInterviewStore.getState();

    updateSetup({ micProvider: 'openai', systemProvider: 'gemini' });
    updateRuntime({ sourceMode: 'Mic + System', status: 'running' });

    const { setup, runtime } = useInterviewStore.getState();
    expect(setup.micProvider).toBe('openai');
    expect(setup.systemProvider).toBe('gemini');
    expect(runtime.sourceMode).toBe('Mic + System');
    expect(runtime.status).toBe('running');
  });

  it('migrates persisted legacy sttProvider into source-specific setup once', () => {
    const migrated = migratePersistedStoreState({
      setup: {
        aiProvider: 'openai',
        sttProvider: 'local',
        topic: 'behavioral',
      },
    });

    expect(migrated.setup.sttProvider).toBeUndefined();
    expect(migrated.setup.micProvider).toBe('local');
    expect(migrated.setup.systemProvider).toBe('local');
    expect(migrated.setup.topic).toBe('behavioral');
  });
});
