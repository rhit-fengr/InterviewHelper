import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { installE2EHarness } from './test/installE2EHarness';

installE2EHarness(window.electronE2E?.config);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
