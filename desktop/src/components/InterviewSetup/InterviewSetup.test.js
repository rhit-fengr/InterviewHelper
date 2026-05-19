import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useInterviewStore } from '../../store/interviewStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let InterviewSetup;
beforeAll(() => {
  InterviewSetup = require('./index').default;
});

let container;
let root;
let originalPlatformDescriptor;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useInterviewStore.getState().clearAuth();
  useInterviewStore.getState().updateSetup({
    aiProvider: 'openai',
    micProvider: 'webspeech',
    systemProvider: 'windows-live-captions',
    autoHideWindowsLiveCaptions: false,
    windowsLiveCaptionsMicrophoneAssist: false,
    topic: 'software-engineering',
    interviewLangs: ['en-US'],
    answerLang: 'en-US',
    customInstructions: '',
  });
  originalPlatformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  container = null;
  root = null;
  if (originalPlatformDescriptor) {
    Object.defineProperty(window.navigator, 'platform', originalPlatformDescriptor);
  }
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

describe('InterviewSetup', () => {
  it('renders source-specific provider selects and auth entry', () => {
    render(<InterviewSetup onStart={jest.fn()} onAuth={jest.fn()} />);

    expect(query('#setup-ai-provider')).not.toBeNull();
    expect(query('#setup-mic-provider')).not.toBeNull();
    expect(query('#setup-system-provider')).not.toBeNull();
    expect(container.textContent).toContain('Sign In / Create Account');
  });

  it('calls onAuth from the auth entry button', () => {
    const onAuth = jest.fn();
    render(<InterviewSetup onStart={jest.fn()} onAuth={onAuth} />);

    click(query('.btn-auth-entry'));
    expect(onAuth).toHaveBeenCalledTimes(1);
  });

  it('normalizes windows-live-captions away on non-Windows and shows Mac guidance', async () => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });

    await act(async () => {
      render(<InterviewSetup onStart={jest.fn()} onAuth={jest.fn()} />);
    });

    expect(useInterviewStore.getState().setup.systemProvider).toBe('openai');
    expect(container.textContent).toContain('Windows Live Captions is unavailable on this OS');
  });
});
