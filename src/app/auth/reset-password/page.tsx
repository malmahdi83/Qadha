'use client';
import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { useApp } from '@/lib/context';

export default function ResetPasswordPage() {
  const { lang } = useApp();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });
    if (err) setError(err.message);
    else setSent(true);
    setLoading(false);
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 800 }}>
            {lang === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset password'}
          </h1>
          <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 15 }}>
            {lang === 'ar' ? 'أدخل بريدك لاستلام رابط الإعادة' : "Enter your email to receive a reset link"}
          </p>
        </div>

        {sent ? (
          <div style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 14, padding: '18px 20px', textAlign: 'center', color: '#10b981' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {lang === 'ar' ? 'تم الإرسال! تحقق من بريدك.' : 'Sent! Check your inbox.'}
            </p>
          </div>
        ) : (
          <form onSubmit={handleReset} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {error && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '10px 14px', color: '#ef4444', fontSize: 14 }}>{error}</div>}
            <div>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="your@email.com"
                style={{ width: '100%', border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 15, padding: '12px 14px', borderRadius: 11, outline: 'none', boxSizing: 'border-box' }}
                onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
                onBlur={e => (e.target as HTMLInputElement).style.borderColor = ''} />
            </div>
            <button type="submit" disabled={loading} style={{ border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 16, padding: 14, borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? '…' : (lang === 'ar' ? 'إرسال رابط الإعادة' : 'Send reset link')}
            </button>
          </form>
        )}

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--fg2)' }}>
          <Link href="/auth/login" style={{ color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}>
            {lang === 'ar' ? '← العودة لتسجيل الدخول' : '← Back to sign in'}
          </Link>
        </p>
      </div>
    </div>
  );
}
