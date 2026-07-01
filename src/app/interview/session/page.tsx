'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, Square, RotateCcw, ArrowRight, Loader2, Volume2, VolumeX, RefreshCw } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';
import { transcribeAudio, fetchTTSAudio } from '@/lib/ai';

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

// Speaking waveform bars
function SpeakingBars({ active }: { active: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 28 }}>
      {[0.6, 1, 0.75, 1, 0.5, 0.85, 0.65].map((h, i) => (
        <div key={i} style={{
          width: 4, borderRadius: 2,
          background: active ? 'var(--accent)' : 'var(--fg3)',
          height: active ? `${h * 28}px` : '4px',
          transition: 'height .15s ease',
          animation: active ? `qbar${i % 3} .7s ease-in-out ${i * 0.08}s infinite alternate` : 'none',
        }} />
      ))}
      <style>{`
        @keyframes qbar0 { from { height: 6px } to { height: 22px } }
        @keyframes qbar1 { from { height: 10px } to { height: 28px } }
        @keyframes qbar2 { from { height: 4px } to { height: 18px } }
      `}</style>
    </div>
  );
}

// AI Interviewer Avatar
function AIAvatar({ speaking, listening, isAr }: { speaking: boolean; listening: boolean; isAr: boolean }) {
  const label = speaking
    ? (isAr ? 'يتحدث المحاور…' : 'Interviewer speaking…')
    : listening
    ? (isAr ? 'يستمع المحاور…' : 'Listening…')
    : (isAr ? 'المحاور الآلي' : 'AI Interviewer');

  const statusColor = speaking ? 'var(--accent)' : listening ? '#10b981' : 'var(--fg3)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', background: 'var(--surface)', border: `1.5px solid ${speaking ? 'var(--accent)' : listening ? '#10b981' : 'var(--border)'}`, borderRadius: 18, boxShadow: 'var(--shadow)', transition: 'border-color .3s' }}>
      {/* Avatar circle */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, boxShadow: speaking ? '0 0 0 4px rgba(2,132,199,.25)' : 'none',
          transition: 'box-shadow .3s',
          animation: speaking ? 'qpulse-ring 1.5s ease-in-out infinite' : 'none',
        }}>🤖</div>
        {/* Status dot */}
        <div style={{
          position: 'absolute', bottom: 2, right: 2,
          width: 12, height: 12, borderRadius: '50%',
          background: statusColor,
          border: '2px solid var(--surface)',
          transition: 'background .3s',
        }} />
        <style>{`
          @keyframes qpulse-ring {
            0%, 100% { box-shadow: 0 0 0 0px rgba(2,132,199,.4); }
            50% { box-shadow: 0 0 0 8px rgba(2,132,199,.0); }
          }
        `}</style>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg)', marginBottom: 4 }}>
          {isAr ? 'المحاور الذكي' : 'AI Interviewer'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SpeakingBars active={speaking} />
          <span style={{ fontSize: 12, color: statusColor, fontWeight: 600, transition: 'color .3s' }}>
            {label}
          </span>
        </div>
      </div>

      {listening && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.25)', borderRadius: 20, padding: '5px 12px' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', animation: 'qpulse 1s infinite', display: 'inline-block' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981' }}>
            {isAr ? 'يُسجَّل' : 'REC'}
          </span>
        </div>
      )}
    </div>
  );
}

