import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import SessionScreen from '../screens/SessionScreen';
import { useSocketClient } from '../hooks/useSocketClient';
import * as Clipboard from 'expo-clipboard';

jest.mock('../hooks/useSocketClient', () => ({
  useSocketClient: jest.fn(),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(),
}));

describe('SessionScreen', () => {
  let socketCallbacks;

  beforeEach(() => {
    jest.clearAllMocks();
    socketCallbacks = null;

    useSocketClient.mockImplementation((options) => {
      socketCallbacks = options;
      return { isConnected: true, sessionStatus: 'joined' };
    });
  });

  it('renders streamed answer chunks and replaces answer when a new stream starts', async () => {
    const { getByText, queryByText } = render(
      <SessionScreen
        sessionCode="IRON-1234"
        serverUrl="http://localhost:4000"
        onDisconnect={jest.fn()}
      />
    );

    act(() => {
      socketCallbacks.onAnswerChunk('First answer', false);
      socketCallbacks.onAnswerChunk('', true);
    });

    expect(getByText('First answer')).toBeTruthy();

    act(() => {
      socketCallbacks.onAnswerChunk('Second', false);
    });

    expect(getByText('Second▌')).toBeTruthy();
    expect(queryByText('First answer')).toBeNull();
  });

  it('shows transcript updates and handles host disconnection state', () => {
    const { getByText } = render(
      <SessionScreen
        sessionCode="IRON-1234"
        serverUrl="http://localhost:4000"
        onDisconnect={jest.fn()}
      />
    );

    act(() => {
      socketCallbacks.onTranscriptUpdate('Tell me about your biggest project');
    });
    expect(getByText('Tell me about your biggest project')).toBeTruthy();

    act(() => {
      socketCallbacks.onHostDisconnected();
    });
    expect(getByText(/Host disconnected/)).toBeTruthy();
    expect(getByText(/Desktop host has disconnected/)).toBeTruthy();
  });

  it('copies completed answer text to clipboard', async () => {
    const { getByTestId, getByText } = render(
      <SessionScreen
        sessionCode="IRON-1234"
        serverUrl="http://localhost:4000"
        onDisconnect={jest.fn()}
      />
    );

    act(() => {
      socketCallbacks.onAnswerChunk('Copy me', false);
      socketCallbacks.onAnswerChunk('', true);
    });

    fireEvent.press(getByTestId('copy-button'));

    await waitFor(() => {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Copy me');
      expect(getByText('✓ Copied')).toBeTruthy();
    });
  });
});
