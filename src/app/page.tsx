'use client';
import Link from 'next/link';
import { Mic, Presentation, Video, Sparkles, ArrowRight, BarChart2 } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';

const FEAT_ICONS = [Mic, Presentation, Video, Sparkles];

export default function LandingPage() {
  const { lang } = useApp();
  const tr = t(lang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <div style={{ background: 'var(--bg)', minHeight: 'calc(100vh - 65px)' }}>
      {/* Hero */}
      <section style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(40px,7vw,84px) clamp(16px,4vw,40px) 40px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 'clamp(32px,5vw,64px)', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 30, background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'qpulse 2s infinite', display: 'inline-block' }} />
            {tr.hero.badge}
          </div>
          <h1 style={{ margin: 0, fontSize: 'clamp(34px,5vw,56px)', lineHeight: 1.05, letterSpacing: '-.03em', fontWeight: 800 }}>
            {tr.hero.title}
          </h1>
          <p style={{ margin: 0, fontSize: 'clamp(16px,1.6vw,19px)', color: 'var(--fg2)', maxWidth: '30em' }}>
            {tr.hero.sub}
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
            <Link href="/modes" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 700, fontSize: 16, padding: '15px 26px', borderRadius: 13, cursor: 'pointer', boxShadow: '0 10px 24px rgba(2,132,199,.32)', textDecoration: 'none' }}>
              {tr.hero.cta}
              <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'scaleX(-1)' : 'none' }}><ArrowRight size={18} /></span>
            </Link>
            <Link href="/modes" style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontWeight: 600, fontSize: 16, padding: '15px 24px', borderRadius: 13, cursor: 'pointer', textDecoration: 'none' }}>
              {tr.hero.cta2}
            </Link>
          </div>
          <div style={{ display: 'flex', gap: 'clamp(20px,4vw,40px)', marginTop: 14, flexWrap: 'wrap' }}>
            {[
              { val: tr.hero.stat1, label: tr.hero.stat1l },
              { val: tr.hero.stat2, label: tr.hero.stat2l },
              { val: tr.hero.stat3, label: tr.hero.stat3l },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>{s.val}</div>
                <div style={{ fontSize: 13, color: 'var(--fg3)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Hero mock card */}
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', background: '#0a1726', boxShadow: '0 30px 60px -20px rgba(2,132,199,.45)', border: '1px solid var(--border)', aspectRatio: '4/3.2' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg,#0f2638 0 14px,rgba(15,34,51,.25) 14px 28px)' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 80% at 50% 0%, rgba(56,189,248,.25), transparent 60%)' }} />
            <div style={{ position: 'absolute', top: 14, left: 14, right: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(239,68,68,.92)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', animation: 'qpulse 1.2s infinite', display: 'inline-block' }} />
                {tr.hero.rec}
              </span>
              <span style={{ background: 'rgba(0,0,0,.4)', color: '#cfe7fb', fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 8, backdropFilter: 'blur(4px)' }}>02:14</span>
            </div>
            <div style={{ position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%,-50%)', width: 108, height: 108, borderRadius: '50%', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
              <div style={{ width: 74, height: 74, borderRadius: '50%', background: 'rgba(13,18,22,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cfe7fb', fontFamily: 'monospace', fontSize: 10, textAlign: 'center', lineHeight: 1.3 }}>
                camera<br />preview
              </div>
            </div>
            <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14, background: 'rgba(8,14,13,.72)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, padding: '13px 15px', backdropFilter: 'blur(8px)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#7cc4f7', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
                <BarChart2 size={15} />{tr.hero.live}
              </div>
              <div style={{ color: '#eaf2f0', fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{tr.hero.previewQ}</div>
            </div>
          </div>
          <div style={{ position: 'absolute', insetInlineEnd: -14, top: '30%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '11px 14px', boxShadow: '0 14px 30px -10px rgba(20,40,35,.3)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>A+</div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--fg3)' }}>{tr.results.confidence}</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>+18%</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(40px,6vw,72px) clamp(16px,4vw,40px)' }}>
        <div style={{ textAlign: 'center', maxWidth: '34em', margin: '0 auto 44px' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 'clamp(26px,3.4vw,38px)', fontWeight: 800, letterSpacing: '-.025em' }}>{tr.feat.title}</h2>
          <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 17 }}>{tr.feat.sub}</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
          {tr.feat.items.map((f, i) => {
            const Icon = FEAT_ICONS[i];
            return (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: 26, display: 'flex', flexDirection: 'column', gap: 13, boxShadow: 'var(--shadow)', transition: 'transform .2s,border-color .2s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.borderColor = ''; }}>
                <div style={{ width: 48, height: 48, borderRadius: 13, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={24} />
                </div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{f.t}</h3>
                <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 14.5, lineHeight: 1.55 }}>{f.d}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(40px,6vw,72px) clamp(16px,4vw,40px)' }}>
          <div style={{ textAlign: 'center', maxWidth: '34em', margin: '0 auto 48px' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 'clamp(26px,3.4vw,38px)', fontWeight: 800, letterSpacing: '-.025em' }}>{tr.how.title}</h2>
            <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 17 }}>{tr.how.sub}</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 26 }}>
            {tr.how.steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 19, flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1, height: 2, background: 'var(--border)' }} />
                </div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{s.t}</h3>
                <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 14.5, lineHeight: 1.55 }}>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(40px,6vw,72px) clamp(16px,4vw,40px)' }}>
        <h2 style={{ margin: '0 0 40px', textAlign: 'center', fontSize: 'clamp(26px,3.4vw,38px)', fontWeight: 800, letterSpacing: '-.025em' }}>{tr.test.title}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20 }}>
          {tr.test.items.map((tt, i) => (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: 26, display: 'flex', flexDirection: 'column', gap: 18, boxShadow: 'var(--shadow)' }}>
              <div style={{ color: '#f59e0b', fontSize: 15, letterSpacing: 2 }}>★★★★★</div>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, flex: 1 }}>{tt.q}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(135deg,#0284c7,#38bdf8)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                  {tt.n.charAt(0)}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{tt.n}</div>
                  <div style={{ fontSize: 13, color: 'var(--fg3)' }}>{tt.r}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section style={{ maxWidth: 1180, margin: '0 auto clamp(40px,6vw,72px)', padding: '0 clamp(16px,4vw,40px)' }}>
        <div style={{ background: 'linear-gradient(135deg,#0284c7,#075985)', borderRadius: 24, padding: 'clamp(36px,5vw,60px)', textAlign: 'center', color: '#fff', boxShadow: '0 24px 50px -18px rgba(2,132,199,.5)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 'clamp(26px,3.4vw,40px)', fontWeight: 800, letterSpacing: '-.025em' }}>{tr.hero.cta}</h2>
          <p style={{ margin: '0 auto 26px', maxWidth: '30em', color: '#d6ecfb', fontSize: 17 }}>{tr.feat.sub}</p>
          <Link href="/modes" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: 'none', background: '#fff', color: '#075985', fontWeight: 700, fontSize: 16, padding: '15px 30px', borderRadius: 13, cursor: 'pointer', textDecoration: 'none' }}>
            {tr.hero.cta}
            <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'scaleX(-1)' : 'none' }}><ArrowRight size={18} /></span>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: 'clamp(36px,5vw,56px) clamp(16px,4vw,40px)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-fg)', fontWeight: 800, fontSize: 18 }}>Q</div>
              <span style={{ fontWeight: 800, fontSize: 19 }}>Qadha</span>
            </div>
            <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 14 }}>{tr.footer.tagline}</p>
          </div>
          {tr.footer.cols.map(col => (
            <div key={col.h} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{col.h}</div>
              {col.links.map(lk => (
                <span key={lk} style={{ color: 'var(--fg2)', fontSize: 14, cursor: 'pointer' }}>{lk}</span>
              ))}
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', padding: '18px clamp(16px,4vw,40px)', textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>
          {tr.footer.made}
        </div>
      </footer>
    </div>
  );
}
