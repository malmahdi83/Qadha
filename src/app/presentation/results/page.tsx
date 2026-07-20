'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { useApp, PresentationResults } from '@/lib/context';
import type { QuestionMetrics } from '@/lib/context';
import { t } from '@/lib/i18n';
import { analyzePerformance, saveSession, getSession } from '@/lib/ai';

const VIOLET = '#8b5cf6';
const VIOLET_SOFT = 'rgba(139,92,246,.1)';

function ScoreGauge({ score }: { score: number }) {
  const r = 70, C = 2 * Math.PI * r;
  const offset = (C * (1 - score / 100)).toFixed(1);
  const col = score >= 80 ? '#10b981' : score >= 60 ? VIOLET : '#f59e0b';
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

function Bar({ label, value, color = VIOLET, tooltip, reason }: {
  label: string; value: number; color?: string; tooltip?: string; reason?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {label}
          {tooltip && (
            <span title={tooltip} style={{ marginLeft: 5, cursor: 'help', color: 'var(--fg3)', fontSize: 13 }}>ⓘ</span>
          )}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}<span style={{ fontSize: 12, color: 'var(--fg3)' }}>/100</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 1s ease' }} />
      </div>
      {reason && (
        <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--fg3)', lineHeight: 1.5 }}>{reason}</p>
      )}
    </div>
  );
}

