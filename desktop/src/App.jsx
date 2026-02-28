import React, { useEffect, useState } from 'react';
import './App.css';
import InterviewSetup from './components/InterviewSetup';
import SessionSettings from './components/SessionSettings';
import MoreSettings from './components/MoreSettings';
import StandardMode from './components/StandardMode';
import UndetectableMode from './components/UndetectableMode';
import { useInterviewStore } from './store/interviewStore';

const VIEWS = {
  SETUP: 'setup',
  SESSION: 'session',
  MORE: 'more',
  STANDARD: 'standard',
  UNDETECTABLE: 'undetectable',
};

export default function App() {
  const [view, setView] = useState(VIEWS.SETUP);
  const { displaySettings, advancedSettings } = useInterviewStore();

  const navigate = (target) => setView(target);

  useEffect(() => {
    const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
    if (!isElectron) return;

    window.electronAPI.setOpacity(displaySettings.windowOpacity);
    window.electronAPI.setAlwaysOnTop(displaySettings.alwaysOnTop);
    window.electronAPI.setContentProtection(advancedSettings.hideFromScreenSharing);
    window.electronAPI.setSkipTaskbar(advancedSettings.hideAppIcon);
  }, [
    displaySettings.windowOpacity,
    displaySettings.alwaysOnTop,
    advancedSettings.hideFromScreenSharing,
    advancedSettings.hideAppIcon,
  ]);

  return (
    <div className="app-container">
      <TitleBar />
      <div className="app-content">
        {view === VIEWS.SETUP && (
          <InterviewSetup onStart={() => navigate(VIEWS.SESSION)} />
        )}
        {view === VIEWS.SESSION && (
          <SessionSettings
            onStartInterview={() => navigate(VIEWS.STANDARD)}
            onUndetectable={() => navigate(VIEWS.UNDETECTABLE)}
            onMore={() => navigate(VIEWS.MORE)}
            onBack={() => navigate(VIEWS.SETUP)}
          />
        )}
        {view === VIEWS.MORE && (
          <MoreSettings onBack={() => navigate(VIEWS.SESSION)} />
        )}
        {view === VIEWS.STANDARD && (
          <StandardMode onBack={() => navigate(VIEWS.SESSION)} />
        )}
        {view === VIEWS.UNDETECTABLE && (
          <UndetectableMode onBack={() => navigate(VIEWS.SESSION)} />
        )}
      </div>
    </div>
  );
}

function TitleBar() {
  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

  const handleMinimize = () => isElectron && window.electronAPI.minimizeWindow();
  const handleClose = () => isElectron && window.electronAPI.closeWindow();

  return (
    <div className="title-bar">
      <span className="title-bar-name">⚡ Interview AI Hamburger</span>
      <div className="title-bar-controls">
        <button className="tb-btn tb-minimize" onClick={handleMinimize} title="Minimize">
          &#8722;
        </button>
        <button className="tb-btn tb-close" onClick={handleClose} title="Close">
          &#10005;
        </button>
      </div>
    </div>
  );
}
