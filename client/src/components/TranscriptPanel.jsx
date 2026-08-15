// src/components/TranscriptPanel.jsx
// Left-side live transcript panel that dynamically adapts language & labels

import { useEffect, useRef } from 'react';

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Detect language of the conversation
function getConversationLanguage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i].text || '';
    if (/[\u0900-\u097F]/.test(text)) return 'hi';
    if (/[\u0980-\u09FF]/.test(text)) return 'bn';
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
    if (/[\u0A80-\u0AFF]/.test(text)) return 'gu';
    if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';
    if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
    if (/[\u0A00-\u0A7F]/.test(text)) return 'pa';
    if (/[\u0600-\u06FF]/.test(text)) return 'ar';
    if (/[áéíóúñ¿¡]/i.test(text)) return 'es';
    if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr';
    if (/[äöüß]/i.test(text)) return 'de';
    if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
    if (/[\u3040-\u30ff]/.test(text)) return 'ja';
    if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  }
  return 'en';
}

const UI_STRINGS = {
  en: { title: 'Live Transcript', patient: 'Patient', ai: 'MediVoice AI', emptyTitle: 'Live transcript will appear here', emptySub: 'Start a call to begin the voice screening', badge: 'English' },
  hi: { title: 'लाइव बातचीत (Transcript)', patient: 'मरीज़ (Patient)', ai: 'मेडीवॉइस AI', emptyTitle: 'लाइव बातचीत यहाँ दिखाई देगी', emptySub: 'बातचीत शुरू करने के लिए कॉल शुरू करें', badge: 'हिन्दी (Hindi)' },
  mr: { title: 'थेट संभाषण (Transcript)', patient: 'रुग्ण (Patient)', ai: 'मेडीव्हॉइस AI', emptyTitle: 'थेट संभाषण येथे दिसेल', emptySub: 'कॉल सुरू करा', badge: 'मराठी (Marathi)' },
  bn: { title: 'সরাসরি কথোপকথন', patient: 'রোগী (Patient)', ai: 'মেডিভয়েস AI', emptyTitle: 'এখানে কথোপকথন দেখা যাবে', emptySub: 'কল শুরু করুন', badge: 'বাংলা (Bengali)' },
  ta: { title: 'நேரடி உரையாடல்', patient: 'நோயாளி (Patient)', ai: 'மெடிவாய்ஸ் AI', emptyTitle: 'இங்கு உரையாடல் தோன்றும்', emptySub: 'அழைப்பைத் தொடங்குங்கள்', badge: 'தமிழ் (Tamil)' },
  te: { title: 'ప్రత్యక్ష సంభాషణ', patient: 'రోగి (Patient)', ai: 'మెడివాయిస్ AI', emptyTitle: 'సంభాషణ ఇక్కడ కనిపిస్తుంది', emptySub: 'కాల్ ప్రారంభించండి', badge: 'తెలుగు (Telugu)' },
  gu: { title: 'લાઈવ વાતચીત', patient: 'દર્દી (Patient)', ai: 'મેડીવોઈસ AI', emptyTitle: 'વાતચીત અહીં દેખાશે', emptySub: 'કૉલ શરૂ કરો', badge: 'ગુજરાતી (Gujarati)' },
  kn: { title: 'ಲೈವ್ ಸಂಭಾಷಣೆ', patient: 'ರೋಗಿ (Patient)', ai: 'ಮೆಡಿವಾಯ್ಸ್ AI', emptyTitle: 'ಸಂಭಾಷಣೆ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ', emptySub: 'ಕರೆ ಪ್ರಾರಂಭಿಸಿ', badge: 'ಕನ್ನಡ (Kannada)' },
  ml: { title: 'തത്സമയ സംഭാഷണം', patient: 'രോഗി (Patient)', ai: 'മെഡിവോയ്സ് AI', emptyTitle: 'സംഭാഷണം ഇവിടെ കാണാം', emptySub: 'കോൾ ആരംഭിക്കുക', badge: 'മലയാളം (Malayalam)' },
  pa: { title: 'ਲਾਈਵ ਗੱਲਬਾਤ', patient: 'ਮਰੀਜ਼ (Patient)', ai: 'ਮੈਡੀਵਾਇਸ AI', emptyTitle: 'ਗੱਲਬਾਤ ਇੱਥੇ ਦਿਖਾਈ ਦੇਵੇਗੀ', emptySub: 'ਕਾਲ ਸ਼ੁਰੂ ਕਰੋ', badge: 'ਪੰਜਾਬੀ (Punjabi)' },
  ar: { title: 'المحادثة المباشرة', patient: 'المريض', ai: 'ميديفويس AI', emptyTitle: 'ستظهر المحادثة هنا', emptySub: 'ابدأ المكالمة للبدء', badge: 'العربية (Arabic)' },
  es: { title: 'Transcripción en vivo', patient: 'Paciente', ai: 'MediVoice AI', emptyTitle: 'La transcripción aparecerá aquí', emptySub: 'Inicie una llamada para comenzar', badge: 'Español' },
  fr: { title: 'Transcription en direct', patient: 'Patient', ai: 'MediVoice AI', emptyTitle: 'La transcription apparaîtra ici', emptySub: 'Démarrez un appel pour commencer', badge: 'Français' },
  de: { title: 'Live-Transkript', patient: 'Patient', ai: 'MediVoice AI', emptyTitle: 'Live-Transkript erscheint hier', emptySub: 'Starten Sie den Anruf', badge: 'Deutsch' },
  zh: { title: '实时记录 (Transcript)', patient: '患者 (Patient)', ai: 'MediVoice AI', emptyTitle: '实时记录将显示在此处', emptySub: '点击开始通话', badge: '中文 (Chinese)' },
  ja: { title: 'リアルタイム文字起こし', patient: '患者 (Patient)', ai: 'MediVoice AI', emptyTitle: '文字起こしがここに表示されます', emptySub: '通話を開始してください', badge: '日本語 (Japanese)' },
  ru: { title: 'Транскрипция разговора', patient: 'Пациент', ai: 'MediVoice AI', emptyTitle: 'Транскрипция появится здесь', emptySub: 'Начните звонок', badge: 'Русский' },
};

