'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { useApp, PresentationResults } from '@/lib/context';
import { t } from '@/lib/i18n';
import { analyzePerformance } from '@/lib/ai';

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

function Bar({ label, value, color = VIOLET }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}<span style={{ fontSize: 12, color: 'var(--fg3)' }}>/100</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 1s ease' }} />
      </div>
    </div>
  );
}

export default function PresentationResultsPage() {
  const { lang, topic, intLang, presTranscript, presResults, setPresResults } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const calledRef = useRef(false);
  const [loading, setLoading] = useState(!presResults);
  const [error, setError] = useState('');

  useEffect(() => {
    if (presResults || calledRef.current) { setLoading(false); return; }
    calledRef.current = true;

    analyzePerformance<PresentationResults>({
      mode: 'presentation',
      lang: intLang,
      topic: topic || 'General presentation',
      transcript: presTranscript || '',
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

  if (loading) {
    return (
      <section style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: VIOLET_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={32} style={{ color: VIOLET, animation: 'qspin 1s linear infinite' }} />
        </div>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>
          {lang === 'ar' ? 'جارٍ تحليل عرضك…' : 'Analyzing your presentation…'}
        </h2>
        <p style={{ margin: 0, color: 'var(--fg2)', textAlign: 'center', maxWidth: '28em' }}>
          {lang === 'ar' ? 'يراجع الذكاء الاصطناعي عرضك ويحضّر تقريرًا مفصّلًا.' : 'AI is reviewing your presentation and preparing a detailed report.'}
        </p>
      </section>
    );
  }

  if (error || !presResults) {
    return (
      <section style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
        <AlertCircle size={48} style={{ color: '#f59e0b' }} />
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>{lang === 'ar' ? 'خطأ في التحليل' : 'Analysis Error'}</h2>
        <p style={{ color: 'var(--fg2)', textAlign: 'center', maxWidth: '28em' }}>{error}</p>
        <button onClick={() => router.push('/presentation/recording')} style={{ border: 'none', background: VIOLET, color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '12px 24px', borderRadius: 12, cursor: 'pointer' }}>
          {lang === 'ar' ? 'العودة للتسجيل' : 'Back to Recording'}
        </button>
      </section>
    );
  }

  const p = presResults;

  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(20px,3.5vw,44px) clamp(16px,4vw,40px)' }}>
      {/* Hero */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 24, padding: 'clamp(24px,4vw,48px)', boxShadow: 'var(--shadow)', marginBottom: 24, display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap' }}>
        <ScoreGauge score={p.overall_score} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: VIOLET, textTransform: 'uppercase', marginBottom: 10 }}>
            {lang === 'ar' ? 'نتيجة العرض' : 'Presentation Score'}
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, letterSpacing: '-.02em' }}>
            {lang === 'ar' ? 'تقرير الأداء' : 'Performance Report'}
          </h1>
          {topic && (
            <div style={{ display: 'inline-block', background: VIOLET_SOFT, color: VIOLET, fontWeight: 600, fontSize: 13, padding: '4px 12px', borderRadius: 20, marginBottom: 10 }}>
              {topic}
            </div>
          )}
          <p style={{ margin: '0 0 20px', color: 'var(--fg2)', fontSize: 15 }}>
            {p.overall_score >= 80
              ? (lang === 'ar' ? 'عرض رائع! أنت متحدث بارع.' : 'Outstanding! You\'re a skilled presenter.')
              : p.overall_score >= 60
              ? (lang === 'ar' ? 'عرض جيد مع مجال للتحسين.' : 'Good presentation with room to grow.')
              : (lang === 'ar' ? 'مزيد من التدريب سيحسّن مهاراتك.' : 'More practice will sharpen your skills.')}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => router.push('/presentation/setup')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 11, cursor: 'pointer' }}>
              <RotateCcw size={16} />{lang === 'ar' ? 'عرض جديد' : 'New Presentation'}
            </button>
            <button onClick={() => router.push('/modes')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: VIOLET, color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 11, cursor: 'pointer' }}>
              {lang === 'ar' ? 'اختر وضعًا آخر' : 'Try Another Mode'}<ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Sub-scores */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{lang === 'ar' ? 'تفاصيل الأداء' : 'Performance Breakdown'}</h2>
        <Bar label={lang === 'ar' ? 'الثقة' : 'Confidence'} value={p.confidence} color={VIOLET} />
        <Bar label={lang === 'ar' ? 'البنية والتنظيم' : 'Structure & Organization'} value={p.structure} color="#10b981" />
        <Bar label={lang === 'ar' ? 'فاعلية التواصل' : 'Communication Effectiveness'} value={p.communication_effectiveness} color="var(--accent)" />
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{lang === 'ar' ? 'وتيرة الكلام' : 'Speaking Pace'}</span>
          <span style={{ fontWeight: 700, fontSize: 18 }}>{p.pace_wpm} <span style={{ fontSize: 12, color: 'var(--fg3)', fontWeight: 500 }}>WPM</span></span>
        </div>
      </div>

      {/* AI Feedback */}
      {p.ai_feedback && (
        <div style={{ background: VIOLET_SOFT, border: `1px solid rgba(139,92,246,.2)`, borderRadius: 20, padding: 28, marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: VIOLET, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 19 }}>✦</div>
            <div>
              <h2 style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 700, color: VIOLET }}>{lang === 'ar' ? 'تغذية راجعة من الذكاء الاصطناعي' : 'AI Feedback'}</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: 'var(--fg)' }}>{p.ai_feedback}</p>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {p.recommendations?.length > 0 && (
        <div>
          <h2 style={{ margin: '0 0 16px', fontSize: 19, fontWeight: 700 }}>{lang === 'ar' ? 'توصيات للتطوير' : 'Recommendations'}</h2>
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
    </section>
  );
}
