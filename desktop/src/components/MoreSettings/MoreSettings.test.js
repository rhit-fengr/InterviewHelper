import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useInterviewStore } from '../../store/interviewStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../utils/api', () => ({
  getProfile: jest.fn(),
  updateProfile: jest.fn(),
}));

const api = require('../../utils/api');

let MoreSettings;
beforeAll(() => {
  MoreSettings = require('./index').default;
});

let container;
let root;
let originalPlatformDescriptor;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
  window.electronAPI = undefined;
  useInterviewStore.getState().clearAuth();
  useInterviewStore.getState().updateSetup({
    micProvider: 'webspeech',
    systemProvider: 'openai',
    autoHideWindowsLiveCaptions: false,
    windowsLiveCaptionsMicrophoneAssist: false,
  });
  useInterviewStore.getState().updatePersonalInfo({
    fullName: 'Jane Doe',
    currentRole: '',
    company: '',
    yearsOfExperience: '',
    workHistory: '',
    skills: '',
    education: '',
    additionalInfo: '',
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
  delete window.electronAPI;
});

function render(ui) {
  act(() => root.render(ui));
}

function queryAll(selector) {
  return Array.from(container.querySelectorAll(selector));
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('MoreSettings', () => {
  it('shows Mac-safe system provider guidance and hides WLC-only controls off Windows', () => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });

    render(<MoreSettings onBack={jest.fn()} />);

    expect(container.textContent).toContain('Windows Live Captions is unavailable on this OS');
    expect(container.textContent).not.toContain('Use Windows Live Captions microphone assist');
  });

  it('syncs profile to server when authenticated', async () => {
    api.updateProfile.mockResolvedValue({ ok: true });
    useInterviewStore.getState().setAuth({
      token: 'jwt-token',
      user: { id: '1', email: 'jane@example.com', name: 'Jane Doe' },
    });

    render(<MoreSettings onBack={jest.fn()} />);

    const syncButton = queryAll('button').find((button) => button.textContent.includes('Sync Profile to Server'));
    await act(async () => {
      click(syncButton);
    });

    expect(api.updateProfile).toHaveBeenCalledWith('jwt-token', expect.objectContaining({
      name: 'Jane Doe',
    }));
  });
});
