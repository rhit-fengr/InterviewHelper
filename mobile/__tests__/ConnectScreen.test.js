import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ConnectScreen from '../screens/ConnectScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

describe('ConnectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows validation error when session code is missing', () => {
    const { getByTestId, getByText } = render(<ConnectScreen onConnect={jest.fn()} />);

    act(() => {
      fireEvent.changeText(getByTestId('server-url-input'), 'http://localhost:4000');
      fireEvent.press(getByTestId('connect-button'));
    });

    expect(getByText(/Please enter the session code/i)).toBeTruthy();
  });

  it('normalizes inputs and triggers onConnect with persisted server url', async () => {
    const onConnect = jest.fn();
    const { getByTestId } = render(<ConnectScreen onConnect={onConnect} />);

    fireEvent.changeText(getByTestId('server-url-input'), 'http://192.168.1.2:4000/');
    fireEvent.changeText(getByTestId('session-code-input'), 'iron-1234');

    act(() => {
      fireEvent.press(getByTestId('connect-button'));
    });

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith('IRON-1234', 'http://192.168.1.2:4000');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@interview_ai_hamburger_server_url',
        'http://192.168.1.2:4000'
      );
    });
  });
});
