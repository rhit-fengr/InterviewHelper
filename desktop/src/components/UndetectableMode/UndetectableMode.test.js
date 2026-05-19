import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useInterviewStore } from '../../store/interviewStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockUseSocketSync = jest.fn();
const mockUseAIAnswer = jest.fn();
const mockUseTranscript = jest.fn();
const mockUseDualAudioTranscript = jest.fn();

jest.mock('../../hooks/useSocketSync', () => ({
  useSocketSync: (...args) => mockUseSocketSync(...args),
}));

jest.mock('../../hooks/useAIAnswer', () => ({
  useAIAnswer: (...args) => mockUseAIAnswer(...args),
}));

jest.mock('../../hooks/useTranscript', () => ({
  useTranscript: (...args) => mockUseTranscript(...args),
}));

jest.mock('../../hooks/useDualAudioTranscript', () => ({
  useDualAudioTranscript: (...args) => mockUseDualAudioTranscript(...args),
}));

let UndetectableMode;
beforeAll(() => {
  UndetectableMode = require('./index').default;
});

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  mockUseSocketSync.mockReturnValue({
    isConnected: false,
    clientConnected: false,
    createSession: jest.fn(),
    streamAnswerChunk: jest.fn(),
    streamTranscript: jest.fn(),
  });
  mockUseAIAnswer.mockReturnValue({
    answer: '',
    isLoading: false,
    generateAnswer: jest.fn(),
  });
  mockUseTranscript.mockReturnValue({
    transcript: 'candidate preview',
    activeLanguage: 'en-US',
    isListening: false,
    error: '',
    clearTranscript: jest.fn(),
  });
  mockUseDualAudioTranscript.mockReturnValue({
    transcript: 'system preview',
    activeLanguage: 'en-US',
    isListening: false,
    error: '',
    clearTranscript: jest.fn(),
  });

  useInterviewStore.getState().updateSetup({
    aiProvider: 'openai',
    micProvider: 'webspeech',
    systemProvider: 'windows-live-captions',
    autoHideWindowsLiveCaptions: false,
    windowsLiveCaptionsMicrophoneAssist: false,
    interviewLangs: ['en-US'],
  });
  useInterviewStore.getState().updateSession({
    autoAnswer: true,
    showTranscript: true,
    showCustomInput: true,
    audioInputMode: 'mic-system',
  });
  window.electronAPI = {
    isElectron: true,
    hideWindow: jest.fn(),
    showWindow: jest.fn(),
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  root = null;
  delete window.electronAPI;
  jest.clearAllMocks();
});

function render(ui) {
  act(() => root.render(ui));
}

function query(selector) {
  return container.querySelector(selector);
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('UndetectableMode', () => {
  it('renders session instructions and disabled start while phone is disconnected', () => {
    render(<UndetectableMode onBack={jest.fn()} />);

    expect(container.textContent).toContain('Connect Your Phone');
    expect(container.textContent).toContain('Session Code');
    expect(query('.btn-toggle').disabled).toBe(true);
  });

  it('shows transcript preview after start when client is connected', () => {
    mockUseSocketSync.mockReturnValue({
      isConnected: true,
      clientConnected: true,
      createSession: jest.fn(),
      streamAnswerChunk: jest.fn(),
      streamTranscript: jest.fn(),
    });

    render(<UndetectableMode onBack={jest.fn()} />);

    click(query('.btn-toggle'));

    expect(container.textContent).toContain('Live');
    expect(container.textContent).toContain('candidate preview');
    expect(container.textContent).toContain('Hide App');
    expect(query('.btn-toggle').textContent).toContain('Stop');
  });

  it('streams answer deltas to the connected client when answer text exists', () => {
    const streamAnswerChunk = jest.fn();
    mockUseSocketSync.mockReturnValue({
      isConnected: true,
      clientConnected: true,
      createSession: jest.fn(),
      streamAnswerChunk,
      streamTranscript: jest.fn(),
    });
    mockUseAIAnswer.mockReturnValue({
      answer: 'Mocked remote answer',
      isLoading: false,
      generateAnswer: jest.fn(),
    });

    render(<UndetectableMode onBack={jest.fn()} />);

    expect(streamAnswerChunk).toHaveBeenCalled();
    expect(streamAnswerChunk.mock.calls[0][1]).toContain('Mocked remote answer');
  });
});