// TTS hook — backed by ElevenLabs via Supabase edge function
function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef(false);
  const pendingOnEndRef = useRef<(() => void) | undefined>(undefined);
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playBlocked, setPlayBlocked] = useState(false);
  const [muted, setMuted] = useState(false);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const speak = useCallback(async (text: string, onEnd?: () => void) => {
    abortRef.current = true;
    cleanup();
    abortRef.current = false;
    setPlayBlocked(false);
    pendingOnEndRef.current = onEnd;
    if (muted) { onEnd?.(); return; }
    setLoading(true);
    try {
      const blob = await fetchTTSAudio(text);
      if (abortRef.current) return;
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); setLoading(false); cleanup(); onEnd?.(); };
      audio.onerror = () => { setSpeaking(false); setLoading(false); cleanup(); onEnd?.(); };
      setLoading(false);
      try {
        setSpeaking(true);
        await audio.play();
      } catch {
        // Autoplay blocked by browser — show tap-to-play prompt
        setSpeaking(false);
        setPlayBlocked(true);
      }
    } catch {
      if (!abortRef.current) { setLoading(false); setSpeaking(false); onEnd?.(); }
    }
  }, [muted, cleanup]);

  const manualPlay = useCallback(async () => {
    if (!audioRef.current) return;
    setPlayBlocked(false);
    const onEnd = pendingOnEndRef.current;
    audioRef.current.onended = () => { setSpeaking(false); cleanup(); onEnd?.(); };
    audioRef.current.onerror = () => { setSpeaking(false); cleanup(); onEnd?.(); };
    setSpeaking(true);
    try { await audioRef.current.play(); } catch { setSpeaking(false); onEnd?.(); }
  }, [cleanup]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    cleanup();
    setSpeaking(false);
    setLoading(false);
    setPlayBlocked(false);
  }, [cleanup]);

  const toggleMute = useCallback(() => {
    if (!muted) cancel();
    setMuted(m => !m);
  }, [muted, cancel]);

  useEffect(() => () => { abortRef.current = true; cleanup(); }, [cleanup]);

  return { speak, cancel, manualPlay, speaking, loading, playBlocked, muted, toggleMute };
}

type Phase = 'speaking' | 'ready' | 'recording' | 'transcribing' | 'done';

