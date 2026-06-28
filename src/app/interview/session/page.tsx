'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, Play, Square, RotateCcw, ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';
import { transcribeAudio } from '@/lib/ai';

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
  const [transcribing, setTranscribing] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recorded, setRecorded] = useState([false, false, false, false, false]);
  const [transcriptError, setTranscriptError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

  useEffect(() => {
    return () => {
      stopCam();
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, [stopCam]);

  const startRecording = useCallback(async () => {
    if (!streamRef.current) await enableCam();
    const stream = streamRef.current;
    if (!stream) return;

    chunksRef.current = [];
    setTranscriptError('');

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      setTranscribing(true);
      try {
        const transcript = await transcribeAudio(blob, intLang);
        setAnswer(qIndex, transcript.trim());
        setRecorded(r => { const n = [...r]; n[qIndex] = true; return n; });
      } catch (err) {
        console.error('Transcription error:', err);
        setTranscriptError(
          lang === 'ar'
            ? 'تعذّر تحويل الصوت إلى نص. حاول مجددًا.'
            : 'Could not transcribe audio. Please try again.'
        );
      } finally {
        setTranscribing(false);
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
  }, [enableCam, intLang, lang, qIndex, setAnswer]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  const toggleRecord = () => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const reRecord = () => {
    if (recording) stopRecording();
    setAnswer(qIndex, '');
    setRecorded(r => { const n = [...r]; n[qIndex] = false; return n; });
    setElapsed(0);
    setTranscriptError('');
    chunksRef.current = [];
  };

  const next = () => {
    if (recording) stopRecording();
    if (qIndex >= 4) { stopCam(); router.push('/interview/results'); return; }
    setQIndex(i => i + 1); setRecording(false); setElapsed(0); setTranscriptError('');
  };

  const isRecorded = recorded[qIndex];
  const canProceed = isRecorded && !transcribing;
  const savedTranscript = answers[qIndex] ?? '';

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
        {/* Left: question + transcript */}
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
          <div style={{ background: 'var(--surface)', border: `1.5px solid ${recording ? 'var(--accent)' : transcribing ? '#f59e0b' : 'var(--border)'}`, borderRadius: 16, padding: '14px 16px', minHeight: 100, transition: 'border-color .2s', position: 'relative' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: recording ? 'var(--accent)' : transcribing ? '#f59e0b' : 'var(--fg3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {recording && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'qpulse 1s infinite', display: 'inline-block' }} />}
              {transcribing && <Loader2 size={13} style={{ animation: 'qspin 1s linear infinite' }} />}
              {lang === 'ar'
                ? (transcribing ? 'جارٍ التحويل بـ Whisper…' : 'النص المُحوَّل')
                : (transcribing ? 'Transcribing with Whisper…' : 'Transcript')}
            </div>
            {transcriptError ? (
              <p style={{ margin: 0, fontSize: 14, color: '#ef4444' }}>{transcriptError}</p>
            ) : savedTranscript ? (
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: 'var(--fg)' }}>{savedTranscript}</p>
            ) : (
              <p style={{ margin: 0, fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>
                {recording
                  ? (lang === 'ar' ? 'جارٍ التسجيل…' : 'Recording…')
                  : transcribing
                  ? (lang === 'ar' ? 'جارٍ معالجة الصوت…' : 'Processing audio…')
                  : (lang === 'ar' ? 'سيظهر النص هنا بعد التسجيل' : 'Transcript will appear after recording')}
              </p>
            )}
          </div>
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
            {transcribing && (
              <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(245,158,11,.9)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
                <Loader2 size={13} style={{ animation: 'qspin 1s linear infinite' }} />
                {lang === 'ar' ? 'تحويل…' : 'Transcribing…'}
              </div>
            )}
            {isRecorded && !recording && !transcribing && (
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(16,185,129,.9)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
                ✓ {tr.session.recorded}
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={toggleRecord}
              disabled={transcribing}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: 'none', background: recording ? '#ef4444' : 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '12px 18px', borderRadius: 12, cursor: transcribing ? 'not-allowed' : 'pointer', flex: 1, opacity: transcribing ? 0.6 : 1 }}>
              {recording ? <Square size={18} /> : isRecorded ? <RotateCcw size={18} /> : <Play size={18} />}
              {recording ? tr.session.stop : isRecorded ? tr.session.rerecord : tr.session.record}
            </button>
            {(isRecorded || transcriptError) && !recording && (
              <button onClick={reRecord} disabled={transcribing} title={tr.session.rerecord} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg2)', fontFamily: 'inherit', fontSize: 14, padding: '12px 14px', borderRadius: 12, cursor: transcribing ? 'not-allowed' : 'pointer', opacity: transcribing ? 0.6 : 1 }}>
                <RotateCcw size={17} />
              </button>
            )}
            <button onClick={next} disabled={!canProceed} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: `1px solid ${canProceed ? 'var(--accent)' : 'var(--border)'}`, background: canProceed ? 'var(--accent)' : 'var(--surface)', color: canProceed ? 'var(--accent-fg)' : 'var(--fg3)', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '12px 18px', borderRadius: 12, cursor: canProceed ? 'pointer' : 'not-allowed', opacity: canProceed ? 1 : 0.6, flex: 1 }}>
              {qIndex >= 4 ? tr.session.finish : tr.session.next}
              <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'scaleX(-1)' : 'none' }}><ArrowRight size={17} /></span>
            </button>
          </div>

          {!canProceed && !recording && !transcribing && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fg3)', textAlign: 'center' }}>
              {lang === 'ar' ? 'سجّل إجابتك للمتابعة' : 'Record your answer to continue'}
            </p>
          )}
          {transcribing && (
            <p style={{ margin: 0, fontSize: 13, color: '#f59e0b', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Loader2 size={13} style={{ animation: 'qspin 1s linear infinite' }} />
              {lang === 'ar' ? 'جارٍ تحليل الصوت بـ Whisper…' : 'Whisper is processing your audio…'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
