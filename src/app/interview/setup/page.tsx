'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { Mic, ArrowRight, Sparkles, EarOff, Eye } from 'lucide-react';
import { useApp, type InterviewExperienceMode } from '@/lib/context';
import { t, type Lang } from '@/lib/i18n';

function RadioOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'start',
      border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
      background: selected ? 'var(--accent-soft)' : 'var(--surface)',
      color: selected ? 'var(--accent)' : 'var(--fg)',
      fontFamily: 'inherit', fontWeight: selected ? 700 : 500, fontSize: 14.5,
      padding: '13px 15px', borderRadius: 12, cursor: 'pointer', transition: 'all .15s', width: '100%',
    }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, background: selected ? 'var(--accent)' : 'transparent', flexShrink: 0, boxShadow: 'inset 0 0 0 3px var(--surface)', display: 'inline-block' }} />
      {label}
    </button>
  );
}

function ModeCard({ id, selected, label, desc, badge, icon, onClick }: {
  id: InterviewExperienceMode; selected: boolean; label: string; desc: string;
  badge?: string; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, textAlign: 'start',
      border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
      background: selected ? 'var(--accent-soft)' : 'var(--surface)',
      fontFamily: 'inherit', padding: '16px 18px', borderRadius: 14, cursor: 'pointer',
      transition: 'all .15s', width: '100%', position: 'relative',
    }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: selected ? 'var(--accent)' : 'var(--surface2)', color: selected ? '#fff' : 'var(--fg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14.5, color: selected ? 'var(--accent)' : 'var(--fg)' }}>{label}</span>
          {badge && (
            <span style={{ fontSize: 11, fontWeight: 700, background: selected ? 'var(--accent)' : 'var(--surface2)', color: selected ? '#fff' : 'var(--fg3)', padding: '2px 8px', borderRadius: 20, letterSpacing: '.04em' }}>{badge}</span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: selected ? 'var(--accent)' : 'var(--fg2)', lineHeight: 1.5, fontWeight: 400 }}>{desc}</p>
      </div>
      <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, background: selected ? 'var(--accent)' : 'transparent', flexShrink: 0, boxShadow: 'inset 0 0 0 3px var(--surface)', display: 'inline-block', marginTop: 2 }} />
    </button>
  );
}

export default function InterviewSetupPage() {
  const { lang, role, education, experience, intLang, interviewMode, setRole, setEducation, setExperience, setIntLang, setInterviewMode } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <section style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(28px,5vw,52px) clamp(16px,4vw,40px)' }}>
      <button onClick={() => router.push('/modes')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', color: 'var(--fg2)', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, cursor: 'pointer', padding: '6px 0', marginBottom: 18 }}>
        <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'none' : 'scaleX(-1)' }}><ArrowRight size={16} /></span>
        {tr.setup.back}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Mic size={28} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px,3.4vw,32px)', fontWeight: 800, letterSpacing: '-.025em' }}>{tr.setup.title}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--fg2)', fontSize: 15 }}>{tr.setup.sub}</p>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 'clamp(20px,3vw,30px)', marginTop: 24, display: 'flex', flexDirection: 'column', gap: 26, boxShadow: 'var(--shadow)' }}>
        {/* Job Role */}
        <div>
          <label style={{ display: 'block', fontWeight: 700, fontSize: 14.5, marginBottom: 12 }}>{tr.setup.role}</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
            {tr.setup.roles.map(o => (
              <RadioOption key={o.id} label={o.l} selected={role === o.id} onClick={() => setRole(o.id)} />
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 26 }}>
          {/* Education */}
          <div>
            <label style={{ display: 'block', fontWeight: 700, fontSize: 14.5, marginBottom: 12 }}>{tr.setup.edu}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tr.setup.edus.map(o => (
                <RadioOption key={o.id} label={o.l} selected={education === o.id} onClick={() => setEducation(o.id)} />
              ))}
            </div>
          </div>
          {/* Experience */}
          <div>
            <label style={{ display: 'block', fontWeight: 700, fontSize: 14.5, marginBottom: 12 }}>{tr.setup.exp}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tr.setup.exps.map(o => (
                <RadioOption key={o.id} label={o.l} selected={experience === o.id} onClick={() => setExperience(o.id)} />
              ))}
            </div>
          </div>
        </div>

        {/* Interview Language */}
        <div>
          <label style={{ display: 'block', fontWeight: 700, fontSize: 14.5, marginBottom: 12 }}>{tr.setup.lang}</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {tr.setup.langs.map(o => (
              <button key={o.id} onClick={() => setIntLang(o.id as Lang)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                border: `1.5px solid ${intLang === o.id ? 'var(--accent)' : 'var(--border)'}`,
                background: intLang === o.id ? 'var(--accent-soft)' : 'var(--surface)',
                color: intLang === o.id ? 'var(--accent)' : 'var(--fg)',
                fontFamily: 'inherit', fontWeight: intLang === o.id ? 700 : 500, fontSize: 14.5,
                padding: '13px 22px', borderRadius: 12, cursor: 'pointer',
              }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${intLang === o.id ? 'var(--accent)' : 'var(--border)'}`, background: intLang === o.id ? 'var(--accent)' : 'transparent', flexShrink: 0, boxShadow: 'inset 0 0 0 3px var(--surface)', display: 'inline-block' }} />
                {o.l}
              </button>
            ))}
          </div>
        </div>

        {/* Interview Experience Mode */}
        <div>
          <label style={{ display: 'block', fontWeight: 700, fontSize: 14.5, marginBottom: 12 }}>{tr.setup.expMode}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ModeCard
              id="real"
              selected={interviewMode === 'real'}
              label={tr.setup.modeReal}
              desc={tr.setup.modeRealDesc}
              badge={tr.setup.modeRealBadge}
              icon={<EarOff size={18} />}
              onClick={() => setInterviewMode('real')}
            />
            <ModeCard
              id="assisted"
              selected={interviewMode === 'assisted'}
              label={tr.setup.modeAssisted}
              desc={tr.setup.modeAssistedDesc}
              icon={<Eye size={18} />}
              onClick={() => setInterviewMode('assisted')}
            />
          </div>
        </div>
      </div>

      <button onClick={() => router.push('/interview/loading')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 16.5, padding: 17, borderRadius: 14, cursor: 'pointer', marginTop: 24, boxShadow: '0 12px 26px rgba(2,132,199,.3)', transition: 'transform .15s' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = ''}>
        <Sparkles size={18} />{tr.setup.cta}
      </button>
    </section>
  );
}