export default function PresentationResultsPage() {
  const {
    lang, topic, intLang, presTranscript, setPresTranscript, presSpeechMetrics, setPresSpeechMetrics,
    presResults, setPresResults, presContentOnly,
  } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const calledRef = useRef(false);
  const savedRef = useRef(false);
  const [loading, setLoading] = useState(!presResults);
  const [error, setError] = useState('');

  const isAr = lang === 'ar';

  // Load from DB when coming from history (session ID in URL, no live context state)
  useEffect(() => {
    if (presResults || presTranscript) return; // already have live data
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');
    if (!sessionId) return;
    setLoading(true);
    getSession(sessionId).then(row => {
      if (!row) { setLoading(false); return; }
      if (row.transcript) setPresTranscript(row.transcript);
      if (row.answers && typeof row.answers === 'object') {
        try { setPresSpeechMetrics(row.answers as QuestionMetrics); } catch { /* ignore */ }
      }
      const reconstructed: PresentationResults = {
        overall_score: row.score_overall ?? 0,
        confidence: row.score_confidence ?? 0,
        structure: row.score_structure ?? 0,
        communication_effectiveness: row.score_comm_effectiveness ?? 0,
        ai_feedback: row.ai_feedback ?? '',
        recommendations: Array.isArray(row.recommendations) ? row.recommendations as { title: string; description: string }[] : [],
        strengths: Array.isArray(row.strengths) ? row.strengths as string[] : undefined,
        improvements: Array.isArray(row.improvements) ? row.improvements as string[] : undefined,
        structure_review: row.ideal_answers && typeof row.ideal_answers === 'object' && !Array.isArray(row.ideal_answers)
          ? row.ideal_answers as PresentationResults['structure_review']
          : undefined,
        score_reasons: row.questions && typeof row.questions === 'object' && !Array.isArray(row.questions)
          ? row.questions as PresentationResults['score_reasons']
          : undefined,
      };
      setPresResults(reconstructed);
      setLoading(false);
    }).catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (presResults || calledRef.current) { setLoading(false); return; }
    calledRef.current = true;

    analyzePerformance<PresentationResults>({
      mode: 'presentation',
      lang: intLang,
      topic: topic || 'General presentation',
      transcript: presTranscript || '',
      contentOnly: presContentOnly,
      speechMetrics: presSpeechMetrics
        ? {
            avgWpm: presSpeechMetrics.wpm,
            fillerWords: presSpeechMetrics.fillerWords,
            pauseCount: presSpeechMetrics.pauseCount,
            avgPauseDuration: presSpeechMetrics.avgPauseDuration,
            longestPauseDuration: presSpeechMetrics.longestPauseDuration,
            durationSeconds: presSpeechMetrics.durationSeconds,
          }
        : {
            avgWpm: 0,
            fillerWords: [],
            pauseCount: 0,
            avgPauseDuration: 0,
            longestPauseDuration: 0,
            durationSeconds: 0,
          },
    })
      .then(res => { setPresResults(res); setLoading(false); })
      .catch(err => {
        console.error('Analyze presentation error:', err);
        setError(lang === 'ar'
          ? 'تعذّر تحليل العرض. يُرجى المحاولة مجددًا.'
          : 'Could not analyze the presentation. Please try again.');
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!presResults || savedRef.current) return;
    savedRef.current = true;

    saveSession({
      mode: 'presentation',
      lang: intLang,
      topic: topic || 'General presentation',
      transcript: presTranscript || undefined,
      score_overall: presResults.overall_score,
      score_confidence: presResults.confidence,
      score_structure: presResults.structure,
      score_comm_effectiveness: presResults.communication_effectiveness,
      pace_wpm: presSpeechMetrics?.wpm ?? undefined,
      filler_words: presSpeechMetrics?.fillerWords ?? [],
      long_pauses: presSpeechMetrics?.pauseCount ?? undefined,
      ai_feedback: presResults.ai_feedback,
      strengths: presResults.strengths,
      improvements: presResults.improvements,
      recommendations: presResults.recommendations,
      ideal_answers: presResults.structure_review,
      questions: presResults.score_reasons,
      answers: presSpeechMetrics ?? undefined,
    }).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presResults]);

  if (loading) {
    return (
      <section style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: VIOLET_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={32} style={{ color: VIOLET, animation: 'qspin 1s linear infinite' }} />
        </div>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>
          {isAr ? 'جارٍ تحليل عرضك…' : 'Analyzing your presentation…'}
        </h2>
        <p style={{ margin: 0, color: 'var(--fg2)', textAlign: 'center', maxWidth: '28em' }}>
          {isAr ? 'يراجع الذكاء الاصطناعي عرضك ويحضّر تقريرًا مفصّلًا.' : 'AI is reviewing your presentation and preparing a detailed report.'}
        </p>
      </section>
    );
  }

  if (error || !presResults) {
    return (
      <section style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
        <AlertCircle size={48} style={{ color: '#f59e0b' }} />
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>{isAr ? 'خطأ في التحليل' : 'Analysis Error'}</h2>
        <p style={{ color: 'var(--fg2)', textAlign: 'center', maxWidth: '28em' }}>{error}</p>
        <button onClick={() => router.push('/presentation/recording')} style={{ border: 'none', background: VIOLET, color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '12px 24px', borderRadius: 12, cursor: 'pointer' }}>
          {isAr ? 'العودة للتسجيل' : 'Back to Recording'}
        </button>
      </section>
    );
  }

  const p = presResults;
  const sm = presSpeechMetrics;

  const confidenceTooltip = isAr
    ? 'تقدير مبني على: وتيرة الكلام، كثافة كلمات الحشو، تكرار التوقفات، وجودة بنية العرض. ليس قياسًا نفسيًا أو صوتيًا مباشرًا.'
    : 'Estimated from: speaking pace, filler word density, pause frequency, and presentation structure quality. Not a direct acoustic or psychological measurement.';

  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(20px,3.5vw,44px) clamp(16px,4vw,40px)' }}>
      {/* Hero */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 24, padding: 'clamp(24px,4vw,48px)', boxShadow: 'var(--shadow)', marginBottom: 24, display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap' }}>
        <ScoreGauge score={p.overall_score} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: VIOLET, textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isAr ? 'نتيجة العرض' : 'Presentation Score'}
            {presContentOnly && (
              <span
                title={isAr
                  ? 'تم تقييم محتوى هذا العرض فقط لأن لغة التقديم لم تتطابق مع اللغة المحددة.'
                  : 'This presentation was evaluated for content only because the spoken language did not match the selected language.'}
                style={{ fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,.15)', color: '#d97706', border: '1px solid rgba(245,158,11,.35)', padding: '2px 10px', borderRadius: 20, cursor: 'help', textTransform: 'none', letterSpacing: 'normal' }}>
                {isAr ? 'تقييم محتوى فقط ⓘ' : 'Content Only Evaluation ⓘ'}
              </span>
            )}
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, letterSpacing: '-.02em' }}>
            {isAr ? 'تقرير الأداء' : 'Performance Report'}
          </h1>
          {topic && (
            <div style={{ display: 'inline-block', background: VIOLET_SOFT, color: VIOLET, fontWeight: 600, fontSize: 13, padding: '4px 12px', borderRadius: 20, marginBottom: 10 }}>
              {topic}
            </div>
          )}
          <p style={{ margin: '0 0 20px', color: 'var(--fg2)', fontSize: 15 }}>
            {p.overall_score >= 80
              ? (isAr ? 'عرض رائع! أنت متحدث بارع.' : 'Outstanding! You\'re a skilled presenter.')
              : p.overall_score >= 60
              ? (isAr ? 'عرض جيد مع مجال للتحسين.' : 'Good presentation with room to grow.')
              : (isAr ? 'مزيد من التدريب سيحسّن مهاراتك.' : 'More practice will sharpen your skills.')}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => router.push('/presentation/setup')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 11, cursor: 'pointer' }}>
              <RotateCcw size={16} />{isAr ? 'عرض جديد' : 'New Presentation'}
            </button>
            <button onClick={() => router.push('/modes')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: VIOLET, color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 11, cursor: 'pointer' }}>
              {isAr ? 'اختر وضعًا آخر' : 'Try Another Mode'}<ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Sub-scores + real speech metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, marginBottom: 20 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{isAr ? 'تفاصيل الأداء' : 'Performance Breakdown'}</h2>
          <Bar
            label={isAr ? 'تقدير الثقة في الإلقاء' : 'Delivery Confidence Estimate'}
            value={p.confidence}
            color={VIOLET}
            tooltip={confidenceTooltip}
            reason={p.score_reasons?.confidence}
          />
          <Bar
            label={isAr ? 'البنية والتنظيم' : 'Structure & Organization'}
            value={p.structure}
            color="#10b981"
            reason={p.score_reasons?.structure}
          />
          <Bar
            label={isAr ? 'فاعلية التواصل' : 'Communication Effectiveness'}
            value={p.communication_effectiveness}
            color="var(--accent)"
            reason={p.score_reasons?.communication_effectiveness}
          />

          {/* Real speech metrics */}
          <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{isAr ? 'وتيرة الكلام' : 'Speaking Pace'}</span>
              {sm && sm.wpm > 0
                ? <span style={{ fontWeight: 700, fontSize: 18 }}>{sm.wpm} <span style={{ fontSize: 12, color: 'var(--fg3)', fontWeight: 500 }}>WPM</span></span>
                : <span style={{ fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>{isAr ? 'غير متاح' : 'Not available'}</span>
              }
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{isAr ? 'توقفات طويلة (>٢ ث)' : 'Long Pauses (>2 s)'}</span>
              {sm
                ? <span style={{ fontWeight: 700, fontSize: 18 }}>{sm.pauseCount}</span>
                : <span style={{ fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>{isAr ? 'غير متاح' : 'Not available'}</span>
              }
            </div>
            {sm && sm.pauseCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--fg3)' }}>{isAr ? 'أطول توقف' : 'Longest pause'}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg2)' }}>{sm.longestPauseDuration.toFixed(1)} s</span>
              </div>
            )}
          </div>
        </div>

        {/* Filler words */}
        {sm && sm.fillerWords.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
            <h2 style={{ margin: '0 0 18px', fontSize: 17, fontWeight: 700 }}>{isAr ? 'كلمات الحشو' : 'Filler Words'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sm.fillerWords.map((f, i) => {
                const max = sm.fillerWords[0].count || 1;
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

      {/* Strengths and Improvements */}
      {((p.strengths && p.strengths.length > 0) || (p.improvements && p.improvements.length > 0)) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, marginBottom: 20 }}>
          {p.strengths && p.strengths.length > 0 && (() => {
            const noStrengths = p.strengths!.length === 1 && (
              p.strengths![0].includes('No clear strengths') || p.strengths![0].includes('لم تتضح نقاط قوة')
            );
            return (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
                <h2 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>{isAr ? 'نقاط القوة' : 'Strengths'}</h2>
                {noStrengths ? (
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>{p.strengths![0]}</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {p.strengths!.map((s, i) => (
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
          {p.improvements && p.improvements.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>{isAr ? 'مجالات التحسين' : 'Areas to Improve'}</h2>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {p.improvements.map((s, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 15, color: '#f59e0b', flexShrink: 0 }}>→</span>
                    <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Presentation Structure Review */}
      {p.structure_review && (
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 19, fontWeight: 700 }}>
            {isAr ? 'مراجعة بنية العرض' : 'Presentation Structure Review'}
          </h2>
          <p style={{ margin: '-4px 0 16px', fontSize: 13.5, color: 'var(--fg3)' }}>
            {isAr
              ? 'تقييم مفصّل لكل جزء من أجزاء عرضك كما يقدّمه مدرب متخصص'
              : 'Detailed evaluation of each part of your presentation from a professional coaching perspective'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
            {([
              { key: 'opening' as const, label: isAr ? 'المقدمة' : 'Opening', icon: '🎯' },
              { key: 'body' as const, label: isAr ? 'الجسم الرئيسي' : 'Body', icon: '📋' },
              { key: 'transitions' as const, label: isAr ? 'الانتقالات' : 'Transitions', icon: '🔗' },
              { key: 'conclusion' as const, label: isAr ? 'الخاتمة' : 'Conclusion', icon: '🏁' },
            ] as const).map(({ key, label, icon }) => {
              const section = p.structure_review![key];
              if (!section) return null;
              const col = section.score >= 75 ? '#10b981' : section.score >= 55 ? VIOLET : '#f59e0b';
              return (
                <div key={key} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 22px', boxShadow: 'var(--shadow)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ fontSize: 20 }}>{icon}</span>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{label}</span>
                    </div>
                    <span style={{ fontWeight: 800, fontSize: 20, color: col }}>{section.score}<span style={{ fontSize: 12, color: 'var(--fg3)', fontWeight: 500 }}>/100</span></span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden', marginBottom: 12 }}>
                    <div style={{ width: `${section.score}%`, height: '100%', background: col, borderRadius: 3, transition: 'width 1s ease' }} />
                  </div>
                  <p style={{ margin: '0 0 10px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--fg)' }}>{section.feedback}</p>
                  {section.suggestions && (
                    <div style={{ background: 'var(--surface2)', borderRadius: 9, padding: '9px 12px', fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 700, color: VIOLET }}>{isAr ? '💡 اقتراح: ' : '💡 Tip: '}</span>
                      {section.suggestions}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Feedback */}
      {p.ai_feedback && (
        <div style={{ background: VIOLET_SOFT, border: `1px solid rgba(139,92,246,.2)`, borderRadius: 20, padding: 28, marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: VIOLET, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 19 }}>✦</div>
            <div>
              <h2 style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 700, color: VIOLET }}>{isAr ? 'تغذية راجعة من الذكاء الاصطناعي' : 'AI Feedback'}</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: 'var(--fg)' }}>{p.ai_feedback}</p>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {p.recommendations?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 19, fontWeight: 700 }}>{isAr ? 'توصيات للتطوير' : 'Recommendations'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
            {p.recommendations.map((rec, i) => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 22px', boxShadow: 'var(--shadow)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: VIOLET_SOFT, color: VIOLET, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, marginBottom: 12 }}>{i + 1}</div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700 }}>{rec.title}</h3>
                <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 13.5, lineHeight: 1.55 }}>{rec.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Original Transcript */}
      {presTranscript && (
        <div style={{ marginTop: 20 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 19, fontWeight: 700 }}>
            {isAr ? 'نص العرض الأصلي' : 'Presentation Transcript'}
          </h2>
          <p style={{ margin: '-4px 0 12px', fontSize: 13.5, color: 'var(--fg3)' }}>
            {isAr
              ? 'النص الأصلي كما نسخه Whisper من التسجيل — لم يُترجم ولم يُعدَّل'
              : 'Original transcript as captured by Whisper from your recording — not translated, not modified'}
          </p>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 24px', boxShadow: 'var(--shadow)' }}>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>{presTranscript}</p>
          </div>
        </div>
      )}
    </section>
  );
}
