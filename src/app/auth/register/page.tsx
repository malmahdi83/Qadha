'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useApp } from '@/lib/context';

export default function RegisterPage() {
  const { lang } = useApp();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError(lang === 'ar' ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' : 'Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error: err } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } },
    });
    if (err) {
      setError(err.message);
    } else {
      setSuccess(true);
    }
    setLoading(false);
  };

  if (success) {
    return (
      <div style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
          <h1 style={{ margin: '0 0 10px', fontSize: 24, fontWeight: 800 }}>
            {lang === 'ar' ? 'تحقق من بريدك الإلكتروني' : 'Check your email'}
          </h1>
          <p style={{ color: 'var(--fg2)', fontSize: 15 }}>
            {lang === 'ar' ? `أرسلنا رابط تأكيد إلى ${email}` : `We sent a confirmation link to ${email}`}
          </p>
          <Link href="/auth/login" style={{ display: 'inline-block', marginTop: 20, color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>
            {lang === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to sign in'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 24, margin: '0 auto 16px' }}>Q</div>
          <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800 }}>
            {lang === 'ar' ? 'إنشاء حساب' : 'Create account'}
          </h1>
          <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 15 }}>
            {lang === 'ar' ? 'ابدأ رحلتك مع قضاء' : 'Start your Qadha journey'}
          </p>
        </div>

        <form onSubmit={handleRegister} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {error && (
            <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', color: '#ef4444', fontSize: 14 }}>{error}</div>
          )}

          {[
            { label: lang === 'ar' ? 'الاسم الكامل' : 'Full name', type: 'text', value: fullName, set: setFullName, ph: lang === 'ar' ? 'سارة الأحمد' : 'Sara Al-Ahmad' },
            { label: lang === 'ar' ? 'البريد الإلكتروني' : 'Email', type: 'email', value: email, set: setEmail, ph: 'your@email.com' },
          ].map(f => (
            <div key={f.label}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{f.label}</label>
              <input type={f.type} value={f.value} onChange={e => f.set(e.target.value)} required placeholder={f.ph}
                style={{ width: '100%', border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 15, padding: '12px 14px', borderRadius: 11, outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = ''} />
            </div>
          ))}

          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              {lang === 'ar' ? 'كلمة المرور (8 أحرف على الأقل)' : 'Password (min 8 characters)'}
            </label>
            <div style={{ position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="••••••••"
                style={{ width: '100%', border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 15, padding: '12px 44px 12px 14px', borderRadius: 11, outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = ''} />
              <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', insetInlineEnd: 12, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4 }}>
                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} style={{ border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 16, padding: 14, borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? (lang === 'ar' ? 'جارٍ الإنشاء…' : 'Creating account…') : (lang === 'ar' ? 'إنشاء حساب' : 'Create account')}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--fg2)' }}>
          {lang === 'ar' ? 'لديك حساب بالفعل؟ ' : 'Already have an account? '}
          <Link href="/auth/login" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>
            {lang === 'ar' ? 'تسجيل الدخول' : 'Sign in'}
          </Link>
        </p>
      </div>
    </div>
  );
}
