'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mic, Presentation, Clock, ArrowRight, Loader2 } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';
import { getSessions, SessionRow } from '@/lib/ai';

export default function HistoryPage() {
  const { lang } = useApp();
  const tr = t(lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSessions()
      .then(data => setSessions(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function formatDate(iso?: string) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  return (
    <section style={{ maxWidth: 900, margin: '0 auto', padding: 'clamp(28px,5vw,52px) clamp(16px,4vw,40px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Clock size={28} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px,3vw,32px)', fontWeight: 800 }}>{tr.history.title}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--fg2)', fontSize: 15 }}>{tr.history.sub}</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40, color: 'var(--fg2)' }}>
            <Loader2 size={22} style={{ animation: 'qspin 1s linear infinite', color: 'var(--accent)' }} />
            {lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--fg3)', fontSize: 15 }}>
            {lang === 'ar' ? 'لا توجد جلسات سابقة بعد.' : 'No sessions yet. Complete an interview or presentation to see your history.'}
          </div>
        )}

        {!loading && sessions.map((session, i) => {
          const isInterview = session.mode === 'interview';
          const score = session.score_overall ?? 0;
          const scoreColor = score >= 80 ? '#10b981' : score >= 70 ? '#f59e0b' : '#ef4444';
          const label = isInterview
            ? (session.role ?? (lang === 'ar' ? 'مقابلة' : 'Interview'))
            : (session.topic ?? (lang === 'ar' ? 'عرض تقديمي' : 'Presentation'));

          return (
            <div key={session.id ?? i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: 'var(--shadow)', flexWrap: 'wrap' }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: isInterview ? 'var(--accent-soft)' : 'rgba(139,92,246,.12)', color: isInterview ? 'var(--accent)' : '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {isInterview ? <Mic size={22} /> : <Presentation size={22} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, color: 'var(--fg3)' }}>
                  {isInterview ? tr.history.interview : tr.history.presentation} · {formatDate(session.created_at)}
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor, flexShrink: 0 }}>{score}</div>
              <Link
                href={isInterview ? '/interview/results' : `/presentation/results?session=${session.id ?? ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontWeight: 600, fontSize: 13.5, padding: '9px 16px', borderRadius: 10, textDecoration: 'none', flexShrink: 0, transition: 'border-color .15s, color .15s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--accent)'; el.style.color = 'var(--accent)'; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = ''; el.style.color = ''; }}>
                {tr.history.view}
                <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'scaleX(-1)' : 'none' }}><ArrowRight size={14} /></span>
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
