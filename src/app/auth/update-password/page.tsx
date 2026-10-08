'use client';
import { useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useApp } from '@/lib/context';

type ExchangeState = 'loading' | 'ready' | 'invalid' | 'done';

function UpdatePasswordContent() {
  const { lang } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  const exchangeAttempted = useRef(false);
  const [exchangeState, setExchangeState] = useState<ExchangeState>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // [TEMP DIAG] Auth event observer — logs event name only, never session data
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      console.log('[RECOVERY_DIAG_EVENT]', JSON.stringify({
        event,
        pathname: typeof window !== 'undefined' ? window.location.pathname : null,
      }));
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (exchangeAttempted.current) return;
    exchangeAttempted.current = true;

    const code = searchParams.get('code');
    const supabase = createClient();

    // [TEMP DIAG] Derive verifier key from env — check NAME presence only, never value
    const projectRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
      .replace('https://', '').split('.')[0];
    const verifierKeyName = `sb-${projectRef}-auth-token-code-verifier`;
    const hasPkceVerifier = typeof document !== 'undefined'
      ? document.cookie.split(';').some(c => c.trim().startsWith(verifierKeyName))
      : false;

    console.log('[RECOVERY_DIAG]', JSON.stringify({
      hasCode: !!code,
      hasPkceVerifier,
      exchangeAttempted: true,
      pathname: typeof window !== 'undefined' ? window.location.pathname : null,
    }));

    if (!code) {
      setExchangeState('invalid');
      return;
    }
    supabase.auth.exchangeCodeForSession(code).then(async ({ error: err }) => {
      if (err) {
        const { data: { session } } = await supabase.auth.getSession();
        console.log('[RECOVERY_DIAG]', JSON.stringify({
          exchangeSucceeded: false,
          exchangeErrorName: err.name ?? null,
          exchangeErrorCode: (err as { code?: string }).code ?? null,
          hasSessionAfterFailure: !!session,
        }));
        setExchangeState('invalid');
      } else {
        console.log('[RECOVERY_DIAG]', JSON.stringify({ exchangeSucceeded: true }));
        router.replace('/auth/update-password');
        setExchangeState('ready');
      }
    });
  }, [router, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 12) {
      setError(lang === 'ar' ? 'كلمة المرور يجب أن تكون 12 حرفاً على الأقل' : 'Password must be at least 12 characters');
      return;
    }
    if (password !== confirm) {
      setError(lang === 'ar' ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setError(lang === 'ar' ? 'تعذّر تحديث كلمة المرور. يرجى المحاولة مجدداً.' : 'Could not update password. Please try again.');
    } else {
      setExchangeState('done');
    }
    setLoading(false);
  };

  const outer: React.CSSProperties = { minHeight: 'calc(100vh - 65px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' };
  const wrap: React.CSSProperties = { width: '100%', maxWidth: 420 };

  if (exchangeState === 'loading') {
    return (
      <div style={outer}>
        <div style={{ ...wrap, textAlign: 'center', color: 'var(--fg2)', fontSize: 15 }}>
          {lang === 'ar' ? 'جارٍ التحقق من الرابط…' : 'Verifying link…'}
        </div>
      </div>
    );
  }

  if (exchangeState === 'invalid') {
    return (
      <div style={outer}>
        <div style={{ ...wrap, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ margin: '0 0 10px', fontSize: 24, fontWeight: 800 }}>
            {lang === 'ar' ? 'رابط غير صالح أو منتهي الصلاحية' : 'Invalid or expired link'}
          </h1>
          <p style={{ color: 'var(--fg2)', fontSize: 15, margin: '0 0 24px' }}>
            {lang === 'ar'
              ? 'رابط إعادة تعيين كلمة المرور غير صالح أو انتهت صلاحيته. يرجى طلب رابط جديد.'
              : 'The password reset link is invalid or has expired. Please request a new one.'}
          </p>
          <Link href="/auth/reset-password" style={{ display: 'inline-block', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 700, fontSize: 15, padding: '12px 24px', borderRadius: 12, textDecoration: 'none' }}>
            {lang === 'ar' ? 'طلب رابط جديد' : 'Request new link'}
          </Link>
        </div>
      </div>
    );
  }

  if (exchangeState === 'done') {
    return (
      <div style={outer}>
        <div style={{ ...wrap, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✓</div>
          <h1 style={{ margin: '0 0 10px', fontSize: 24, fontWeight: 800 }}>
            {lang === 'ar' ? 'تم تحديث كلمة المرور' : 'Password updated'}
          </h1>
          <p style={{ color: 'var(--fg2)', fontSize: 15, margin: '0 0 24px' }}>
            {lang === 'ar' ? 'يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.' : 'You can now sign in with your new password.'}
          </p>
          <Link href="/auth/login" style={{ display: 'inline-block', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 700, fontSize: 15, padding: '12px 24px', borderRadius: 12, textDecoration: 'none' }}>
            {lang === 'ar' ? 'تسجيل الدخول' : 'Sign in'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={outer}>
      <div style={wrap}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 800 }}>
            {lang === 'ar' ? 'تعيين كلمة مرور جديدة' : 'Set new password'}
          </h1>
          <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 15 }}>
            {lang === 'ar' ? 'اختر كلمة مرور قوية لحسابك' : 'Choose a strong password for your account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {error && (
            <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', color: '#ef4444', fontSize: 14 }}>{error}</div>
          )}

          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              {lang === 'ar' ? 'كلمة المرور الجديدة (12 حرفاً على الأقل)' : 'New password (min 12 characters)'}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={12}
                placeholder="••••••••"
                style={{ width: '100%', border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 15, padding: '12px 44px 12px 14px', borderRadius: 11, outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = ''}
              />
              <button type="button" onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', insetInlineEnd: 12, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4 }}>
                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              {lang === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password'}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                placeholder="••••••••"
                style={{ width: '100%', border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 15, padding: '12px 44px 12px 14px', borderRadius: 11, outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = ''}
              />
              <button type="button" onClick={() => setShowConfirm(v => !v)} style={{ position: 'absolute', insetInlineEnd: 12, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4 }}>
                {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} style={{ border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 16, padding: 14, borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? (lang === 'ar' ? 'جارٍ التحديث…' : 'Updating…') : (lang === 'ar' ? 'تحديث كلمة المرور' : 'Update password')}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--fg2)' }}>
          <Link href="/auth/reset-password" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>
            {lang === 'ar' ? '← طلب رابط جديد' : '← Request new link'}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function UpdatePasswordPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
        <div style={{ color: 'var(--fg2)', fontSize: 15 }}>Loading…</div>
      </div>
    }>
      <UpdatePasswordContent />
    </Suspense>
  );
}
