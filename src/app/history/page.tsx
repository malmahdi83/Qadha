'use client';
import Link from 'next/link';
import { Mic, Presentation, Clock, ArrowRight } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';

export default function HistoryPage() {
  const { lang } = useApp();
  const tr = t(lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

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
        {tr.history.items.map((item, i) => {
          const isInterview = item.mode === 'interview';
          const scoreColor = item.score >= 80 ? '#10b981' : item.score >= 70 ? '#f59e0b' : '#ef4444';
          return (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: 'var(--shadow)', flexWrap: 'wrap' }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: isInterview ? 'var(--accent-soft)' : 'rgba(139,92,246,.12)', color: isInterview ? 'var(--accent)' : '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {isInterview ? <Mic size={22} /> : <Presentation size={22} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{item.role}</div>
                <div style={{ fontSize: 13, color: 'var(--fg3)' }}>
                  {isInterview ? tr.history.interview : tr.history.presentation} · {item.date}
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor, flexShrink: 0 }}>{item.score}</div>
              <Link href={isInterview ? '/interview/results' : '/presentation/results'} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontWeight: 600, fontSize: 13.5, padding: '9px 16px', borderRadius: 10, textDecoration: 'none', flexShrink: 0, transition: 'border-color .15s, color .15s' }}
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
