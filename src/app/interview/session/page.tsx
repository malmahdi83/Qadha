'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, Play, Square, RotateCcw, ArrowRight, Sparkles } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';

// Extend window type for SpeechRecognition
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SpeechRecognition: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webkitSpeechRecognition: any;
  }
}

function fmt(s: number) {
  const m = Math.floor(s / 60), ss = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

const FALLBACK_EN = [
  "Tell me about yourself and why you're interested in this role.",
  'Describe a challenging project you worked on and how you handled it.',
  'How do you prioritize tasks when facing multiple deadlines?',
  'Tell me about a time you disagreed with a teammate. How did you resolve it?',
  'Where do you see yourself professionally in five years?',
];
const FALLBACK_AR = [
  'حدّثنا عن نفسك ولماذا تهتم بهذه الوظيفة.',
  'صف مشروعًا صعبًا عملت عليه وكيف تعاملت معه.',
  'كيف ترتّب أولوياتك عند مواجهة عدة مواعيد نهائية؟',
  'حدّثنا عن موقف اختلفت فيه مع زميل، وكيف حللته؟',
  'أين ترى نفسك مهنيًا بعد خمس سنوات؟',
];

export default function InterviewSessionPage() {
  const { lang, intLang, questions, answers, setAnswer } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  const activeQuestions = questions.length === 5
    ? questions
    : (intLang === 'ar' ? FALLBACK_AR : FALLBACK_EN);

  const [qIndex, setQIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recorded, setRecorded] = useState([false, false, false, false, false]);
  // Live transcript shown while recording; committed to context on stop
  const [liveTranscript, setLiveTranscript] = useState('');
  const [srSupported, setSrSupported] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const srRef = useRef<any>(null);
  // Accumulates final results from SpeechRecognition across restarts
  const transcriptRef = useRef('');

  const enableCam = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      streamRef.current = s;
      setCamOn(true); setCamError(false);
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch { setCamError(true); }
  }, []);

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null; setCamOn(false);
  }, []);

  const stopSR = useCallback(() => {
    if (srRef.current) { srRef.current.onend = null; srRef.current.stop(); srRef.current = null; }
  }, []);

  const startSR = useCallback((lang: string) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSrSupported(false); return; }

    const sr = new SR();
    sr.lang = lang === 'ar' ? 'ar-SA' : 'en-US';
    sr.continuous = true;
    sr.interimResults = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sr.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          transcriptRef.current += res[0].transcript + ' ';
        } else {
          interim += res[0].transcript;
        }
      }
      setLiveTranscript(transcriptRef.current + interim);
    };

    // Auto-restart while still recording (browser stops after silence)
    sr.onend = () => {
      if (srRef.current) {
        try { srRef.current.start(); } catch { /* already stopped */ }
      }
    };

    srRef.current = sr;
    try { sr.start(); } catch { setSrSupported(false); }
  }, []);

  useEffect(() => {
    return () => {
      stopCam();
      stopSR();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopCam, stopSR]);

  const toggleRecord = () => {
    if (recording) {
      // Stop
      if (timerRef.current) clearInterval(timerRef.current);
      stopSR();
      // Save final transcript for this question
      const final = transcriptRef.current.trim();
      setAnswer(qIndex, final || liveTranscript.trim());
      setRecording(false);
      setRecorded(r => { const n = [...r]; n[qIndex] = true; return n; });
    } else {
      // Start
      if (!camOn) enableCam();
      // Reset transcript for fresh recording
      transcriptRef.current = '';
      setLiveTranscript('');
      setRecording(true); setElapsed(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
      startSR(intLang);
    }
  };

  const reRecord = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopSR();
    transcriptRef.current = '';
    setLiveTranscript('');
    setAnswer(qIndex, '');
    setRecording(false);
    setRecorded(r => { const n = [...r]; n[qIndex] = false; return n; });
    setElapsed(0);
  };

  const next = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopSR();
    if (qIndex >= 4) { stopCam(); router.push('/interview/results'); return; }
    // Reset live transcript state for next question (answer already in context)
    transcriptRef.current = '';
    setLiveTranscript('');
    setQIndex(i => i + 1); setRecording(false); setElapsed(0);
  };

  const isRecorded = recorded[qIndex];
  const canProceed = isRecorded;
  const savedTranscript = answers[qIndex] ?? '';
  const displayTranscript = recording ? liveTranscript : savedTranscript;

  return (
    <section style={{ maxWidth: 1160, margin: '0 auto', padding: 'clamp(20px,3.5vw,40px) clamp(16px,4vw,40px)' }}>
      {/* Progress */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 700, fontSize: 13.5, padding: '7px 14px', borderRadius: 20 }}>
          <Mic size={16} />{tr.session.question} {qIndex + 1} {tr.session.of} 5
        </span>
        <div style={{ display: 'flex', gap: 6, flex: 1, maxWidth: 300 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: recorded[i] ? 'var(--accent)' : i === qIndex ? '#93c9f3' : 'var(--surface2)', transition: 'background .3s' }} />
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 24 }}>
        {/* Left: question + live transcript */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
            <p style={{ margin: 0, fontSize: 'clamp(18px,2.2vw,24px)', fontWeight: 700, lineHeight: 1.45 }}>
              {activeQuestions[qIndex]}
            </p>
          </div>

          <div style={{ background: 'var(--accent-soft)', border: '1px solid rgba(2,132,199,.15)', borderRadius: 14, padding: '12px 16px', display: 'flex', gap: 10 }}>
            <Sparkles size={17} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
            <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 13.5 }}>{tr.session.tip}</p>
          </div>

          {/* Transcript panel */}
          {srSupported ? (
            <div style={{ background: 'var(--surface)', border: `1.5px solid ${recording ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 16, padding: '14px 16px', minHeight: 100, transition: 'border-color .2s', position: 'relative' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: recording ? 'var(--accent)' : 'var(--fg3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                {recording && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'qpulse 1s infinite', display: 'inline-block' }} />}
                {lang === 'ar' ? 'النص المُحوَّل' : 'Transcript'}
              </div>
              {displayTranscript ? (
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: 'var(--fg)' }}>{displayTranscript}</p>
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>
                  {recording
                    ? (lang === 'ar' ? 'جارٍ الاستماع…' : 'Listening…')
                    : (lang === 'ar' ? 'سيظهر النص هنا أثناء التسجيل' : 'Transcript will appear here while you record')}
                </p>
              )}
            </div>
          ) : (
            <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 14, padding: '12px 16px', fontSize: 13.5, color: '#d97706' }}>
              {lang === 'ar'
                ? 'التعرف على الكلام غير مدعوم في هذا المتصفح. جرّب Chrome أو Edge.'
                : 'Speech recognition is not supported in this browser. Try Chrome or Edge.'}
            </div>
          )}
        </div>

        {/* Right: camera + controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', background: 'var(--surface2)', aspectRatio: '16/10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video ref={videoRef} autoPlay muted playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: camOn ? 'block' : 'none' }} />
            {!camOn && (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Mic size={40} style={{ color: 'var(--fg3)', opacity: .4, marginBottom: 10 }} />
                <p style={{ color: 'var(--fg2)', fontSize: 14, marginBottom: 14 }}>
                  {camError
                    ? (lang === 'ar' ? 'تعذّر الوصول إلى الكاميرا. يمكنك المتابعة بدونها.' : 'Camera blocked. You can still continue.')
                    : tr.session.camPrompt}
                </p>
                {!camError && (
                  <button onClick={enableCam} style={{ border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 20px', borderRadius: 10, cursor: 'pointer' }}>
                    {tr.session.enable}
                  </button>
                )}
              </div>
            )}
            {recording && (
              <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,.92)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'qpulse 1.2s infinite', display: 'inline-block' }} />REC
                </span>
                <span style={{ background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8 }}>{fmt(elapsed)}</span>
              </div>
            )}
            {isRecorded && !recording && (
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(16,185,129,.9)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
                ✓ {tr.session.recorded}
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={toggleRecord} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', background: recording ? '#ef4444' : 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '12px 18px', borderRadius: 12, cursor: 'pointer', flex: 1 }}>
              {recording ? <Square size={18} /> : isRecorded ? <RotateCcw size={18} /> : <Play size={18} />}
              {recording ? tr.session.stop : isRecorded ? tr.session.rerecord : tr.session.record}
            </button>
            {isRecorded && !recording && (
              <button onClick={reRecord} title={tr.session.rerecord} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg2)', fontFamily: 'inherit', fontSize: 14, padding: '12px 14px', borderRadius: 12, cursor: 'pointer' }}>
                <RotateCcw size={17} />
              </button>
            )}
            <button onClick={next} disabled={!canProceed} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: `1px solid ${canProceed ? 'var(--accent)' : 'var(--border)'}`, background: canProceed ? 'var(--accent)' : 'var(--surface)', color: canProceed ? 'var(--accent-fg)' : 'var(--fg3)', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '12px 18px', borderRadius: 12, cursor: canProceed ? 'pointer' : 'not-allowed', opacity: canProceed ? 1 : 0.6, flex: 1 }}>
              {qIndex >= 4 ? tr.session.finish : tr.session.next}
              <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'scaleX(-1)' : 'none' }}><ArrowRight size={17} /></span>
            </button>
          </div>

          {!canProceed && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fg3)', textAlign: 'center' }}>
              {lang === 'ar' ? 'سجّل إجابتك للمتابعة' : 'Record your answer to continue'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
