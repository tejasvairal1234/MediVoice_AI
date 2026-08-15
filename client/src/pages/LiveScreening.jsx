// src/pages/LiveScreening.jsx
// 100% Cross-Browser & Mobile-Responsive Voice Screener
// Dual Engine: Web Speech API (Chrome/Edge) + Universal Web Audio VAD + MediaRecorder (Safari/Firefox/iOS/Android)

import { useState, useCallback, useRef, useEffect } from 'react';
import VoiceOrb from '../components/VoiceOrb';
import TranscriptPanel from '../components/TranscriptPanel';
import ReportView from '../components/ReportView';
import { useWebSocket } from '../hooks/useWebSocket';

const SUPPORTED_LANGUAGES = [
  { code: 'auto', label: '🌐 Auto-Detect', langName: 'Auto-Detect (All Languages)' },
  { code: 'en-US', label: 'English', langName: 'English' },
  { code: 'hi-IN', label: 'Hindi (हिन्दी)', langName: 'Hindi' },
  { code: 'mr-IN', label: 'Marathi (मराठी)', langName: 'Marathi' },
  { code: 'bn-IN', label: 'Bengali (বাংলা)', langName: 'Bengali' },
  { code: 'ta-IN', label: 'Tamil (தமிழ்)', langName: 'Tamil' },
  { code: 'te-IN', label: 'Telugu (తెలుగు)', langName: 'Telugu' },
  { code: 'gu-IN', label: 'Gujarati (ગુજરાતી)', langName: 'Gujarati' },
  { code: 'kn-IN', label: 'Kannada (ಕನ್ನಡ)', langName: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam (മലയാളം)', langName: 'Malayalam' },
  { code: 'pa-IN', label: 'Punjabi (ਪੰਜਾਬੀ)', langName: 'Punjabi' },
  { code: 'ur-IN', label: 'Urdu (اردو)', langName: 'Urdu' },
  { code: 'es-ES', label: 'Spanish (Español)', langName: 'Spanish' },
  { code: 'fr-FR', label: 'French (Français)', langName: 'French' },
  { code: 'de-DE', label: 'German (Deutsch)', langName: 'German' },
  { code: 'ar-SA', label: 'Arabic (العربية)', langName: 'Arabic' },
  { code: 'zh-CN', label: 'Chinese (中文)', langName: 'Chinese' },
  { code: 'ja-JP', label: 'Japanese (日本語)', langName: 'Japanese' },
  { code: 'ru-RU', label: 'Russian (Русский)', langName: 'Russian' },
  { code: 'pt-BR', label: 'Portuguese (Português)', langName: 'Portuguese' },
];

function detectScriptLanguage(text) {
  if (!text) return null;
  if (/[\u0980-\u09FF]/.test(text)) return 'bn-IN'; // Bengali
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta-IN'; // Tamil
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te-IN'; // Telugu
  if (/[\u0A80-\u0AFF]/.test(text)) return 'gu-IN'; // Gujarati
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn-IN'; // Kannada
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml-IN'; // Malayalam
  if (/[\u0A00-\u0A7F]/.test(text)) return 'pa-IN'; // Punjabi
  if (/[\u0600-\u06FF]/.test(text)) return 'ur-IN'; // Urdu / Arabic
  if (/[\u0900-\u097F]/.test(text)) {
    if (/\b(आहे|नाही|मला|काय|कसे|दुखत|झाले|झाला|आहोत|होते|करा|येत|सांगा|घ्या)\b/.test(text)) {
      return 'mr-IN'; // Marathi
    }
    return 'hi-IN'; // Hindi
  }
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es-ES'; // Spanish
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr-FR'; // French
  if (/[äöüß]/i.test(text)) return 'de-DE'; // German
  if (/[ãõâêîôû]/i.test(text)) return 'pt-BR'; // Portuguese
  if (/[\u4e00-\u9fa5]/.test(text)) return 'zh-CN'; // Chinese
  if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP'; // Japanese
  if (/[\u0400-\u04FF]/.test(text)) return 'ru-RU'; // Russian
  return null;
}

const STATUS_LABELS = {
  idle: 'Ready to start',
  connecting: 'Connecting...',
  greeting: 'AI is speaking...',
  listening: 'Listening to you... (Speak naturally)',
  recording: 'Hearing you...',
  processing: 'Processing response...',
  thinking: 'AI is thinking...',
  speaking: 'AI is speaking...',
  ended: 'Call completed',
};

export default function LiveScreening() {
  // Call state
  const [callStatus, setCallStatus] = useState('idle');
  const [callActive, setCallActive] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [activeLang, setActiveLang] = useState('auto');
  const [mobileTab, setMobileTab] = useState('call'); // 'call' | 'transcript'

  // Report state
  const [reportData, setReportData] = useState(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

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
  const activeLangRef = useRef('auto');
  activeLangRef.current = activeLang;
  const detectedLangRef = useRef('en-US');
  const shouldEndCallRef = useRef(false);
  const hasSentTextTurnRef = useRef(false);

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

  // WebSocket hook declaration
  const wsHandlers = {
    onConnected: ({ sessionId }) => {
      setSessionId(sessionId);
    },
    onCallStarted: ({ isResume } = {}) => {
      setCallActive(true);
      callActiveRef.current = true;
      setCallStatus('greeting');
      audioQueueRef.current = [];
      isPlayingAudioRef.current = false;
      shouldEndCallRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      const baseDuration = isResume ? callDuration : 0;
      startTimeRef.current = Date.now() - baseDuration * 1000;
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
    onAiText: ({ text, isCompleted, useBrowserTTS }) => {
      if (isCompleted) {
        shouldEndCallRef.current = true;
      }
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
    onAudio: (audioBuffer, header) => {
      if (header?.isCompleted) {
        shouldEndCallRef.current = true;
      }
      audioQueueRef.current.push(audioBuffer);
      playNextAudio();
    },
    onGeneratingReport: () => {
      setCallStatus('ended');
      setCallActive(false);
      callActiveRef.current = false;
      setIsGeneratingReport(true);
      if (timerRef.current) clearInterval(timerRef.current);
    },
    onReportReady: ({ report }) => {
      setIsGeneratingReport(false);
      setReportData(report);
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

    hasSentTextTurnRef.current = true;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    currentTextRef.current = '';
    setInterimUserText('');

    stopListening();
    setCallStatus('thinking');

    sendJSON({ type: 'user_message', text });
  }, [interimUserText, sendJSON]);

  // Universal VAD (Voice Activity Detection) loop for Safari, Firefox, iOS, Android
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
            if (hasSentTextTurnRef.current) {
              return;
            }
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
            hasSentTextTurnRef.current = false;
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
              if (!hasSentTextTurnRef.current) {
                setCallStatus('processing');
                sendJSON({ type: 'audio_end' });
              }
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
        recognition.maxAlternatives = 1;

        const targetLang = (activeLangRef.current === 'auto' || !activeLangRef.current)
          ? (detectedLangRef.current || 'en-US')
          : activeLangRef.current;
        recognition.lang = targetLang;

        currentTextRef.current = '';
        setInterimUserText('');

        recognition.onstart = () => {
          if (!isSpeakingAIRef.current && callActiveRef.current) {
            setCallStatus('listening');
          }
        };

        recognition.onresult = (event) => {
          if (isSpeakingAIRef.current || isMutedRef.current || !callActiveRef.current) return;

          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const chunk = event.results[i][0]?.transcript || '';
            if (event.results[i].isFinal) {
              finalTranscript += chunk + ' ';
            } else {
              interimTranscript += chunk;
            }
          }

          const fullUtterance = (finalTranscript + interimTranscript).trim();
          if (fullUtterance) {
            currentTextRef.current = fullUtterance;
            setInterimUserText(fullUtterance);
            setCallStatus('recording');

            // Dynamically detect script and update target language
            const detected = detectScriptLanguage(fullUtterance);
            if (detected) {
              detectedLangRef.current = detected;
              if (activeLangRef.current === 'auto' && recognitionRef.current && recognitionRef.current.lang !== detected) {
                try {
                  recognitionRef.current.lang = detected;
                } catch (_) {}
              }
            }

            // Silence detector: 1.1s of silence -> fast auto submit to AI
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              handleAutoSubmit(fullUtterance);
            }, 1100);
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
      if (!mediaStreamRef.current || mediaStreamRef.current.getTracks().every((t) => t.readyState === 'ended')) {
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
          if (shouldEndCallRef.current) {
            shouldEndCallRef.current = false;
            setTimeout(() => {
              handleEndCall();
            }, 800);
            return;
          }
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
    const detectedLang = detectScriptLanguage(text) || (activeLangRef.current !== 'auto' ? activeLangRef.current : 'en-US');
    const langPrefix = detectedLang.split('-')[0];
    utterance.lang = detectedLang;

    let matchingVoice = voices.find(v => v.lang && (v.lang === detectedLang || v.lang.replace('_', '-').startsWith(detectedLang))) ||
                        voices.find(v => v.lang && (v.lang.startsWith(langPrefix) || v.lang.replace('_', '-').startsWith(langPrefix))) ||
                        voices.find(v => v.name.toLowerCase().includes(langPrefix));
    if (matchingVoice) utterance.voice = matchingVoice;
    currentUtteranceRef.current = utterance;

    const finishSpeaking = () => {
      if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
      currentUtteranceRef.current = null;
      isSpeakingAIRef.current = false;
      setIsTyping(false);

      if (callActiveRef.current) {
        if (shouldEndCallRef.current) {
          shouldEndCallRef.current = false;
          setTimeout(() => {
            handleEndCall();
          }, 800);
          return;
        }
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

  // Start Call
  const handleStartCall = async () => {
    setCallStatus('connecting');
    setMessages([]);
    setReportData(null);
    setIsGeneratingReport(false);
    shouldEndCallRef.current = false;
    hasSentTextTurnRef.current = false;
    setInterimUserText('');
    setCallDuration(0);
    isSpeakingAIRef.current = false;
    audioQueueRef.current = [];
    isPlayingAudioRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
    } catch (e) {
      showError('Microphone permission is required for voice calling.');
      setCallStatus('idle');
      return;
    }

    sendJSON({ type: 'start_call' });
  };

  // End Call
  const handleEndCall = () => {
    callActiveRef.current = false;
    isSpeakingAIRef.current = false;
    shouldEndCallRef.current = false;
    if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
    stopListening();

    if (activeAudioElementRef.current) {
      try { activeAudioElementRef.current.pause(); } catch (_) {}
      activeAudioElementRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setIsGeneratingReport(true);
    sendJSON({ type: 'end_call' });
    setCallStatus('ended');
    setCallActive(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setIsTyping(false);
  };

  // Restart Call (Continue with previous chat history)
  const handleRestartCall = async () => {
    setCallStatus('connecting');
    setReportData(null);
    setIsGeneratingReport(false);
    shouldEndCallRef.current = false;
    hasSentTextTurnRef.current = false;
    setInterimUserText('');
    isSpeakingAIRef.current = false;
    audioQueueRef.current = [];
    isPlayingAudioRef.current = false;

    try {
      if (!mediaStreamRef.current || mediaStreamRef.current.getTracks().every(t => t.readyState === 'ended')) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
      }
    } catch (e) {
      showError('Microphone permission is required for voice calling.');
      setCallStatus('ended');
      return;
    }

    sendJSON({
      type: 'restart_call',
      history: messages.map((m) => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.text,
      })),
    });
  };

  // Next Call (Fresh new session)
  const handleNextCall = () => {
    setCallStatus('idle');
    setCallActive(false);
    callActiveRef.current = false;
    setReportData(null);
    setIsGeneratingReport(false);
    shouldEndCallRef.current = false;
    hasSentTextTurnRef.current = false;
    setMessages([]);
    setInterimUserText('');
    setCallDuration(0);
  };

  // Toggle Mute
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    isMutedRef.current = nextMuted;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }

    if (nextMuted) {
      stopListening();
    } else {
      if (!isSpeakingAIRef.current && callActive) {
        startListening();
      }
    }
  };

  // Manual Submit
  const handleManualSpeakClick = () => {
    if (!callActive) return;
    if (callStatus === 'recording') {
      handleAutoSubmit(currentTextRef.current || interimUserText);
    } else if (callStatus === 'listening') {
      startListening();
    }
  };

  // Language Mode Toggle
  const handleSelectLang = (langCode) => {
    setActiveLang(langCode);
    activeLangRef.current = langCode;
    detectedLangRef.current = langCode === 'auto' ? 'en-US' : langCode;
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
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
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
    <div className="screening-layout">
      
      {/* Mobile Top Tab Bar (< 900px screens) */}
      <div className="mobile-view-tabs">
        <button
          className={`mobile-tab-btn ${mobileTab === 'call' ? 'active' : ''}`}
          onClick={() => setMobileTab('call')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>call</span>
          <span>Voice Screening</span>
        </button>

        <button
          className={`mobile-tab-btn ${mobileTab === 'transcript' ? 'active' : ''}`}
          onClick={() => setMobileTab('transcript')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>forum</span>
          <span>Transcript</span>
          {messages.length > 0 && (
            <span className="tab-badge">{messages.length}</span>
          )}
        </button>
      </div>

      {/* 1. LEFT SIDE: Adaptive Live Transcript Panel */}
      <div className={`transcript-panel ${mobileTab === 'call' ? 'mobile-hidden' : ''}`} style={{
        width: 380,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative'
      }}>
        <TranscriptPanel messages={messages} isTyping={isTyping} />
      </div>

      {/* 2. RIGHT / CENTER: Voice Visualizer Canvas or Clinical Report */}
      <div className={`screening-center ${mobileTab === 'transcript' ? 'mobile-hidden' : ''}`}>
        
        {/* If call is ended or generating report, render the Structured Health Report */}
        {callStatus === 'ended' || isGeneratingReport || reportData ? (
          <ReportView
            report={reportData}
            messages={messages}
            duration={callDuration}
            isLoading={isGeneratingReport}
            onRestartCall={handleRestartCall}
            onNextCall={handleNextCall}
          />
        ) : (
          <>
            {/* Top Bar: Status Pill + Multilingual Switcher */}
            <div className="screening-top-bar">
              {/* Status Pill */}
              <div className="status-pill" style={{ position: 'static', margin: 0 }}>
                <div className={`status-dot ${dotClass}`} />
                <span className="status-label">{statusLabel}</span>
              </div>

              {/* Language Mode Toggle & Dropdown */}
              <div className="lang-switcher-container" style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--color-surface)',
                padding: '4px',
                borderRadius: '14px',
                border: '1px solid var(--color-outline-variant)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                gap: 4,
                maxWidth: '100%'
              }}>
                <button
                  id="lang-auto-btn"
                  onClick={() => handleSelectLang('auto')}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '10px',
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background: activeLang === 'auto' ? 'var(--color-primary)' : 'transparent',
                    color: activeLang === 'auto' ? '#ffffff' : 'var(--color-on-surface-variant)',
                    boxShadow: activeLang === 'auto' ? '0 2px 6px rgba(0,82,204,0.3)' : 'none',
                    whiteSpace: 'nowrap'
                  }}
                >
                  🌐 Auto
                </button>

                <button
                  id="lang-english-btn"
                  onClick={() => handleSelectLang('en-US')}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '10px',
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background: activeLang === 'en-US' ? 'var(--color-primary)' : 'transparent',
                    color: activeLang === 'en-US' ? '#ffffff' : 'var(--color-on-surface-variant)',
                    boxShadow: activeLang === 'en-US' ? '0 2px 6px rgba(0,82,204,0.3)' : 'none',
                    whiteSpace: 'nowrap'
                  }}
                >
                  English
                </button>

                <button
                  id="lang-hindi-btn"
                  onClick={() => handleSelectLang('hi-IN')}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '10px',
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    background: activeLang === 'hi-IN' ? 'var(--color-primary)' : 'transparent',
                    color: activeLang === 'hi-IN' ? '#ffffff' : 'var(--color-on-surface-variant)',
                    boxShadow: activeLang === 'hi-IN' ? '0 2px 6px rgba(0,82,204,0.3)' : 'none',
                    whiteSpace: 'nowrap'
                  }}
                >
                  हिन्दी
                </button>

                {/* More Languages Dropdown */}
                <select
                  aria-label="Select Other Language"
                  value={['auto', 'en-US', 'hi-IN'].includes(activeLang) ? '' : activeLang}
                  onChange={(e) => {
                    if (e.target.value) handleSelectLang(e.target.value);
                  }}
                  style={{
                    padding: '5px 8px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-outline-variant)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: !['auto', 'en-US', 'hi-IN'].includes(activeLang) ? 'var(--color-primary-fixed)' : 'transparent',
                    color: !['auto', 'en-US', 'hi-IN'].includes(activeLang) ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
                    outline: 'none',
                    maxWidth: 130
                  }}
                >
                  <option value="">More (18+)...</option>
                  {SUPPORTED_LANGUAGES.filter((l) => !['auto', 'en-US', 'hi-IN'].includes(l.code)).map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Voice Orb Visualizer */}
            <div className="voice-orb-wrapper" style={{ margin: 'auto 0' }}>
              <VoiceOrb status={callStatus} />
            </div>

            {/* Live Speaking Subtitle */}
            {interimUserText && (
              <div style={{
                background: 'var(--color-surface-container)',
                border: '1.5px solid var(--color-primary-container)',
                borderRadius: '24px',
                padding: '10px 20px',
                marginBottom: 14,
                fontSize: 14,
                color: 'var(--color-on-surface)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 4px 16px rgba(0,82,204,0.1)',
                animation: 'fade-in-up 0.2s ease',
                maxWidth: '92%',
                textAlign: 'center'
              }}>
                <span className="material-symbols-outlined filled" style={{ fontSize: 18, color: 'var(--color-primary)' }}>mic</span>
                <span>"{interimUserText}"</span>
              </div>
            )}

            {/* Universal Voice Banner */}
            {callActive && (
              <div style={{
                fontSize: 12.5,
                color: 'var(--color-on-surface-variant)',
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                textAlign: 'center'
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#1a7a4a' }}>record_voice_over</span>
                <span>
                  <strong>Language:</strong> {SUPPORTED_LANGUAGES.find((l) => l.code === activeLang)?.label || 'Multilingual'} active. Speak naturally.
                </span>
              </div>
            )}

            {/* Call Action Controls */}
            <div className="call-controls">
              {callStatus === 'idle' && (
                <button
                  id="start-call-btn"
                  className="btn-start-call"
                  onClick={handleStartCall}
                  style={{ padding: '16px 36px', fontSize: 15 }}
                >
                  <span className="material-symbols-outlined filled" style={{ fontSize: 22 }}>call</span>
                  Start Voice Screening
                </button>
              )}

              {callStatus === 'connecting' && (
                <button className="btn-start-call" disabled style={{ padding: '16px 36px', fontSize: 15 }}>
                  <span className="material-symbols-outlined spin" style={{ fontSize: 22 }}>sync</span>
                  Connecting Call...
                </button>
              )}

              {callActive && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', width: '100%', justifyContent: 'center' }}>
                  {callStatus === 'recording' && (
                    <button
                      onClick={handleManualSpeakClick}
                      className="btn-outline"
                      style={{
                        padding: '12px 18px',
                        borderRadius: 'var(--radius)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 13.5,
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
                      padding: '12px 18px',
                      borderRadius: 'var(--radius)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13.5,
                      fontWeight: 600,
                      background: isMuted ? 'var(--color-error-container)' : 'var(--color-surface)',
                      color: isMuted ? 'var(--color-error)' : 'var(--color-on-surface)',
                      borderColor: isMuted ? 'var(--color-error)' : 'var(--color-outline-variant)'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      {isMuted ? 'mic_off' : 'mic'}
                    </span>
                    {isMuted ? 'Unmute' : 'Mute'}
                  </button>

                  {/* End Call Button */}
                  <button
                    id="end-call-btn"
                    className="btn-end-call"
                    onClick={handleEndCall}
                    style={{ padding: '12px 28px', fontSize: 14 }}
                  >
                    <span className="material-symbols-outlined filled" style={{ fontSize: 20 }}>call_end</span>
                    End Call & View Report
                  </button>
                </div>
              )}
            </div>

            {/* Context Card for Call Status */}
            <div className="context-card" style={{ maxWidth: 480, width: '100%', marginTop: 'auto' }}>
              <div className="context-card-title">Live Call Status</div>
              <div className="context-grid">
                <div>
                  <div className="context-label">Call State</div>
                  <div className="context-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className={`status-dot ${dotClass}`} style={{ width: 8, height: 8 }} />
                    {callActive ? 'In Progress' : 'Ready'}
                  </div>
                </div>
                <div>
                  <div className="context-label">Call Timer</div>
                  <div className="context-value">{callActive ? formatDuration(callDuration) : '00:00'}</div>
                </div>
                <div>
                  <div className="context-label">Exchanges</div>
                  <div className="context-value">{messages.filter((m) => m.role === 'user').length} answered</div>
                </div>
                <div>
                  <div className="context-label">Active Language</div>
                  <div className="context-value" style={{ color: '#0052cc', fontWeight: 600 }}>
                    {SUPPORTED_LANGUAGES.find((l) => l.code === activeLang)?.label || 'Auto-Detect'}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

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
