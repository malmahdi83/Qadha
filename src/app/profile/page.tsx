'use client';
import { Mic, Check, Shield, Clock, Trophy } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';

const BADGE_ICONS: Record<string, React.ElementType> = { mic: Mic, check: Check, shield: Shield, wave: Clock, clock: Clock, trophy: Trophy };
const P_LABELS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const P_LABELS_AR = ['ينا', 'فبر', 'مار', 'أبر', 'مايو', 'يون'];
const P_VALS = [52, 61, 58, 70, 73, 82];

export default function ProfilePage() {
  const { lang } = useApp();
  const tr = t(lang);
  const pLabels = lang === 'ar' ? P_LABELS_AR : P_LABELS_EN;

  const stats = [
    { label: tr.profile.sessions, val: 14 },
    { label: tr.profile.avg, val: 76 },
    { label: tr.profile.best, val: 82 },
    { label: tr.profile.streak, val: 6 },
  ];

  return (
    <section style={{ maxWidth: 1000, margin: '0 auto', padding: 'clamp(28px,5vw,52px) clamp(16px,4vw,40px)' }}>
      {/* Profile header */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, padding: 28, display: 'flex', alignItems: 'center', gap: 22, marginBottom: 24, boxShadow: 'var(--shadow)', flexWrap: 'wrap' }}>
        <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),var(--accent-light))', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, flexShrink: 0 }}>
          {tr.userInitials}
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>{tr.userName}</h1>
          <p style={{ margin: '0 0 14px', color: 'var(--fg3)', fontSize: 14 }}>{tr.profile.memberSince}</p>
          <button style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, padding: '9px 18px', borderRadius: 10, cursor: 'pointer' }}>
            {tr.profile.edit}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16, marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '22px 20px', textAlign: 'center', boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-.02em', color: 'var(--accent)' }}>{s.val}</div>
            <div style={{ fontSize: 13.5, color: 'var(--fg2)', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
        {/* Progress chart */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, padding: 28, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{tr.profile.progressH}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
            {P_VALS.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: 'var(--accent)', height: `${v}%`, transition: 'height .5s ease', minHeight: 4 }} />
                <div style={{ fontSize: 11, color: 'var(--fg3)' }}>{pLabels[i]}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Achievements */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, padding: 28, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{tr.profile.badgesH}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {tr.profile.badges.map((b, i) => {
              const Icon = BADGE_ICONS[b.icon] || Mic;
              return (
                <div key={i} title={b.d} style={{
                  background: b.earned ? 'var(--accent-soft)' : 'var(--surface2)',
                  border: `1px solid ${b.earned ? 'rgba(2,132,199,.2)' : 'var(--border)'}`,
                  borderRadius: 14, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  opacity: b.earned ? 1 : 0.55, transition: 'opacity .2s',
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: b.earned ? 'var(--accent)' : 'var(--border)', color: b.earned ? '#fff' : 'var(--fg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={20} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>{b.t}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
