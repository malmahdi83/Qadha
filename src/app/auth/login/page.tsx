'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';

export default function LoginPage() {
  const { lang } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(lang === 'ar' ? 'بيانات اعتماد غير صالحة' : 'Invalid credentials');
    } else {
      router.push('/');
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 24, margin: '0 auto 16px' }}>Q</div>
          <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800 }}>
            {lang === 'ar' ? 'تسجيل الدخول' : 'Sign in'}
          </h1>
          <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 15 }}>
            {lang === 'ar' ? 'مرحبًا بعودتك إلى قضاء' : 'Welcome back to Qadha'}
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {error && (
            <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', color: '#ef4444', fontSize: 14 }}>
              {error}
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              {lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}
            </label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              placeholder={lang === 'ar' ? 'your@email.com' : 'your@email.com'}
              style={{ width: '100%', border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 15, padding: '12px 14px', borderRadius: 11, outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
              onBlur={e => (e.target as HTMLInputElement).style.borderColor = ''} />
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              {lang === 'ar' ? 'كلمة المرور' : 'Password'}
            </label>
            <div style={{ position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="••••••••"
                style={{ width: '100%', border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 15, padding: '12px 44px 12px 14px', borderRadius: 11, outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = ''} />
              <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', insetInlineEnd: 12, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4 }}>
                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <div style={{ marginTop: 8, textAlign: 'end' }}>
              <Link href="/auth/reset-password" style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                {lang === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
              </Link>
            </div>
          </div>

          <button type="submit" disabled={loading} style={{ border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 16, padding: '14px', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'opacity .15s' }}>
            {loading ? (lang === 'ar' ? 'جارٍ الدخول…' : 'Signing in…') : (lang === 'ar' ? 'تسجيل الدخول' : 'Sign in')}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--fg2)' }}>
          {lang === 'ar' ? 'ليس لديك حساب؟ ' : "Don't have an account? "}
          <Link href="/auth/register" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>
            {lang === 'ar' ? 'إنشاء حساب' : 'Sign up'}
          </Link>
        </p>
      </div>
    </div>
  );
}
