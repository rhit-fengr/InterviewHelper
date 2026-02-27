import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import ConnectScreen from './screens/ConnectScreen';
import SessionScreen from './screens/SessionScreen';

/**
 * Root component — simple two-screen navigation managed via local state.
 * When `sessionCode` is null the user sees the ConnectScreen;
 * after they connect it switches to the SessionScreen.
 */
export default function App() {
  const [session, setSession] = useState(null); // { code, serverUrl }

  const handleConnect = (code, serverUrl) => {
    setSession({ code, serverUrl });
  };

  const handleDisconnect = () => {
    setSession(null);
  };

  return (
    <>
      <StatusBar style="light" />
      {session ? (
        <SessionScreen
          sessionCode={session.code}
          serverUrl={session.serverUrl}
          onDisconnect={handleDisconnect}
        />
      ) : (
        <ConnectScreen onConnect={handleConnect} />
      )}
    </>
  );
}
