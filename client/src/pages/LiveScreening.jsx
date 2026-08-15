// src/pages/LiveScreening.jsx
// 100% Cross-Browser Voice Screener (Chrome, Edge, Safari, Firefox, iOS, Android)
// Dual Engine: Web Speech API (Chrome/Edge) + Universal Web Audio VAD + MediaRecorder (Safari/Firefox/All Browsers)

import { useState, useCallback, useRef, useEffect } from 'react';
import VoiceOrb from '../components/VoiceOrb';
import TranscriptPanel from '../components/TranscriptPanel';
import { useWebSocket } from '../hooks/useWebSocket';

const STATUS_LABELS = {
  idle: 'Ready to start',
  connecting: 'Connecting...',
  greeting: 'AI is speaking...',
  listening: 'Listening... (Speak naturally)',
  recording: 'Hearing you...',
  processing: 'Processing response...',
  thinking: 'AI is thinking...',
  speaking: 'AI is speaking...',
  ended: 'Call ended',
};

export default function LiveScreening() {
  // Call state
  const [callStatus, setCallStatus] = useState('idle');
  const [callActive, setCallActive] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [activeLang, setActiveLang] = useState('en-US');

  // Conversation turns
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [interimUserText, setInterimUserText] = useState('');

  // Audio queue & playback
  const audioQueueRef = useRef([]);
  const isPlayingAudioRef = useRef(false);
  const activeAudioElementRef = useRef(null);

  // Speech Recognition refs (Chrome / Edge)
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const ttsWatchdogRef = useRef(null);
  const currentUtteranceRef = useRef(null);
  const currentTextRef = useRef('');
  const isSpeakingAIRef = useRef(false);
  const callActiveRef = useRef(false);
  const isMutedRef = useRef(false);
  const activeLangRef = useRef('en-US');
  activeLangRef.current = activeLang;

  // Universal MediaRecorder & Web Audio VAD refs (Safari / Firefox / Mobile)
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const vadRafRef = useRef(null);
  const vadSpeakingRef = useRef(false);
  const vadSilenceStartRef = useRef(null);

  // Timers
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  const showError = (msg, duration = 4000) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(''), duration);
  };

  // Cross-browser speech detection check
  const hasSpeechRecognition = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // WebSocket hook declaration (sendJSON is defined here)
  const wsHandlers = {
    onConnected: ({ sessionId }) => {
      setSessionId(sessionId);
    },
    onCallStarted: () => {
      setCallActive(true);
      callActiveRef.current = true;
      setCallStatus('greeting');
      audioQueueRef.current = [];
      isPlayingAudioRef.current = false;
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    },
    onAiThinking: () => {
      setIsTyping(true);
      setCallStatus('thinking');
    },
    onProcessing: () => {
      setCallStatus('processing');
    },
    onRecordingStarted: () => {
      setCallStatus('recording');
    },
    onUserText: ({ text }) => {
      setInterimUserText('');
      setMessages((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].role === 'user' && prev[prev.length - 1].text === text) {
          return prev;
        }
        return [...prev, { role: 'user', text, timestamp: Date.now() }];
      });
    },
    onAiText: ({ text, useBrowserTTS }) => {
      setIsTyping(false);
      setMessages((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].role === 'ai' && prev[prev.length - 1].text === text) {
          return prev;
        }
        return [...prev, { role: 'ai', text, timestamp: Date.now() }];
      });
      if (useBrowserTTS) {
        speakWithBrowserTTS(text);
      }
    },
    onAudio: (audioBuffer) => {
      audioQueueRef.current.push(audioBuffer);
      playNextAudio();
    },
    onGeneratingReport: () => {
      setCallStatus('ended');
      setCallActive(false);
      callActiveRef.current = false;
      clearInterval(timerRef.current);
    },
    onError: ({ message, recoverable }) => {
      showError(message || 'An error occurred');
      if (!recoverable) {
        setCallStatus('idle');
        setCallActive(false);
        callActiveRef.current = false;
      } else {
        setCallStatus('listening');
        setIsTyping(false);
        startListening();
      }
    },
  };

  const { sendJSON, disconnect } = useWebSocket(wsHandlers);

  // Auto-submit recognized speech text (Engine 1)
  const handleAutoSubmit = useCallback((textToSend) => {
    const text = (textToSend || currentTextRef.current || interimUserText).trim();
    if (!text || text.length < 2) return;

    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    currentTextRef.current = '';
    setInterimUserText('');

    stopListening();
    setCallStatus('thinking');

    sendJSON({ type: 'user_message', text });
  }, [interimUserText, sendJSON]);

  // Universal VAD (Voice Activity Detection) loop for Safari & Firefox
  const startUniversalVAD = useCallback((stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      vadSpeakingRef.current = false;
      vadSilenceStartRef.current = null;

      // Start MediaRecorder in streaming chunk mode
      const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0 && !isSpeakingAIRef.current) {
          e.data.arrayBuffer().then((buf) => {
            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
            sendJSON({ type: 'audio_chunk', data: b64 });
          });
        }
      };

      recorder.start(250);

      // Volume energy monitor
      const checkVolume = () => {
        if (!callActiveRef.current || isSpeakingAIRef.current || isMutedRef.current) {
          vadRafRef.current = requestAnimationFrame(checkVolume);
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // Threshold for human voice
        if (average > 18) {
          if (!vadSpeakingRef.current) {
            vadSpeakingRef.current = true;
            setCallStatus('recording');
            sendJSON({ type: 'audio_start' });
          }
          vadSilenceStartRef.current = null;
        } else {
          if (vadSpeakingRef.current) {
            if (!vadSilenceStartRef.current) {
              vadSilenceStartRef.current = Date.now();
            } else if (Date.now() - vadSilenceStartRef.current > 1100) {
              // 1.1s of silence detected -> send audio to server for Whisper STT
              vadSpeakingRef.current = false;
              vadSilenceStartRef.current = null;
              setCallStatus('processing');
              sendJSON({ type: 'audio_end' });
            }
          }
        }

        vadRafRef.current = requestAnimationFrame(checkVolume);
      };

      vadRafRef.current = requestAnimationFrame(checkVolume);
    } catch (err) {
      console.warn('[VAD] Init error:', err);
    }
  }, [sendJSON]);

  // Safe Speech Recognition / VAD starter
  const startListening = useCallback(async () => {
    if (!callActiveRef.current || isSpeakingAIRef.current || isMutedRef.current) return;

    // ENGINE 1: Chrome / Edge Web Speech API
    if (hasSpeechRecognition) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.abort();
        } catch (_) {}
        recognitionRef.current = null;
      }

      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = activeLangRef.current || 'en-US';

        currentTextRef.current = '';
        setInterimUserText('');

        recognition.onstart = () => {
          if (!isSpeakingAIRef.current && callActiveRef.current) {
            setCallStatus('listening');
          }
        };

        recognition.onresult = (event) => {
          if (isSpeakingAIRef.current || isMutedRef.current || !callActiveRef.current) return;

          let fullTranscript = '';
          for (let i = 0; i < event.results.length; ++i) {
            fullTranscript += event.results[i][0].transcript;
          }

          const text = fullTranscript.trim();
          if (text) {
            currentTextRef.current = text;
            setInterimUserText(text);
            setCallStatus('recording');

            if (/[\u0900-\u097F]/.test(text) && activeLangRef.current !== 'hi-IN') {
              setActiveLang('hi-IN');
              activeLangRef.current = 'hi-IN';
            }

            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              handleAutoSubmit(text);
            }, 1000);
          }
        };

        recognition.onerror = (event) => {
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            console.warn('[SpeechRecognition] Error:', event.error);
          }
        };

        recognition.onend = () => {
          if (callActiveRef.current && !isSpeakingAIRef.current && !isMutedRef.current) {
            setTimeout(() => {
              if (callActiveRef.current && !isSpeakingAIRef.current && !isMutedRef.current) {
                startListening();
              }
            }, 150);
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
        return;
      } catch (err) {
        console.warn('[SpeechRecognition] Start error:', err);
      }
    }

    // ENGINE 2: Universal Safari, Firefox, Mobile VAD & MediaRecorder
    try {
      if (!mediaStreamRef.current || mediaStreamRef.current.getTracks().every(t => t.readyState === 'ended')) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
      }
      setCallStatus('listening');
      startUniversalVAD(mediaStreamRef.current);
    } catch (err) {
      console.warn('[Universal Audio] Mic error:', err);
    }
  }, [hasSpeechRecognition, handleAutoSubmit, startUniversalVAD]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch (_) {}
      recognitionRef.current = null;
    }
    if (vadRafRef.current) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {}
    }
  }, []);

  // Play queued neural MP3 audio
  const playNextAudio = useCallback(() => {
    if (isPlayingAudioRef.current || audioQueueRef.current.length === 0) return;
    isPlayingAudioRef.current = true;
    isSpeakingAIRef.current = true;
    stopListening();
    setCallStatus('speaking');

    const buf = audioQueueRef.current.shift();
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudioElementRef.current = audio;

    const onAudioFinished = () => {
      URL.revokeObjectURL(url);
      isPlayingAudioRef.current = false;
      activeAudioElementRef.current = null;

      if (audioQueueRef.current.length > 0) {
        playNextAudio();
      } else {
        isSpeakingAIRef.current = false;
        setIsTyping(false);
        if (callActiveRef.current) {
          setCallStatus('listening');
          setTimeout(() => {
            if (callActiveRef.current && !isSpeakingAIRef.current) {
              startListening();
            }
          }, 100);
        }
      }
    };

    audio.onended = onAudioFinished;
    audio.onerror = onAudioFinished;

    audio.play().catch(() => {
      onAudioFinished();
    });
  }, [startListening, stopListening]);

  // Fallback browser TTS
  const speakWithBrowserTTS = useCallback((text) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setCallStatus('listening');
      setIsTyping(false);
      startListening();
      return;
    }

    isSpeakingAIRef.current = true;
    stopListening();
    if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);

    try {
      window.speechSynthesis.cancel();
    } catch (_) {}

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const hasHindi = /[\u0900-\u097F]/.test(text);

    let matchingVoice = null;
    if (hasHindi) {
      utterance.lang = 'hi-IN';
      matchingVoice = voices.find(v => (v.lang && v.lang.startsWith('hi')) || v.name.toLowerCase().includes('hindi')) ||
                      voices.find(v => v.lang && (v.lang === 'en-IN' || v.lang === 'hi_IN'));
    } else {
      utterance.lang = 'en-US';
      matchingVoice = voices.find(v => (v.name.includes('Google') || v.name.includes('Natural') || v.lang.startsWith('en')) && !v.name.includes('eSpeak'));
    }

    if (matchingVoice) utterance.voice = matchingVoice;
    currentUtteranceRef.current = utterance;

    const finishSpeaking = () => {
      if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
      currentUtteranceRef.current = null;
      isSpeakingAIRef.current = false;
      setIsTyping(false);

      if (callActiveRef.current) {
        setCallStatus('listening');
        setTimeout(() => {
          if (callActiveRef.current && !isSpeakingAIRef.current) {
            startListening();
          }
        }, 100);
      }
    };

    utterance.onstart = () => { setCallStatus('speaking'); };
    utterance.onend = () => { finishSpeaking(); };
    utterance.onerror = () => { finishSpeaking(); };

    const wordCount = (text || '').split(/\s+/).length;
    const estimatedDurationMs = Math.max(2500, (wordCount / 2.0) * 1000 + 2000);
    ttsWatchdogRef.current = setTimeout(() => {
      if (isSpeakingAIRef.current) {
        finishSpeaking();
      }
    }, estimatedDurationMs);

    setCallStatus('speaking');
    window.speechSynthesis.speak(utterance);
  }, [startListening, stopListening]);

  // Start Call (Works in 100% of browsers)
  const handleStartCall = async () => {
    setCallStatus('connecting');
    setMessages([]);
    setInterimUserText('');
    setCallDuration(0);
    isSpeakingAIRef.current = false;
    audioQueueRef.current = [];
    isPlayingAudioRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
    } catch (e) {
      showError('Microphone permission is required for voice calling. Please allow mic access in browser settings.');
      setCallStatus('idle');
      return;
    }

    sendJSON({ type: 'start_call' });
  };

  // End Call
  const handleEndCall = () => {
    callActiveRef.current = false;
    isSpeakingAIRef.current = false;
    if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
    stopListening();

    if (activeAudioElementRef.current) {
      try { activeAudioElementRef.current.pause(); } catch (_) {}
      activeAudioElementRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }

    sendJSON({ type: 'end_call' });
    setCallStatus('ended');
    setCallActive(false);
    clearInterval(timerRef.current);
    setIsTyping(false);
  };

  // Restart Call
  const handleRestartCall = () => {
    handleStartCall();
  };

  // Next Call
  const handleNextCall = () => {
    setCallStatus('idle');
    setCallActive(false);
    callActiveRef.current = false;
    setMessages([]);
    setInterimUserText('');
    setCallDuration(0);
  };

  // Toggle Mute
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    isMutedRef.current = nextMuted;

    if (nextMuted) {
      stopListening();
    } else {
      if (!isSpeakingAIRef.current && callActive) {
        startListening();
      }
    }
  };

  // Manual Submit button
  const handleManualSpeakClick = () => {
    if (!callActive) return;
    if (callStatus === 'recording') {
      if (hasSpeechRecognition) {
        handleAutoSubmit(currentTextRef.current || interimUserText);
      } else {
        sendJSON({ type: 'audio_end' });
      }
    } else if (callStatus === 'listening') {
      startListening();
    }
  };

  // Language Mode Toggle
  const handleSelectLang = (langCode) => {
    setActiveLang(langCode);
    activeLangRef.current = langCode;
    if (callActive && !isSpeakingAIRef.current) {
      startListening();
    }
  };

  useEffect(() => {
    return () => {
      callActiveRef.current = false;
      isSpeakingAIRef.current = false;
      if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
      stopListening();
      if (activeAudioElementRef.current) {
        try { activeAudioElementRef.current.pause(); } catch (_) {}
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      clearInterval(timerRef.current);
      disconnect();
    };
  }, [disconnect, stopListening]);

  const formatDuration = (secs) => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const statusLabel = STATUS_LABELS[callStatus] || callStatus;
  const dotClass = callStatus === 'recording' ? 'recording'
    : callStatus === 'listening' ? 'listening'
    : callStatus === 'thinking' || callStatus === 'processing' ? 'thinking'
    : callStatus === 'speaking' || callStatus === 'greeting' ? 'speaking'
    : 'idle';

  return (
    <div className="screening-layout" style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      
      {/* 1. LEFT SIDE: Adaptive Live Transcript Panel */}
      <TranscriptPanel messages={messages} isTyping={isTyping} />

      {/* 2. RIGHT / CENTER: Voice Visualizer Canvas */}
      <div className="screening-center" style={{
        flex: 1,
        height: '100vh',
        overflowY: 'auto',
        padding: '36px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }}>
        
        {/* Top Bar: Status Pill + Language Mode Switcher (English / Hindi) */}
        <div style={{
          position: 'absolute',
          top: 24,
          left: 32,
          right: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 10
        }}>
          {/* Status Pill */}
          <div className="status-pill" style={{ position: 'static' }}>
            <div className={`status-dot ${dotClass}`} />
            <span className="status-label">{statusLabel}</span>
          </div>

          {/* Language Mode Toggle: English / Hindi */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--color-surface)',
            padding: '4px',
            borderRadius: '14px',
            border: '1px solid var(--color-outline-variant)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            gap: 4
          }}>
            <button
              id="lang-english-btn"
              onClick={() => handleSelectLang('en-US')}
              style={{
                padding: '6px 14px',
                borderRadius: '10px',
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                background: activeLang === 'en-US' ? 'var(--color-primary)' : 'transparent',
                color: activeLang === 'en-US' ? '#ffffff' : 'var(--color-on-surface-variant)',
                boxShadow: activeLang === 'en-US' ? '0 2px 6px rgba(0,82,204,0.3)' : 'none'
              }}
            >
              English
            </button>
            <button
              id="lang-hindi-btn"
              onClick={() => handleSelectLang('hi-IN')}
              style={{
                padding: '6px 14px',
                borderRadius: '10px',
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                background: activeLang === 'hi-IN' ? 'var(--color-primary)' : 'transparent',
                color: activeLang === 'hi-IN' ? '#ffffff' : 'var(--color-on-surface-variant)',
                boxShadow: activeLang === 'hi-IN' ? '0 2px 6px rgba(0,82,204,0.3)' : 'none'
              }}
            >
              Hindi (हिन्दी)
            </button>
          </div>
        </div>

        {/* Voice Orb Visualizer */}
        <VoiceOrb status={callStatus} />

        {/* Live Speaking Subtitle */}
        {interimUserText && (
          <div style={{
            background: 'var(--color-surface-container)',
            border: '1.5px solid var(--color-primary-container)',
            borderRadius: '24px',
            padding: '12px 24px',
            marginBottom: 16,
            fontSize: 15,
            color: 'var(--color-on-surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 16px rgba(0,82,204,0.1)',
            animation: 'fade-in-up 0.2s ease',
            maxWidth: 540,
            textAlign: 'center'
          }}>
            <span className="material-symbols-outlined filled" style={{ fontSize: 20, color: 'var(--color-primary)' }}>mic</span>
            <span>"{interimUserText}"</span>
          </div>
        )}

        {/* Universal Voice Banner */}
        {callActive && (
          <div style={{
            fontSize: 13,
            color: 'var(--color-on-surface-variant)',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#1a7a4a' }}>record_voice_over</span>
            <span>
              <strong>Universal Voice Active:</strong> {activeLang === 'hi-IN' ? 'Hindi (हिन्दी)' : 'English'} mode. Speak naturally into your microphone.
            </span>
          </div>
        )}

        {/* Call Action Controls */}
        <div className="call-controls" style={{ marginTop: 8 }}>
          {callStatus === 'idle' && (
            <button
              id="start-call-btn"
              className="btn-start-call"
              onClick={handleStartCall}
              style={{ padding: '16px 44px', fontSize: 16 }}
            >
              <span className="material-symbols-outlined filled" style={{ fontSize: 22 }}>call</span>
              Start Voice Call
            </button>
          )}

          {callStatus === 'connecting' && (
            <button className="btn-start-call" disabled style={{ padding: '16px 44px', fontSize: 16 }}>
              <span className="material-symbols-outlined spin" style={{ fontSize: 22 }}>sync</span>
              Connecting...
            </button>
          )}

          {callActive && (
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              {callStatus === 'recording' && (
                <button
                  onClick={handleManualSpeakClick}
                  className="btn-outline"
                  style={{
                    padding: '14px 20px',
                    borderRadius: 'var(--radius)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    borderColor: 'var(--color-primary-container)',
                    color: 'var(--color-primary-container)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>
                  Send Speech Now
                </button>
              )}

              {/* Mute Toggle */}
              <button
                onClick={handleToggleMute}
                className="btn-outline"
                style={{
                  padding: '14px 20px',
                  borderRadius: 'var(--radius)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  background: isMuted ? 'var(--color-error-container)' : 'var(--color-surface)',
                  color: isMuted ? 'var(--color-error)' : 'var(--color-on-surface)',
                  borderColor: isMuted ? 'var(--color-error)' : 'var(--color-outline-variant)'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                  {isMuted ? 'mic_off' : 'mic'}
                </span>
                {isMuted ? 'Unmute' : 'Mute'}
              </button>

              {/* End Call Button */}
              <button
                id="end-call-btn"
                className="btn-end-call"
                onClick={handleEndCall}
                style={{ padding: '14px 32px', fontSize: 15 }}
              >
                <span className="material-symbols-outlined filled" style={{ fontSize: 22 }}>call_end</span>
                End Call
              </button>
            </div>
          )}

          {/* Post-Call Actions: Restart Call & Next Call */}
          {callStatus === 'ended' && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', animation: 'fade-in-up 0.3s ease' }}>
              <button
                id="restart-call-btn"
                className="btn-primary"
                onClick={handleRestartCall}
                style={{
                  padding: '14px 28px',
                  borderRadius: 'var(--radius)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 15,
                  fontWeight: 600,
                  background: 'var(--color-primary)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(0,82,204,0.3)'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>replay</span>
                Restart Call
              </button>

              <button
                id="next-call-btn"
                className="btn-outline"
                onClick={handleNextCall}
                style={{
                  padding: '14px 28px',
                  borderRadius: 'var(--radius)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 15,
                  fontWeight: 600,
                  background: 'var(--color-surface)',
                  color: 'var(--color-on-surface)',
                  border: '1.5px solid var(--color-outline-variant)',
                  cursor: 'pointer'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add_call</span>
                Next Patient / New Call
              </button>
            </div>
          )}
        </div>

        {/* Call Details Context Card */}
        <div className="context-card" style={{ marginTop: 32, maxWidth: 500, width: '100%' }}>
          <div className="context-card-title">Call Details & Status</div>
          <div className="context-grid">
            <div>
              <div className="context-label">Call Status</div>
              <div className="context-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`status-dot ${dotClass}`} style={{ width: 8, height: 8 }} />
                {callActive ? 'Live Call' : callStatus === 'ended' ? 'Completed' : 'Ready'}
              </div>
            </div>
            <div>
              <div className="context-label">Duration</div>
              <div className="context-value">{callActive || callStatus === 'ended' ? formatDuration(callDuration) : '00:00'}</div>
            </div>
            <div>
              <div className="context-label">Conversation Turns</div>
              <div className="context-value">{messages.filter(m => m.role === 'user').length} exchanges</div>
            </div>
            <div>
              <div className="context-label">Language Mode</div>
              <div className="context-value" style={{ color: '#1a7a4a' }}>
                {activeLang === 'hi-IN' ? 'Hindi (हिन्दी)' : 'English'}
              </div>
            </div>
          </div>
        </div>

        {/* Error Toast */}
        {errorMsg && (
          <div className="error-toast" role="alert">
            <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 8, verticalAlign: 'middle' }}>warning</span>
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}
