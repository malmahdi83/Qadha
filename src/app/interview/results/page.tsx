'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCcw, Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { useApp, InterviewResults, QuestionMetrics } from '@/lib/context';
import { t } from '@/lib/i18n';
import { analyzePerformance, saveSession, SpeechSummary } from '@/lib/ai';

const ROLE_LABELS: Record<string, string> = {
  dev: 'Software Developer', pm: 'Project Manager', acc: 'Accountant',
  hr: 'HR Specialist', mkt: 'Marketing Specialist', cs: 'Customer Service',
};
const EDU_LABELS: Record<string, string> = {
  diploma: 'Diploma', bachelor: "Bachelor's", master: "Master's",
};
const EXP_LABELS: Record<string, string> = {
  fresh: 'Fresh Graduate', junior: 'Junior', mid: 'Mid-Level', senior: 'Senior',
};

// Aggregate per-question metrics into a single summary for the AI and for display
function aggregateSpeechMetrics(
  metrics: (QuestionMetrics | null)[],
  answeredIndices: number[]
): SpeechSummary | null {
  const valid = answeredIndices
    .map(i => metrics[i])
    .filter((m): m is QuestionMetrics => m != null && m.wpm > 0);

  if (valid.length === 0) return null;

  const avgWpm = Math.round(valid.reduce((s, m) => s + m.wpm, 0) / valid.length);
  const totalPauseCount = valid.reduce((s, m) => s + m.pauseCount, 0);
  const avgPauseDuration =
    totalPauseCount > 0
      ? parseFloat(
          (valid.reduce((s, m) => s + m.avgPauseDuration * m.pauseCount, 0) / totalPauseCount).toFixed(2)
        )
      : 0;
  const longestPauseDuration = parseFloat(
    Math.max(0, ...valid.map(m => m.longestPauseDuration)).toFixed(2)
  );

  // Merge filler counts across questions
  const fillerMap: Record<string, number> = {};
  for (const m of valid) {
    for (const f of m.fillerWords) {
      fillerMap[f.word] = (fillerMap[f.word] ?? 0) + f.count;
    }
  }
  const fillerWords = Object.entries(fillerMap)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);

  return { avgWpm, fillerWords, pauseCount: totalPauseCount, avgPauseDuration, longestPauseDuration };
}

function ScoreGauge({ score }: { score: number }) {
  const r = 70, C = 2 * Math.PI * r;
  const offset = (C * (1 - score / 100)).toFixed(1);
  const col = score >= 80 ? '#10b981' : score >= 60 ? 'var(--accent)' : '#f59e0b';
  return (
    <div style={{ position: 'relative', width: 170, height: 170 }}>
      <svg width="170" height="170" viewBox="0 0 170 170" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="85" cy="85" r={r} fill="none" stroke="var(--surface2)" strokeWidth="14" />
        <circle cx="85" cy="85" r={r} fill="none" stroke={col} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={C.toFixed(1)} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 38, fontWeight: 800, color: col }}>{score}</span>
        <span style={{ fontSize: 13, color: 'var(--fg3)', fontWeight: 600 }}>/100</span>
      </div>
    </div>
  );
}

