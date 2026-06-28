'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';
import { generateQuestions } from '@/lib/ai';

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

export default function LoadingPage() {
  const { lang, role, education, experience, intLang, setQuestions, setInterviewResults } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    // Reset any previous results
    setInterviewResults(null);

    // Animate progress while AI generates questions
    let prog = 0;
    const interval = setInterval(() => {
      prog = Math.min(90, prog + 8 + Math.random() * 8); // pause at 90 until AI responds
      setProgress(Math.round(prog));
    }, 350);

    generateQuestions({
      role: ROLE_LABELS[role] ?? role,
      education: EDU_LABELS[education] ?? education,
      experience: EXP_LABELS[experience] ?? experience,
      lang: intLang,
    })
      .then(questions => {
        clearInterval(interval);
        setQuestions(questions);
        setProgress(100);
        setTimeout(() => router.push('/interview/session'), 500);
      })
      .catch(err => {
        clearInterval(interval);
        console.error('Failed to generate questions:', err);
        setError(lang === 'ar'
          ? 'تعذّر إنشاء الأسئلة. جارٍ استخدام أسئلة افتراضية.'
          : 'Could not generate questions. Using default questions.');
        // Fallback questions
        const fallback = intLang === 'ar' ? [
          'حدّثنا عن نفسك ولماذا تهتم بهذه الوظيفة.',
          'صف مشروعًا صعبًا عملت عليه وكيف تعاملت معه.',
          'كيف ترتّب أولوياتك عند مواجهة عدة مواعيد نهائية؟',
          'حدّثنا عن موقف اختلفت فيه مع زميل، وكيف حللته؟',
          'أين ترى نفسك مهنيًا بعد خمس سنوات؟',
        ] : [
          'Tell me about yourself and why you\'re interested in this role.',
          'Describe a challenging project you worked on and how you handled it.',
          'How do you prioritize tasks when facing multiple deadlines?',
          'Tell me about a time you disagreed with a teammate. How did you resolve it?',
          'Where do you see yourself professionally in five years?',
        ];
        setQuestions(fallback);
        setProgress(100);
        setTimeout(() => router.push('/interview/session'), 1200);
      });

    // Hard fallback — should never be needed but prevents infinite hang
    const hardFallback = setTimeout(() => {
      clearInterval(interval);
      setProgress(100);
      router.push('/interview/session');
    }, 20000);

    return () => { clearInterval(interval); clearTimeout(hardFallback); };
  }, [role, education, experience, intLang, lang, setQuestions, setInterviewResults, router]);

  const r = 56;
  const C = 2 * Math.PI * r;
  const offset = (C * (1 - progress / 100)).toFixed(1);
  const step = tr.loading.steps[Math.min(3, Math.floor(progress / 26))];

  return (
    <section style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 130, height: 130, marginBottom: 34 }}>
        <svg width="130" height="130" viewBox="0 0 130 130" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="65" cy="65" r={r} fill="none" stroke="var(--surface2)" strokeWidth="10" />
          <circle cx="65" cy="65" r={r} fill="none" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round"
            strokeDasharray={C.toFixed(1)} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset .18s linear' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.02em' }}>{progress}%</div>
        </div>
        <div style={{ position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)', width: 34, height: 34, borderRadius: 11, background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 16px rgba(2,132,199,.4)', animation: 'qpulse 1.6s infinite' }}>
          <Sparkles size={16} />
        </div>
      </div>
      <h1 style={{ margin: '0 0 10px', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, letterSpacing: '-.02em' }}>{tr.loading.msg}</h1>
      <p style={{ margin: '0 0 26px', color: 'var(--fg2)', fontSize: 16, maxWidth: '26em' }}>{tr.loading.sub}</p>

      {error ? (
        <div style={{ background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 12, padding: '10px 18px', color: '#f59e0b', fontSize: 14, maxWidth: '26em' }}>
          {error}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 30, padding: '10px 18px', boxShadow: 'var(--shadow)' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)', animation: 'qpulse 1s infinite', display: 'inline-block' }} />
          <span style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--fg2)' }}>{step}</span>
        </div>
      )}
    </section>
  );
}
