// src/App.jsx
// MediVoice AI Voice Screening Application

import LiveScreening from './pages/LiveScreening';

export default function App() {
  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <main style={{ flex: 1, display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <LiveScreening />
      </main>
    </div>
  );
}
