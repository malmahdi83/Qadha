'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Sun, Moon, LogIn, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

const NAV = [
  { key: 'home', href: '/' },
  { key: 'practice', href: '/modes' },
  { key: 'history', href: '/history' },
  { key: 'profile', href: '/profile' },
] as const;

const SCREEN_NAV: Record<string, string> = {
  '/': 'home', '/modes': 'practice',
  '/interview/setup': 'practice', '/interview/loading': 'practice',
  '/interview/session': 'practice', '/interview/results': 'practice',
  '/presentation/setup': 'practice', '/presentation/recording': 'practice',
  '/presentation/results': 'practice',
  '/history': 'history', '/profile': 'profile',
};

export default function Header() {
  const { lang, theme, setLang, toggleTheme } = useApp();
  const tr = t(lang);
  const pathname = usePathname();
  const router = useRouter();
  const active = SCREEN_NAV[pathname] ?? 'home';

  const [user, setUser] = useState<User | null>(null);
  const [initials, setInitials] = useState<string>(tr.userInitials);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      if (data.user?.user_metadata?.full_name) {
        const parts = (data.user.user_metadata.full_name as string).trim().split(' ');
        setInitials(parts.map((p: string) => p[0]).join('').toUpperCase().slice(0, 2));
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push('/');
  };

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', gap: 18,
      padding: '14px clamp(16px,4vw,40px)',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      backdropFilter: 'saturate(1.4) blur(8px)',
    }}>
      {/* Logo */}
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', userSelect: 'none' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, boxShadow: '0 4px 12px rgba(2,132,199,.35)' }}>Q</div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-.02em' }}>Qadha</span>
          <span style={{ fontSize: 10.5, color: 'var(--fg3)', fontWeight: 500, marginTop: 2 }}>{tr.tagline}</span>
        </div>
      </Link>

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: 4, marginInlineStart: 18, flexWrap: 'wrap' }}>
        {NAV.map(({ key, href }) => (
          <Link key={key} href={href} style={{
            border: 'none', textDecoration: 'none',
            background: active === key ? 'var(--accent-soft)' : 'transparent',
            color: active === key ? 'var(--accent)' : 'var(--fg2)',
            fontWeight: 600, fontSize: 14,
            padding: '8px 14px', borderRadius: 9,
            transition: 'background .15s, color .15s',
          }}>
            {tr.nav[key as keyof typeof tr.nav]}
          </Link>
        ))}
      </nav>

      {/* Right controls */}
      <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Language toggle */}
        <div style={{ display: 'flex', padding: 3, background: 'var(--surface2)', borderRadius: 10, border: '1px solid var(--border)' }}>
          {(['en', 'ar'] as const).map(l => (
            <button key={l} onClick={() => setLang(l)} style={{
              border: 'none', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
              background: lang === l ? 'var(--surface)' : 'transparent',
              color: lang === l ? 'var(--accent)' : 'var(--fg2)',
              boxShadow: lang === l ? '0 1px 3px rgba(20,40,35,.12)' : 'none',
              transition: 'all .15s',
            }}>
              {l === 'en' ? 'EN' : 'العربية'}
            </button>
          ))}
        </div>

        {/* Theme toggle */}
        <button onClick={toggleTheme} title="Toggle theme" style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg2)' }}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        {/* Auth / Avatar */}
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link href="/profile" style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 30, padding: 4, textDecoration: 'none' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#0284c7,#38bdf8)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                {initials}
              </div>
            </Link>
            <button onClick={signOut} title={lang === 'ar' ? 'تسجيل الخروج' : 'Sign out'} style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg2)' }}>
              <LogOut size={17} />
            </button>
          </div>
        ) : (
          <Link href="/auth/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontWeight: 600, fontSize: 13.5, padding: '8px 14px', borderRadius: 10, textDecoration: 'none' }}>
            <LogIn size={15} />
            {lang === 'ar' ? 'دخول' : 'Sign in'}
          </Link>
        )}
      </div>
    </header>
  );
}
