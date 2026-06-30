'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Presentation, Play, Square, Sparkles, Loader2 } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';
import { transcribeAudio } from '@/lib/ai';

function fmt(s: number) {
  const m = Math.floor(s / 60), ss = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

export default function PresentationRecordingPage() {
  const { lang, intLang, topic, setPresResults, setPresTranscript } = useApp();
  const tr = t(lang);
  const router = useRouter();

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [done, setDone] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef('');

  const enableCam = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      streamRef.current = s;
      setCamOn(true);
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch { setCamError(true); }
  }, []);

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }, []);

  useEffect(() => { enableCam(); return () => { stopCam(); if (timerRef.current) clearInterval(timerRef.current); }; }, [enableCam, stopCam]);

  const toggleRecord = () => {
    if (recording) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      setRecording(false);
    } else {
      const stream = streamRef.current;
      if (!stream) return;

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', '']
        .find(m => m === '' || MediaRecorder.isTypeSupported(m)) ?? '';

      chunksRef.current = [];
      setError('');
      setDone(false);

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setTranscribing(true);
        try {
          const transcript = await transcribeAudio(blob, intLang);
          transcriptRef.current = transcript.trim();
          setPresTranscript(transcript.trim());
          setDone(true);
        } catch (err) {
          console.error('Transcription error:', err);
          setError(
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
    }
  };

  const submit = () => {
    if (!done) return;
    stopCam();
    setPresResults(null);
    router.push('/presentation/results');
  };

  return (
    <section style={{ maxWidth: 920, margin: '0 auto', padding: 'clamp(24px,4vw,48px) clamp(16px,4vw,40px)' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(139,92,246,.12)', color: '#8b5cf6', fontWeight: 600, fontSize: 13, padding: '7px 14px', borderRadius: 20, marginBottom: 12 }}>
        <Presentation size={15} />{tr.pres.recTitle}
      </div>
      <h1 style={{ margin: '0 0 24px', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800 }}>{topic || (lang === 'ar' ? 'موضوعك' : 'Your topic')}</h1>

      {/* Camera */}
      <div style={{ position: 'relative', borderRadius: 20, overflow: 'hidden', background: 'rgba(139,92,246,.08)', border: '1px solid rgba(139,92,246,.2)', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: camOn ? 'block' : 'none' }} />
        {!camOn && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Presentation size={48} style={{ color: '#8b5cf6', opacity: .4, marginBottom: 12 }} />
            <p style={{ color: 'var(--fg2)', fontSize: 14 }}>{camError ? (lang === 'ar' ? 'تعذّر الوصول إلى الكاميرا.' : 'Camera access blocked.') : tr.session.camPrompt}</p>
          </div>
        )}
        {recording && (
          <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,.92)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'qpulse 1.2s infinite', display: 'inline-block' }} />REC
            </span>
            <span style={{ background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8 }}>{fmt(elapsed)}</span>
          </div>
        )}
        {transcribing && (
          <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(139,92,246,.9)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
            <Loader2 size={13} style={{ animation: 'qspin 1s linear infinite' }} />
            {lang === 'ar' ? 'تحويل بـ Whisper…' : 'Transcribing with Whisper…'}
          </div>
        )}
        {done && !recording && !transcribing && (
          <div style={{ position: 'absolute', top: 14, left: 14, background: 'rgba(16,185,129,.9)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
            ✓ {lang === 'ar' ? 'جاهز' : 'Ready'}
          </div>
        )}
      </div>

      {/* Transcript preview */}
      {(done || error) && (
        <div style={{ background: 'var(--surface)', border: `1px solid ${error ? 'rgba(239,68,68,.3)' : 'rgba(139,92,246,.2)'}`, borderRadius: 14, padding: '14px 18px', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: error ? '#ef4444' : '#8b5cf6', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {lang === 'ar' ? (error ? 'خطأ' : 'النص المُحوَّل') : (error ? 'Error' : 'Transcript')}
          </div>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.65, color: error ? '#ef4444' : 'var(--fg)' }}>
            {error || transcriptRef.current || (lang === 'ar' ? '(لا يوجد كلام مُتعرَّف عليه)' : '(No speech detected)')}
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
        <button
          onClick={submit}
          disabled={recording || transcribing || !done}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: 'none', background: '#8b5cf6', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '14px 24px', borderRadius: 13, cursor: (recording || transcribing || !done) ? 'not-allowed' : 'pointer', flex: 1, opacity: (recording || transcribing || !done) ? 0.5 : 1 }}>
          {transcribing ? <Loader2 size={18} style={{ animation: 'qspin 1s linear infinite' }} /> : null}
          {transcribing ? (lang === 'ar' ? 'جارٍ التحويل…' : 'Transcribing…') : tr.pres.submit}
        </button>
      </div>
    </section>
  );
}