/**
 * @param {Array} messages - [{role: 'user'|'ai', text: string, timestamp: number}]
 * @param {boolean} isTyping - Show AI typing indicator
 */
export default function TranscriptPanel({ messages = [], isTyping = false }) {
  const bottomRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const lang = getConversationLanguage(messages);
  const t = UI_STRINGS[lang] || UI_STRINGS.en;

  return (
    <aside className="transcript-panel" style={{
      width: 380,
      flexShrink: 0,
      background: 'var(--color-surface-container-low)',
      borderRight: '1px solid var(--color-outline-variant)',
      borderLeft: 'none',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'relative'
    }}>
      {/* Brand Header */}
      <div style={{
        padding: '18px 20px 14px',
        borderBottom: '1px solid var(--color-outline-variant)',
        background: 'var(--color-surface)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--color-primary-container)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 2px 8px rgba(0,82,204,0.25)'
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>health_and_safety</span>
          </div>
          <div className="navbar-logo" style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-primary)' }}>
            Medi<span>Voice</span> AI
          </div>
        </div>

        {/* Download Transcript Button */}
        {messages.length > 0 && (
          <button
            className="icon-btn"
            title="Download Transcript"
            onClick={() => {
              const text = messages.map(m => `${m.role === 'ai' ? t.ai : t.patient}: ${m.text}`).join('\n\n');
              const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `medivoice-transcript-${Date.now()}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{ width: 32, height: 32 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>
          </button>
        )}
      </div>

      {/* Transcript Header Label & Language Badge */}
      <div style={{
        padding: '12px 20px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(0,0,0,0.04)'
      }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-on-surface-variant)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--color-primary)' }}>forum</span>
          {t.title}
        </div>

        <span style={{
          fontSize: 11,
          fontWeight: 600,
          background: 'var(--color-surface)',
          padding: '2px 8px',
          borderRadius: 6,
          border: '1px solid var(--color-outline-variant)',
          color: 'var(--color-primary)'
        }}>
          🌐 {t.badge}
        </span>
      </div>

      {/* Message Stream */}
      <div className="transcript-messages" style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14
      }}>
        {messages.length === 0 && !isTyping ? (
          <div className="transcript-empty" style={{ margin: 'auto 0', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>
            <span className="material-symbols-outlined filled" style={{ fontSize: 36, color: 'var(--color-outline)', marginBottom: 8, display: 'block' }}>
              chat_bubble_outline
            </span>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{t.emptyTitle}</p>
            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{t.emptySub}</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isAI = msg.role === 'ai';
            return (
              <div
                key={index}
                className={`message-bubble ${isAI ? 'message-ai' : 'message-user'}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignSelf: isAI ? 'flex-start' : 'flex-end',
                  maxWidth: '88%',
                  animation: 'fade-in-up 0.2s ease',
                  background: isAI ? 'var(--color-surface)' : 'var(--color-primary-container)',
                  color: isAI ? 'var(--color-on-surface)' : '#ffffff',
                  padding: '12px 14px',
                  borderRadius: isAI ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  border: isAI ? '1px solid var(--color-outline-variant)' : 'none'
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  opacity: 0.8
                }}>
                  <span>{isAI ? t.ai : t.patient}</span>
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{formatTime(msg.timestamp)}</span>
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {msg.text}
                </div>
              </div>
            );
          })
        )}

        {/* AI Typing Indicator */}
        {isTyping && (
          <div className="message-bubble message-ai" style={{
            alignSelf: 'flex-start',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-outline-variant)',
            padding: '10px 16px',
            borderRadius: '4px 16px 16px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-primary)' }}>{t.ai}</span>
            <div className="typing-indicator" style={{ display: 'inline-flex', gap: 4 }}>
              <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-primary)' }} />
              <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-primary)' }} />
              <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-primary)' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </aside>
  );
}
