// src/components/VoiceOrb.jsx
// Animated AI voice visualizer orb – changes appearance based on call state

/**
 * @param {'idle'|'greeting'|'listening'|'recording'|'processing'|'speaking'|'thinking'|'ended'} status
 */
export default function VoiceOrb({ status = 'idle' }) {
  const isAnimated = ['listening', 'speaking', 'greeting'].includes(status);
  const isRecording = status === 'recording';
  const isThinking = status === 'processing' || status === 'thinking';
  const isSpeaking = status === 'speaking' || status === 'greeting';

  return (
    <div className="voice-orb-container">
      {/* Ambient pulsing rings */}
      {isAnimated && (
        <>
          <div className="orb-ring orb-ring-1" />
          <div className="orb-ring orb-ring-2" />
        </>
      )}

      {/* Core orb */}
      <div
        className={`orb-core${isRecording ? ' recording' : ''}${isThinking ? ' thinking' : ''}${isSpeaking ? ' speaking' : ''}`}
      >
        {isThinking ? (
          <div className="orb-spinner" />
        ) : isAnimated || isRecording ? (
          <div className="waveform">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div
                key={i}
                className={`wave-bar${isAnimated || isRecording ? ' active' : ''}`}
                style={
                  isAnimated || isRecording
                    ? { animationDuration: `${0.5 + Math.random() * 0.6}s`, animationDelay: `${i * 0.05}s` }
                    : {}
                }
              />
            ))}
          </div>
        ) : (
          <span
            className="material-symbols-outlined orb-idle-icon filled"
            style={{ color: status === 'ended' ? 'var(--color-outline-variant)' : 'var(--color-primary-container)' }}
          >
            {status === 'ended' ? 'check_circle' : 'mic'}
          </span>
        )}
      </div>
    </div>
  );
}
