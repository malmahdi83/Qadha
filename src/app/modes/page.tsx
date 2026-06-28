'use client';
import Link from 'next/link';
import { Mic, Presentation, ArrowRight, Sparkles } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';

export default function ModesPage() {
  const { lang } = useApp();
  const tr = t(lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <section style={{ maxWidth: 1000, margin: '0 auto', padding: 'clamp(48px,7vw,90px) clamp(16px,4vw,40px)' }}>
      <div style={{ textAlign: 'center', maxWidth: '32em', margin: '0 auto 48px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 30, background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600, fontSize: 13, marginBottom: 18 }}>
          <Sparkles size={15} />{tr.hero.badge}
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: 'clamp(28px,4vw,42px)', fontWeight: 800, letterSpacing: '-.025em' }}>{tr.modes.title}</h1>
        <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 17 }}>{tr.modes.sub}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 24 }}>
        {/* Interview card */}
        <Link href="/interview/setup" style={{ cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, padding: 32, display: 'flex', flexDirection: 'column', gap: 18, boxShadow: 'var(--shadow)', transition: 'transform .2s,border-color .2s,box-shadow .2s', textDecoration: 'none', color: 'inherit' }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-5px)'; el.style.borderColor = 'var(--accent)'; el.style.boxShadow = '0 20px 40px -16px rgba(2,132,199,.35)'; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = ''; el.style.borderColor = ''; el.style.boxShadow = ''; }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Mic size={30} />
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg3)', background: 'var(--surface2)', padding: '6px 12px', borderRadius: 20 }}>{tr.modes.c1tag}</span>
          </div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>{tr.modes.c1t}</h2>
          <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 15.5, lineHeight: 1.6, flex: 1 }}>{tr.modes.c1d}</p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, alignSelf: 'flex-start', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 700, fontSize: 15, padding: '13px 22px', borderRadius: 12 }}>
            {tr.modes.c1b}
            <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'scaleX(-1)' : 'none' }}><ArrowRight size={18} /></span>
          </div>
        </Link>

        {/* Presentation card */}
        <Link href="/presentation/setup" style={{ cursor: 'pointer', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, padding: 32, display: 'flex', flexDirection: 'column', gap: 18, boxShadow: 'var(--shadow)', transition: 'transform .2s,border-color .2s,box-shadow .2s', textDecoration: 'none', color: 'inherit' }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-5px)'; el.style.borderColor = '#8b5cf6'; el.style.boxShadow = '0 20px 40px -16px rgba(139,92,246,.32)'; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = ''; el.style.borderColor = ''; el.style.boxShadow = ''; }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, background: '#8b5cf6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Presentation size={30} />
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg3)', background: 'var(--surface2)', padding: '6px 12px', borderRadius: 20 }}>{tr.modes.c2tag}</span>
          </div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-.02em' }}>{tr.modes.c2t}</h2>
          <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 15.5, lineHeight: 1.6, flex: 1 }}>{tr.modes.c2d}</p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, alignSelf: 'flex-start', background: '#8b5cf6', color: '#fff', fontWeight: 700, fontSize: 15, padding: '13px 22px', borderRadius: 12 }}>
            {tr.modes.c2b}
            <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'scaleX(-1)' : 'none' }}><ArrowRight size={18} /></span>
          </div>
        </Link>
      </div>
    </section>
  );
}
