'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Presentation, Play, Square, Sparkles, Loader2, Mic, RotateCcw } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';
import { transcribeAudio, countFillerWords, getAuthToken, detectLanguage, QuestionMetrics } from '@/lib/ai';
import { createClient } from '@/lib/supabase';

function fmt(s: number) {
  const m = Math.floor(s / 60), ss = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

export default function PresentationRecordingPage() {
  const { lang, intLang, topic, setPresResults, setPresTranscript, setPresSpeechMetrics, presContentOnly, setPresContentOnly } = useApp();
  const tr = t(lang);
  const router = useRouter();

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [done, setDone] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');

  // Mismatch state
  const [mismatchPhase, setMismatchPhase] = useState<'none' | 'mismatch'>('none');
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [pendingMetrics, setPendingMetrics] = useState<QuestionMetrics | null>(null);
  const [mismatchDetectedLang, setMismatchDetectedLang] = useState<'ar' | 'en' | 'mixed' | 'unknown'>('unknown');

  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const enableCam = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      camStreamRef.current = s;
      setCamOn(true);
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch { setCamError(true); }
  }, []);

  const stopCam = useCallback(() => {
    camStreamRef.current?.getTracks().forEach(t => t.stop());
    camStreamRef.current = null;
    audioStreamRef.current?.getTracks().forEach(t => t.stop());
    audioStreamRef.current = null;
    setCamOn(false);
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/auth/login');
    });
  }, [router]);

  useEffect(() => {
    enableCam();
    return () => {
      stopCam();
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    };
  }, [enableCam, stopCam]);

  const startRecording = async () => {
    setError('');
    setDone(false);
    setTranscript('');
    setMismatchPhase('none');
    setPendingTranscript(null);
    setPendingMetrics(null);
    setMismatchDetectedLang('unknown');
    chunksRef.current = [];

    // Capture auth token NOW while the session is guaranteed fresh (user just tapped Record)
    const authToken = await getAuthToken();

    let audioStream: MediaStream;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current?.getTracks().forEach(t => t.stop());
      audioStreamRef.current = audioStream;
    } catch {
      setError(lang === 'ar' ? 'تعذّر الوصول إلى الميكروفون.' : 'Microphone access denied.');
      return;
    }

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', '']
      .find(m => m === '' || MediaRecorder.isTypeSupported(m)) ?? '';

    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

    const recordingStart = Date.now(); // capture start time here, not from a ref set later
    recorder.onstop = async () => {
      const durationSeconds = Math.max(0, (Date.now() - recordingStart) / 1000);
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      setTranscribing(true);
      try {
        const { transcript: text, detectedLanguage: groqLang, pauseCount, avgPauseDuration, longestPauseDuration } =
          await transcribeAudio(blob, intLang, authToken);
        const trimmed = text.trim();

        // Two-source language detection (same as interview)
        const textLang = detectLanguage(trimmed);
        const expectedLang: 'ar' | 'en' | 'mixed' | 'unknown' = intLang === 'ar' ? 'ar' : 'en';
        let spokenLang: 'ar' | 'en' | 'mixed' | 'unknown';
        if (textLang === 'mixed') {
          spokenLang = 'mixed';
        } else if (groqLang !== 'unknown') {
          spokenLang = groqLang;
        } else {
          spokenLang = textLang;
        }

        // Filler detection uses the ACTUAL spoken language
        let fillerWords: { word: string; count: number }[];
        if (spokenLang === 'mixed') {
          const arF = countFillerWords(trimmed, 'ar');
          const enF = countFillerWords(trimmed, 'en');
          const fMap: Record<string, number> = {};
          [...arF, ...enF].forEach(f => { fMap[f.word] = (fMap[f.word] ?? 0) + f.count; });
          fillerWords = Object.entries(fMap).map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
        } else {
          fillerWords = countFillerWords(trimmed, spokenLang === 'ar' ? 'ar' : 'en');
        }

        const wordCount = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
        const wpm = durationSeconds > 2 && wordCount > 0
          ? Math.round(wordCount / (durationSeconds / 60))
          : 0;
        const metrics: QuestionMetrics = {
          durationSeconds: parseFloat(durationSeconds.toFixed(1)),
          wordCount,
          wpm,
          fillerWords,
          pauseCount,
          avgPauseDuration,
          longestPauseDuration,
        };

        const spokenLangStr: string = spokenLang;
        const isMismatch = trimmed.length > 5 &&
          (spokenLangStr === 'mixed' || (spokenLangStr !== 'unknown' && spokenLangStr !== expectedLang));

        if (isMismatch) {
          setPendingTranscript(trimmed);
          setPendingMetrics(metrics);
          setMismatchDetectedLang(spokenLang);
          setMismatchPhase('mismatch');
        } else {
          setPresSpeechMetrics(metrics);
          setTranscript(trimmed);
          setPresTranscript(trimmed);
          setPresContentOnly(false);
          setDone(true);
        }
      } catch (err) {
        console.error('Transcription error:', err);
        setError(lang === 'ar' ? 'تعذّر تحويل الصوت إلى نص. حاول مجددًا.' : 'Could not transcribe audio. Please try again.');
      } finally {
        setTranscribing(false);
        audioStreamRef.current?.getTracks().forEach(t => t.stop());
        audioStreamRef.current = null;
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    setRecording(false);
  };

  const toggleRecord = () => {
    if (recording) stopRecording();
    else startRecording();
  };

  const handleMismatchRetry = () => {
    setPendingTranscript(null);
    setPendingMetrics(null);
    setMismatchDetectedLang('unknown');
    setMismatchPhase('none');
  };

  const handleMismatchContentOnly = () => {
    if (!pendingTranscript || !pendingMetrics) return;
    setPresSpeechMetrics(pendingMetrics);
    setTranscript(pendingTranscript);
    setPresTranscript(pendingTranscript);
    setPresContentOnly(true);
    setPendingTranscript(null);
    setPendingMetrics(null);
    setMismatchDetectedLang('unknown');
    setMismatchPhase('none');
    setDone(true);
  };

  const reRecord = () => {
    setDone(false);
    setTranscript('');
    setPresTranscript('');
    setPresSpeechMetrics(null);
    setPresContentOnly(false);
    setMismatchPhase('none');
    setPendingTranscript(null);
    setPendingMetrics(null);
    setMismatchDetectedLang('unknown');
    setError('');
  };

  const submit = () => {
    if (!done) return;
    stopCam();
    setPresResults(null);
    router.push('/presentation/results');
  };

  // Language label helpers
  const langLabel = (l: 'ar' | 'en' | 'mixed' | 'unknown') => {
    if (lang === 'ar') {
      if (l === 'ar') return 'العربية';
      if (l === 'en') return 'الإنجليزية';
      if (l === 'mixed') return 'مختلطة';
      return 'غير معروفة';
    }
    if (l === 'ar') return 'Arabic';
    if (l === 'en') return 'English';
    if (l === 'mixed') return 'Mixed';
    return 'Unknown';
  };

  const expectedLangLabel = intLang === 'ar' ? langLabel('ar') : langLabel('en');

  return (
    <section style={{ maxWidth: 920, margin: '0 auto', padding: 'clamp(24px,4vw,48px) clamp(16px,4vw,40px)' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(139,92,246,.12)', color: '#8b5cf6', fontWeight: 600, fontSize: 13, padding: '7px 14px', borderRadius: 20, marginBottom: 12 }}>
        <Presentation size={15} />{tr.pres.recTitle}
      </div>
      <h1 style={{ margin: '0 0 24px', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800 }}>{topic || (lang === 'ar' ? 'موضوعك' : 'Your topic')}</h1>

      {/* Camera */}
      <div style={{ position: 'relative', borderRadius: 20, overflow: 'hidden', background: '#111', border: '1px solid rgba(139,92,246,.2)', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: camOn ? 'block' : 'none' }} />
        {!camOn && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Mic size={48} style={{ color: '#8b5cf6', opacity: .4, marginBottom: 12 }} />
            <p style={{ color: 'var(--fg2)', fontSize: 14, margin: 0 }}>
              {camError
                ? (lang === 'ar' ? 'الكاميرا غير متاحة — سيعمل التسجيل الصوتي فقط.' : 'Camera unavailable — audio recording will still work.')
                : (lang === 'ar' ? 'جارٍ تشغيل الكاميرا…' : 'Starting camera…')}
            </p>
          </div>
        )}

        {recording && (
          <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,.92)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'qpulse 1.2s infinite', display: 'inline-block' }} />REC
            </span>
            <span style={{ background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8 }}>{fmt(elapsed)}</span>
          </div>
        )}
        {transcribing && (
          <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(139,92,246,.9)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
            <Loader2 size={13} style={{ animation: 'qspin 1s linear infinite' }} />
            {lang === 'ar' ? 'جارٍ التحويل بـ Whisper…' : 'Transcribing with Whisper…'}
          </div>
        )}
        {done && !recording && !transcribing && (
          <div style={{ position: 'absolute', top: 14, left: 14, background: 'rgba(16,185,129,.9)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
            ✓ {lang === 'ar' ? 'تم التسجيل' : 'Recorded'}
          </div>
        )}
      </div>

      {/* Transcript preview */}
      {(done || transcribing || error) && (
        <div style={{ background: 'var(--surface)', border: `1.5px solid ${error ? 'rgba(239,68,68,.3)' : transcribing ? 'rgba(139,92,246,.4)' : 'rgba(139,92,246,.2)'}`, borderRadius: 14, padding: '14px 18px', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: error ? '#ef4444' : '#8b5cf6', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
            {transcribing && <Loader2 size={13} style={{ animation: 'qspin 1s linear infinite' }} />}
            {lang === 'ar' ? (error ? 'خطأ' : 'النص المُحوَّل') : (error ? 'Error' : 'Transcript')}
          </div>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: error ? '#ef4444' : 'var(--fg)' }}>
            {error || transcript || (lang === 'ar' ? 'جارٍ المعالجة…' : 'Processing…')}
          </p>
          {done && presContentOnly && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#d97706', fontWeight: 600 }}>
              {lang === 'ar' ? '⚠️ تقييم محتوى فقط (لغة مختلفة)' : '⚠️ Content-only evaluation (language mismatch)'}
            </div>
          )}
        </div>
      )}

      {/* Language mismatch dialog */}
      {mismatchPhase === 'mismatch' && (
        <div style={{ background: 'var(--surface)', border: '2px solid #f59e0b', borderRadius: 18, padding: '24px 26px', marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
            <span style={{ fontSize: 26, flexShrink: 0 }}>⚠️</span>
            <div>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#d97706' }}>
                {lang === 'ar' ? 'تم اكتشاف تعارض في اللغة' : 'Language Mismatch Detected'}
              </h3>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--fg2)', lineHeight: 1.55 }}>
                {lang === 'ar'
                  ? `اللغة المحددة للعرض: ${expectedLangLabel} — اللغة المكتشفة في التسجيل: ${langLabel(mismatchDetectedLang)}`
                  : `Selected presentation language: ${expectedLangLabel} — Detected in recording: ${langLabel(mismatchDetectedLang)}`}
              </p>
            </div>
          </div>

          {pendingTranscript && (
            <div style={{ background: 'var(--surface2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                {lang === 'ar' ? 'نص العرض المُسجَّل (الأصلي، غير مترجم):' : 'Your recorded presentation (original, not translated):'}
              </div>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--fg)', maxHeight: 120, overflowY: 'auto' }}>{pendingTranscript}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              onClick={handleMismatchRetry}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: '#8b5cf6', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '12px 20px', borderRadius: 12, cursor: 'pointer' }}>
              <RotateCcw size={15} />
              {lang === 'ar' ? 'إعادة التسجيل (موصى به)' : 'Retry Recording (Recommended)'}
            </button>
            <button
              onClick={handleMismatchContentOnly}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--fg)', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, padding: '12px 20px', borderRadius: 12, cursor: 'pointer' }}>
              {lang === 'ar' ? 'تقييم المحتوى فقط' : 'Evaluate Content Only'}
            </button>
          </div>

          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg3)', lineHeight: 1.5 }}>
            {lang === 'ar'
              ? 'تقييم المحتوى فقط يعني أن الذكاء الاصطناعي سيُقيّم أفكارك وبنيتك ووضوح رسالتك دون الأخذ بعين الاعتبار جودة اللغة.'
              : 'Content-only evaluation means the AI will assess your ideas, structure, and message clarity without penalizing language quality.'}
          </p>
        </div>
      )}

      {/* Tip */}
      <div style={{ background: 'rgba(139,92,246,.08)', border: '1px solid rgba(139,92,246,.15)', borderRadius: 14, padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 20 }}>
        <Sparkles size={17} style={{ color: '#8b5cf6', flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 14 }}>{tr.pres.topicTip}</p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={toggleRecord}
          disabled={transcribing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: 'none', background: recording ? '#ef4444' : '#8b5cf6', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '14px 24px', borderRadius: 13, cursor: transcribing ? 'not-allowed' : 'pointer', flex: 1, opacity: transcribing ? 0.6 : 1 }}>
          {recording ? <Square size={18} /> : <Play size={18} />}
          {recording ? tr.session.stop : tr.session.record}
        </button>

        {(done || mismatchPhase === 'mismatch') && !recording && (
          <button onClick={reRecord} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: '1px solid rgba(139,92,246,.4)', background: 'transparent', color: '#8b5cf6', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, padding: '14px 18px', borderRadius: 13, cursor: 'pointer' }}>
            {lang === 'ar' ? 'إعادة التسجيل' : 'Re-record'}
          </button>
        )}

        <button
          onClick={submit}
          disabled={!done || recording || transcribing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: 'none', background: '#8b5cf6', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '14px 24px', borderRadius: 13, cursor: (!done || recording || transcribing) ? 'not-allowed' : 'pointer', flex: 1, opacity: (!done || recording || transcribing) ? 0.45 : 1 }}>
          {tr.pres.submit}
        </button>
      </div>

      {!done && !recording && !transcribing && mismatchPhase === 'none' && (
        <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--fg3)', textAlign: 'center' }}>
          {lang === 'ar' ? 'سجّل عرضك أولاً للمتابعة' : 'Record your presentation first to continue'}
        </p>
      )}
      {transcribing && (
        <p style={{ margin: '12px 0 0', fontSize: 13, color: '#8b5cf6', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Loader2 size={13} style={{ animation: 'qspin 1s linear infinite' }} />
          {lang === 'ar' ? 'جارٍ تحليل الصوت بـ Whisper…' : 'Whisper is processing your audio…'}
        </p>
      )}
    </section>
  );
}