export default function InterviewSessionPage() {
  const { lang, intLang, questions, answers, setAnswer } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const isAr = lang === 'ar';

  const activeQuestions = questions.length === 5
    ? questions
    : (intLang === 'ar' ? FALLBACK_AR : FALLBACK_EN);

  const [qIndex, setQIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('speaking');
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recorded, setRecorded] = useState([false, false, false, false, false]);
  const [transcriptError, setTranscriptError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const spokenIndexRef = useRef(-1);

  const tts = useTTS();

  // Speak question when index changes
  useEffect(() => {
    if (spokenIndexRef.current === qIndex) return;
    spokenIndexRef.current = qIndex;
    setPhase('speaking');
    setTranscriptError('');
    tts.speak(activeQuestions[qIndex], () => setPhase('ready'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex]);

  const enableCam = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      camStreamRef.current = s;
      setCamOn(true); setCamError(false);
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch { setCamError(true); }
  }, []);

  const stopCam = useCallback(() => {
    camStreamRef.current?.getTracks().forEach(t => t.stop());
    camStreamRef.current = null; setCamOn(false);
    audioStreamRef.current?.getTracks().forEach(t => t.stop());
    audioStreamRef.current = null;
  }, []);

  useEffect(() => {
    enableCam();
    return () => {
      stopCam();
      tts.cancel();
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = useCallback(async () => {
    chunksRef.current = [];
    setTranscriptError('');

    let audioStream: MediaStream;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current?.getTracks().forEach(t => t.stop());
      audioStreamRef.current = audioStream;
    } catch {
      setTranscriptError(isAr ? 'تعذّر الوصول إلى الميكروفون.' : 'Microphone access denied.');
      return;
    }

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', '']
      .find(m => m === '' || MediaRecorder.isTypeSupported(m)) ?? '';
    const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      setPhase('transcribing');
      try {
        const transcript = await transcribeAudio(blob, intLang);
        setAnswer(qIndex, transcript.trim());
        setRecorded(r => { const n = [...r]; n[qIndex] = true; return n; });
        setPhase('done');
      } catch (err) {
        console.error('Transcription error:', err);
        setTranscriptError(isAr ? 'تعذّر تحويل الصوت إلى نص. حاول مجددًا.' : 'Could not transcribe audio. Please try again.');
        setPhase('ready');
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    setPhase('recording');
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
  }, [intLang, isAr, qIndex, setAnswer]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop();
    audioStreamRef.current?.getTracks().forEach(t => t.stop());
    audioStreamRef.current = null;
  }, []);

  const reRecord = () => {
    stopRecording();
    setAnswer(qIndex, '');
    setRecorded(r => { const n = [...r]; n[qIndex] = false; return n; });
    setElapsed(0);
    setTranscriptError('');
    chunksRef.current = [];
    // Re-speak question then allow recording
    spokenIndexRef.current = -1;
    tts.speak(activeQuestions[qIndex], () => setPhase('ready'));
    setPhase('speaking');
  };

  const replayQuestion = () => {
    if (phase === 'recording') stopRecording();
    spokenIndexRef.current = -1;
    tts.speak(activeQuestions[qIndex], () => setPhase(recorded[qIndex] ? 'done' : 'ready'));
    setPhase('speaking');
  };

  const next = () => {
    if (phase === 'recording') stopRecording();
    tts.cancel();
    if (qIndex >= 4) { stopCam(); router.push('/interview/results'); return; }
    spokenIndexRef.current = -1;
    setQIndex(i => i + 1);
    setElapsed(0);
    setTranscriptError('');
    setPhase('speaking');
  };

  const isRecorded = recorded[qIndex];
  const canProceed = isRecorded && phase !== 'transcribing' && phase !== 'recording';
  const savedTranscript = answers[qIndex] ?? '';

  return (
    <section style={{ maxWidth: 1160, margin: '0 auto', padding: 'clamp(20px,3.5vw,40px) clamp(16px,4vw,40px)' }}>

      {/* Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 700, fontSize: 13.5, padding: '7px 14px', borderRadius: 20 }}>
          <Mic size={16} />{tr.session.question} {qIndex + 1} {tr.session.of} 5
        </span>
        <div style={{ display: 'flex', gap: 6, flex: 1, maxWidth: 300 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: recorded[i] ? 'var(--accent)' : i === qIndex ? '#93c9f3' : 'var(--surface2)', transition: 'background .3s' }} />
          ))}
        </div>
        {/* Mute toggle */}
        <button
          onClick={tts.toggleMute}
          title={tts.muted ? (isAr ? 'تفعيل الصوت' : 'Unmute AI voice') : (isAr ? 'كتم الصوت' : 'Mute AI voice')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', background: tts.muted ? 'rgba(239,68,68,.1)' : 'var(--surface)', color: tts.muted ? '#ef4444' : 'var(--fg2)', fontFamily: 'inherit', fontWeight: 600, fontSize: 13, padding: '7px 12px', borderRadius: 10, cursor: 'pointer' }}>
          {tts.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          {tts.muted ? (isAr ? 'الصوت مكتوم' : 'Voice off') : (isAr ? 'الصوت مفعّل' : 'Voice on')}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 24 }}>

        {/* LEFT: AI Interviewer + Question + Transcript */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* AI Avatar */}
          <AIAvatar
            speaking={phase === 'speaking'}
            listening={phase === 'recording'}
            isAr={isAr}
          />

          {/* Question card */}
          <div style={{
            background: 'var(--surface)',
            border: `1.5px solid ${phase === 'speaking' ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 20, padding: 24, boxShadow: 'var(--shadow)',
            transition: 'border-color .3s',
            position: 'relative', overflow: 'hidden',
          }}>
            {phase === 'speaking' && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, var(--accent), #8b5cf6)', borderRadius: '20px 20px 0 0', animation: 'qslide 1.5s linear infinite' }} />
            )}
            <style>{`@keyframes qslide { 0%{opacity:1} 50%{opacity:.4} 100%{opacity:1} }`}</style>
            <p style={{ margin: 0, fontSize: 'clamp(17px,2vw,22px)', fontWeight: 700, lineHeight: 1.5, color: 'var(--fg)' }}>
              {activeQuestions[qIndex]}
            </p>

            {/* TTS controls */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {tts.playBlocked ? (
                <button
                  onClick={tts.manualPlay}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 9, cursor: 'pointer', animation: 'qpulse-btn .9s ease-in-out infinite alternate' }}>
                  <Volume2 size={14} />
                  {isAr ? '▶ اضغط لسماع السؤال' : '▶ Tap to hear question'}
                  <style>{`@keyframes qpulse-btn { from { opacity: 1 } to { opacity: .7 } }`}</style>
                </button>
              ) : (
                <button
                  onClick={replayQuestion}
                  disabled={phase === 'recording' || phase === 'transcribing'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--fg2)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 9, cursor: 'pointer', opacity: (phase === 'recording' || phase === 'transcribing') ? 0.5 : 1 }}>
                  <RefreshCw size={13} />
                  {isAr ? 'إعادة السؤال' : 'Replay Question'}
                </button>
              )}
              {phase === 'speaking' && !tts.playBlocked && (
                <button
                  onClick={() => { tts.cancel(); setPhase(isRecorded ? 'done' : 'ready'); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.07)', color: '#ef4444', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 9, cursor: 'pointer' }}>
                  <VolumeX size={13} />
                  {isAr ? 'إيقاف' : 'Stop'}
                </button>
              )}
            </div>
          </div>

          {/* Status hint */}
          {tts.playBlocked && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 12, padding: '10px 14px' }}>
              <Volume2 size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 13, color: 'var(--fg2)' }}>
                {isAr ? 'اضغط على زر "اضغط لسماع السؤال" لتشغيل الصوت.' : 'Tap the button above to play the question aloud.'}
              </p>
            </div>
          )}
          {phase === 'speaking' && !tts.playBlocked && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--accent-soft)', border: '1px solid rgba(2,132,199,.15)', borderRadius: 12, padding: '10px 14px' }}>
              {tts.loading
                ? <Loader2 size={15} style={{ color: 'var(--accent)', flexShrink: 0, animation: 'qspin 1s linear infinite' }} />
                : <Volume2 size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
              <p style={{ margin: 0, fontSize: 13, color: 'var(--fg2)' }}>
                {tts.loading
                  ? (isAr ? 'جارٍ تحميل صوت المحاور…' : 'Loading interviewer voice…')
                  : (isAr ? 'المحاور يقرأ السؤال… انتظر حتى ينتهي ثم سجّل إجابتك.' : 'The AI interviewer is reading the question. Wait for it to finish, then record your answer.')}
              </p>
            </div>
          )}
          {phase === 'ready' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', borderRadius: 12, padding: '10px 14px' }}>
              <Mic size={15} style={{ color: '#10b981', flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 13, color: 'var(--fg2)' }}>
                {isAr ? 'يمكنك الآن تسجيل إجابتك.' : "The interviewer is ready. Record your answer now."}
              </p>
            </div>
          )}
          {(phase === 'done' || isRecorded) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', borderRadius: 12, padding: '10px 14px' }}>
              <span style={{ fontSize: 15, color: '#10b981', flexShrink: 0 }}>✓</span>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--fg2)' }}>
                {isAr ? 'تم تسجيل إجابتك. انتقل إلى السؤال التالي أو أعد التسجيل.' : 'Answer recorded. Proceed to the next question or re-record.'}
              </p>
            </div>
          )}

          {/* Transcript panel */}
          <div style={{ background: 'var(--surface)', border: `1.5px solid ${phase === 'recording' ? 'var(--accent)' : phase === 'transcribing' ? '#f59e0b' : 'var(--border)'}`, borderRadius: 16, padding: '14px 16px', minHeight: 90, transition: 'border-color .2s' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: phase === 'recording' ? 'var(--accent)' : phase === 'transcribing' ? '#f59e0b' : 'var(--fg3)', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {phase === 'recording' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'qpulse 1s infinite', display: 'inline-block' }} />}
              {phase === 'transcribing' && <Loader2 size={12} style={{ animation: 'qspin 1s linear infinite' }} />}
              {isAr
                ? (phase === 'transcribing' ? 'جارٍ التحويل بـ Whisper…' : 'إجابتك')
                : (phase === 'transcribing' ? 'Transcribing with Whisper…' : 'Your Answer')}
            </div>
            {transcriptError ? (
              <p style={{ margin: 0, fontSize: 14, color: '#ef4444' }}>{transcriptError}</p>
            ) : savedTranscript ? (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--fg)' }}>{savedTranscript}</p>
            ) : (
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fg3)', fontStyle: 'italic' }}>
                {phase === 'recording'
                  ? (isAr ? 'جارٍ التسجيل…' : 'Recording your answer…')
                  : phase === 'transcribing'
                  ? (isAr ? 'جارٍ معالجة الصوت…' : 'Processing audio…')
                  : phase === 'speaking'
                  ? (isAr ? 'انتظر حتى ينتهي المحاور من السؤال' : 'Wait for the interviewer to finish…')
                  : (isAr ? 'سيظهر نص إجابتك هنا بعد التسجيل' : 'Your answer transcript will appear here')}
              </p>
            )}
          </div>
        </div>

        {/* RIGHT: Camera + Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Camera */}
          <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', background: 'var(--surface2)', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${phase === 'recording' ? 'var(--accent)' : 'var(--border)'}`, transition: 'border-color .3s' }}>
            <video ref={videoRef} autoPlay muted playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: camOn ? 'block' : 'none' }} />
            {!camOn && (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Mic size={38} style={{ color: 'var(--fg3)', opacity: .35, marginBottom: 10 }} />
                <p style={{ color: 'var(--fg2)', fontSize: 13.5, marginBottom: 12 }}>
                  {camError
                    ? (isAr ? 'تعذّر الوصول إلى الكاميرا. يمكنك المتابعة صوتيًا.' : 'Camera blocked. Audio-only mode active.')
                    : tr.session.camPrompt}
                </p>
                {!camError && (
                  <button onClick={enableCam} style={{ border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, padding: '9px 18px', borderRadius: 9, cursor: 'pointer' }}>
                    {tr.session.enable}
                  </button>
                )}
              </div>
            )}

            {/* Overlays */}
            {(phase === 'speaking' || tts.playBlocked) && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                {tts.playBlocked
                  ? <Volume2 size={32} style={{ color: '#f59e0b', opacity: .9 }} />
                  : tts.loading
                  ? <Loader2 size={32} style={{ color: '#fff', opacity: .9, animation: 'qspin 1s linear infinite' }} />
                  : <Volume2 size={32} style={{ color: '#fff', opacity: .9 }} />}
                <span style={{ color: tts.playBlocked ? '#f59e0b' : '#fff', fontWeight: 700, fontSize: 14, textAlign: 'center', padding: '0 16px' }}>
                  {tts.playBlocked
                    ? (isAr ? 'اضغط لسماع السؤال' : 'Tap to hear question')
                    : tts.loading
                    ? (isAr ? 'جارٍ التحميل…' : 'Loading voice…')
                    : (isAr ? 'المحاور يتحدث…' : 'Interviewer speaking…')}
                </span>
              </div>
            )}
            {phase === 'recording' && (
              <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 8 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,.92)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', animation: 'qpulse 1.2s infinite', display: 'inline-block' }} />REC
                </span>
                <span style={{ background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8 }}>{fmt(elapsed)}</span>
              </div>
            )}
            {phase === 'transcribing' && (
              <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(245,158,11,.9)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
                <Loader2 size={12} style={{ animation: 'qspin 1s linear infinite' }} />
                {isAr ? 'تحويل…' : 'Transcribing…'}
              </div>
            )}
            {phase === 'done' && !phase.includes('recording') && (
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(16,185,129,.9)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 8 }}>
                ✓ {isAr ? 'مسجَّل' : 'Recorded'}
              </div>
            )}

            {/* "You" label */}
            <div style={{ position: 'absolute', bottom: 10, left: 12, background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7 }}>
              {isAr ? 'أنت' : 'You'}
            </div>
          </div>

          {/* Record / Next controls */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {/* Record / Stop button */}
            {phase !== 'done' || !isRecorded ? (
              <button
                onClick={() => phase === 'recording' ? stopRecording() : startRecording()}
                disabled={phase === 'speaking' || phase === 'transcribing'}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  border: 'none',
                  background: phase === 'recording' ? '#ef4444' : phase === 'speaking' || phase === 'transcribing' ? 'var(--surface2)' : 'var(--accent)',
                  color: phase === 'speaking' || phase === 'transcribing' ? 'var(--fg3)' : '#fff',
                  fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '13px 20px', borderRadius: 13,
                  cursor: phase === 'speaking' || phase === 'transcribing' ? 'not-allowed' : 'pointer',
                  flex: 1, opacity: phase === 'speaking' ? 0.6 : 1,
                  transition: 'background .2s',
                }}>
                {phase === 'recording' ? <Square size={18} /> : <Mic size={18} />}
                {phase === 'recording'
                  ? (isAr ? 'إيقاف' : 'Stop Recording')
                  : phase === 'speaking'
                  ? (isAr ? 'انتظر المحاور…' : 'Wait for interviewer…')
                  : phase === 'transcribing'
                  ? (isAr ? 'جارٍ المعالجة…' : 'Processing…')
                  : (isAr ? 'سجّل إجابتك' : 'Record Answer')}
              </button>
            ) : (
              <button
                onClick={reRecord}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg2)', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, padding: '13px 18px', borderRadius: 13, cursor: 'pointer', flex: 1 }}>
                <RotateCcw size={16} />
                {isAr ? 'إعادة التسجيل' : 'Re-record'}
              </button>
            )}

            {/* Next button */}
            <button
              onClick={next}
              disabled={!canProceed}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                border: `1px solid ${canProceed ? 'var(--accent)' : 'var(--border)'}`,
                background: canProceed ? 'var(--accent)' : 'var(--surface)',
                color: canProceed ? '#fff' : 'var(--fg3)',
                fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '13px 20px', borderRadius: 13,
                cursor: canProceed ? 'pointer' : 'not-allowed',
                opacity: canProceed ? 1 : 0.55, flex: 1,
                transition: 'background .2s, border-color .2s',
              }}>
              {qIndex >= 4 ? (isAr ? 'عرض النتائج' : 'View Results') : (isAr ? 'السؤال التالي' : 'Next Question')}
              <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'scaleX(-1)' : 'none' }}><ArrowRight size={17} /></span>
            </button>
          </div>

          {/* Status text */}
          {phase === 'transcribing' && (
            <p style={{ margin: 0, fontSize: 13, color: '#f59e0b', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Loader2 size={13} style={{ animation: 'qspin 1s linear infinite' }} />
              {isAr ? 'Whisper يحلّل الصوت…' : 'Whisper is processing your audio…'}
            </p>
          )}
          {transcriptError && (
            <p style={{ margin: 0, fontSize: 13, color: '#ef4444', textAlign: 'center' }}>{transcriptError}</p>
          )}
          {phase === 'speaking' && !tts.muted && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fg3)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              {tts.loading ? <Loader2 size={13} style={{ animation: 'qspin 1s linear infinite' }} /> : <Volume2 size={13} />}
              {tts.loading
                ? (isAr ? 'جارٍ تحميل الصوت…' : 'Fetching audio…')
                : (isAr ? 'زر التسجيل سيُفعَّل بعد انتهاء المحاور' : 'Record button unlocks after the interviewer finishes')}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