function Bar({ label, value, max = 100, color = 'var(--accent)', tooltip }: {
  label: string; value: number; max?: number; color?: string; tooltip?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {label}
          {tooltip && (
            <span
              title={tooltip}
              style={{ marginLeft: 5, cursor: 'help', color: 'var(--fg3)', fontSize: 13 }}
            >ⓘ</span>
          )}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}<span style={{ fontSize: 12, color: 'var(--fg3)' }}>/{max}</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
        <div style={{ width: `${(value / max) * 100}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 1s ease' }} />
      </div>
    </div>
  );
}

function AccordionCard({
  index, question, userAnswer, idealAnswer, lang,
}: { index: number; question: string; userAnswer: string; idealAnswer: string; lang: string }) {
  const [open, setOpen] = useState(false);
  const isAr = lang === 'ar';
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '18px 22px', background: 'none', border: 'none', cursor: 'pointer', textAlign: isAr ? 'right' : 'left', fontFamily: 'inherit' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{index + 1}</div>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 15, color: 'var(--fg)', lineHeight: 1.4 }}>{question}</span>
        <ChevronDown size={18} style={{ color: 'var(--fg3)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ padding: '0 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: 'rgba(2,132,199,.07)', border: '1.5px solid rgba(2,132,199,.2)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
              {isAr ? 'إجابتك' : 'Your Answer'}
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>
              {userAnswer || (isAr ? '(لم تُقدَّم إجابة)' : '(no answer given)')}
            </p>
          </div>

          <div style={{ background: 'rgba(16,185,129,.07)', border: '1.5px solid rgba(16,185,129,.25)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#10b981', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
              {isAr ? 'الإجابة المثالية' : 'Ideal Answer'}
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>
              {idealAnswer || (isAr ? 'جارٍ التوليد…' : 'Generating…')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InterviewResultsPage() {
  const { lang, role, education, experience, intLang, questions, answers, answerMetrics,
    interviewResults, setInterviewResults, resetInterview, interviewMode } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const calledRef = useRef(false);
  const savedRef = useRef(false);
  const [loading, setLoading] = useState(!interviewResults);
  const [error, setError] = useState('');

  // Pre-compute aggregated speech metrics once
  const answeredIndices = answers.map((a, i) => a ? i : -1).filter(i => i >= 0);
  const speechSummary = aggregateSpeechMetrics(answerMetrics, answeredIndices);

  useEffect(() => {
    if (interviewResults || calledRef.current) { setLoading(false); return; }
    calledRef.current = true;

    const qaPairs = questions.length === 5
      ? questions.map((q, i) => ({ question: q, answer: answers[i] || '(no answer provided)' }))
      : answers.filter(Boolean).map((a, i) => ({ question: `Question ${i + 1}`, answer: a }));

    if (qaPairs.length === 0) {
      setError(lang === 'ar' ? 'لا توجد إجابات لتحليلها.' : 'No answers to analyze.');
      setLoading(false); return;
    }

    analyzePerformance<InterviewResults>({
      mode: 'interview',
      lang: intLang,
      role: ROLE_LABELS[role] ?? role,
      education: EDU_LABELS[education] ?? education,
      experience: EXP_LABELS[experience] ?? experience,
      questions: qaPairs,
      speechMetrics: speechSummary ?? {
        avgWpm: 0,
        fillerWords: [],
        pauseCount: 0,
        avgPauseDuration: 0,
        longestPauseDuration: 0,
      },
    })
      .then(res => { setInterviewResults(res); setLoading(false); })
      .catch(err => {
        console.error('Analyze error:', err);
        setError(lang === 'ar'
          ? 'تعذّر تحليل الأداء. يُرجى المحاولة مجددًا.'
          : 'Could not analyze performance. Please try again.');
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save to DB once results are available
  useEffect(() => {
    if (!interviewResults || savedRef.current) return;
    savedRef.current = true;

    const qaPairs = questions.map((q, i) => ({ question: q, answer: answers[i] || '' }));

    saveSession({
      mode: 'interview',
      lang: intLang,
      role: ROLE_LABELS[role] ?? role,
      education: EDU_LABELS[education] ?? education,
      experience: EXP_LABELS[experience] ?? experience,
      questions: qaPairs,
      answers: answers,
      score_overall: interviewResults.overall_score,
      score_communication: interviewResults.communication,
      score_confidence: interviewResults.confidence,
      score_quality: interviewResults.answer_quality,
      // Store real code-computed values in DB
      pace_wpm: speechSummary?.avgWpm ?? undefined,
      filler_words: speechSummary?.fillerWords ?? [],
      long_pauses: speechSummary?.pauseCount ?? undefined,
      ai_feedback: interviewResults.ai_feedback,
      strengths: interviewResults.strengths,
      improvements: interviewResults.improvements,
      recommendations: interviewResults.recommendations,
      ideal_answers: interviewResults.ideal_answers,
    }).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewResults]);

  if (loading) {
    return (
      <section style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={32} style={{ color: 'var(--accent)', animation: 'qspin 1s linear infinite' }} />
        </div>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>
          {lang === 'ar' ? 'جارٍ تحليل أدائك…' : 'Analyzing your performance…'}
        </h2>
        <p style={{ margin: 0, color: 'var(--fg2)', textAlign: 'center', maxWidth: '28em' }}>
          {lang === 'ar' ? 'يراجع الذكاء الاصطناعي إجاباتك ويحضّر تقريرًا مفصّلًا.' : 'AI is reviewing your answers and preparing a detailed report.'}
        </p>
      </section>
    );
  }

  if (error || !interviewResults) {
    return (
      <section style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
        <AlertCircle size={48} style={{ color: '#f59e0b' }} />
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>{lang === 'ar' ? 'خطأ في التحليل' : 'Analysis Error'}</h2>
        <p style={{ color: 'var(--fg2)', textAlign: 'center', maxWidth: '28em' }}>{error}</p>
        <button onClick={() => router.push('/interview/session')} style={{ border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '12px 24px', borderRadius: 12, cursor: 'pointer' }}>
          {lang === 'ar' ? 'العودة للجلسة' : 'Back to Session'}
        </button>
      </section>
    );
  }

  const r2 = interviewResults;
  const isAr = lang === 'ar';

  const confidenceTooltip = isAr
    ? 'تقدير مبني على: وتيرة الكلام، كثافة كلمات الحشو، تكرار التوقفات، واكتمال الإجابات. ليس قياسًا نفسيًا أو صوتيًا مباشرًا.'
    : 'Estimated from: speaking pace, filler word density, pause frequency, and answer completeness. Not a direct acoustic or psychological measurement.';

  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(20px,3.5vw,44px) clamp(16px,4vw,40px)' }}>
      {/* Hero */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 24, padding: 'clamp(24px,4vw,48px)', boxShadow: 'var(--shadow)', marginBottom: 24, display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap' }}>
        <ScoreGauge score={r2.overall_score} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: 'var(--accent)', textTransform: 'uppercase' }}>
              {isAr ? 'نتيجة المقابلة' : 'Interview Score'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--surface2)', color: 'var(--fg3)', border: '1px solid var(--border)', padding: '2px 10px', borderRadius: 20 }}>
              {isAr ? tr.session.interviewModeLabel : tr.session.interviewModeLabel}:{' '}
              {interviewMode === 'real'
                ? (isAr ? tr.session.realModeLabel : tr.session.realModeLabel)
                : (isAr ? tr.session.assistedModeLabel : tr.session.assistedModeLabel)}
            </span>
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, letterSpacing: '-.02em' }}>
            {isAr ? 'تقرير الأداء' : 'Performance Report'}
          </h1>
          <p style={{ margin: '0 0 20px', color: 'var(--fg2)', fontSize: 15 }}>
            {r2.overall_score >= 80
              ? (isAr ? 'أداء ممتاز! أنت مستعد للمقابلة.' : 'Excellent performance! You\'re interview-ready.')
              : r2.overall_score >= 60
              ? (isAr ? 'أداء جيد مع مجال للتحسين.' : 'Good performance with room to improve.')
              : (isAr ? 'يحتاج الأمر إلى مزيد من التدريب.' : 'More practice will sharpen your skills.')}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => { resetInterview(); router.push('/interview/setup'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 11, cursor: 'pointer' }}>
              <RotateCcw size={16} />{isAr ? 'محاولة جديدة' : 'Try Again'}
            </button>
            <button onClick={() => router.push('/modes')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 11, cursor: 'pointer' }}>
              {isAr ? 'اختر وضعًا آخر' : 'Try Another Mode'}<ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, marginBottom: 20 }}>
        {/* Sub-scores */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{isAr ? 'تفاصيل الأداء' : 'Performance Breakdown'}</h2>
          <Bar label={isAr ? 'التواصل' : 'Communication'} value={r2.communication} color="var(--accent)" />
          <Bar
            label={isAr ? 'تقدير الثقة في الإلقاء' : 'Delivery Confidence Estimate'}
            value={r2.confidence}
            color="#8b5cf6"
            tooltip={confidenceTooltip}
          />
          <Bar label={isAr ? 'جودة الإجابة' : 'Answer Quality'} value={r2.answer_quality} color="#10b981" />

          {/* Real speech metrics from recordings */}
          <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{isAr ? 'وتيرة الكلام' : 'Speaking Pace'}</span>
              {speechSummary && speechSummary.avgWpm > 0
                ? <span style={{ fontWeight: 700, fontSize: 18 }}>{speechSummary.avgWpm} <span style={{ fontSize: 12, color: 'var(--fg3)', fontWeight: 500 }}>WPM</span></span>
                : <span style={{ fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>{isAr ? 'غير متاح' : 'Not available'}</span>
              }
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{isAr ? 'توقفات طويلة (>٢ ث)' : 'Long Pauses (>2 s)'}</span>
              {speechSummary
                ? <span style={{ fontWeight: 700, fontSize: 18 }}>{speechSummary.pauseCount}</span>
                : <span style={{ fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>{isAr ? 'غير متاح' : 'Not available'}</span>
              }
            </div>
            {speechSummary && speechSummary.pauseCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--fg3)' }}>{isAr ? 'أطول توقف' : 'Longest pause'}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg2)' }}>{speechSummary.longestPauseDuration.toFixed(1)} s</span>
              </div>
            )}
          </div>
        </div>

        {/* Filler words — from real transcript analysis */}
        {speechSummary && speechSummary.fillerWords.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
            <h2 style={{ margin: '0 0 18px', fontSize: 17, fontWeight: 700 }}>{isAr ? 'كلمات الحشو' : 'Filler Words'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {speechSummary.fillerWords.map((f, i) => {
                const max = speechSummary.fillerWords[0].count || 1;
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, fontStyle: 'italic' }}>"{f.word}"</span>
                      <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{f.count}×</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ width: `${(f.count / max) * 100}%`, height: '100%', background: '#f59e0b', borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, marginBottom: 20 }}>
        {r2.strengths?.length > 0 && (() => {
          const noStrengths = r2.strengths.length === 1 && (
            r2.strengths[0].includes('No clear strengths') ||
            r2.strengths[0].includes('لم تتضح نقاط قوة')
          );
          return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>{isAr ? 'نقاط القوة' : 'Strengths'}</h2>
              {noStrengths ? (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>{r2.strengths[0]}</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {r2.strengths.map((s, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 15, color: '#10b981', flexShrink: 0 }}>✓</span>
                      <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })()}

        {r2.improvements?.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>{isAr ? 'مجالات التحسين' : 'Areas to Improve'}</h2>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {r2.improvements.map((s, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 15, color: '#f59e0b', flexShrink: 0 }}>→</span>
                  <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {r2.ai_feedback && (
        <div style={{ background: 'var(--accent-soft)', border: '1px solid rgba(2,132,199,.2)', borderRadius: 20, padding: 28, marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 19 }}>✦</div>
            <div>
              <h2 style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 700, color: 'var(--accent)' }}>{isAr ? 'تغذية راجعة من الذكاء الاصطناعي' : 'AI Feedback'}</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: 'var(--fg)' }}>{r2.ai_feedback}</p>
            </div>
          </div>
        </div>
      )}

      {r2.recommendations?.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 19, fontWeight: 700 }}>{isAr ? 'توصيات للتطوير' : 'Recommendations'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
            {r2.recommendations.map((rec, i) => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 22px', boxShadow: 'var(--shadow)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, marginBottom: 12 }}>{i + 1}</div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700 }}>{rec.title}</h3>
                <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 13.5, lineHeight: 1.55 }}>{rec.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {questions.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
                {isAr ? 'أسئلة المقابلة والإجابات المثالية' : 'Interview Questions & Ideal Answers'}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--fg3)' }}>
                {isAr
                  ? 'انقر على كل سؤال لمقارنة إجابتك بالإجابة المثالية'
                  : 'Click each question to compare your answer with the ideal response'}
              </p>
            </div>
            <div style={{ background: 'rgba(16,185,129,.12)', color: '#10b981', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, whiteSpace: 'nowrap' }}>
              {isAr ? 'بمنهج STAR' : 'STAR Method'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {questions.map((q, i) => (
              <AccordionCard
                key={i}
                index={i}
                question={q}
                userAnswer={answers[i] || ''}
                idealAnswer={r2.ideal_answers?.[i]?.ideal_answer ?? ''}
                lang={lang}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
