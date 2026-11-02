'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Sun, Moon, LogIn, LogOut, Menu, X } from 'lucide-react';
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
  { key: 'feedback', href: '/feedback' },
] as const;

const SCREEN_NAV: Record<string, string> = {
  '/': 'home', '/modes': 'practice',
  '/interview/setup': 'practice', '/interview/loading': 'practice',
  '/interview/session': 'practice', '/interview/results': 'practice',
  '/presentation/setup': 'practice', '/presentation/recording': 'practice',
  '/presentation/results': 'practice',
  '/history': 'history', '/profile': 'profile',
  '/feedback': 'feedback',
};

export default function Header() {
  const { lang, theme, setLang, toggleTheme } = useApp();
  const tr = t(lang);
  const pathname = usePathname();
  const router = useRouter();
  const active = SCREEN_NAV[pathname] ?? 'home';

  const [user, setUser] = useState<User | null>(null);
  const [initials, setInitials] = useState<string>(tr.userInitials);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [menuOpen]);

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

  const menuId = 'qhdr-mobile-menu';

  return (
    <>
      <style>{`
        .qhdr-tagline { display: flex; }
        .qhdr-wordmark { display: block; }
        .qhdr-nav { display: flex; align-items: center; gap: 4px; margin-inline-start: 18px; flex-wrap: wrap; }
        .qhdr-lang-full { display: flex; }
        .qhdr-lang-compact { display: none; }
        .qhdr-hamburger { display: none; }
        .qhdr-dropdown { display: none; }
        .qhdr-signin-label { display: inline; }
        .qhdr-signout { display: flex; }
        @media (max-width: 599px) {
          .qhdr-tagline { display: none; }
          .qhdr-nav { display: none; }
          .qhdr-lang-full { display: none; }
          .qhdr-lang-compact { display: flex; }
          .qhdr-hamburger { display: flex; }
          .qhdr-dropdown { display: flex; }
          .qhdr-signin-label { display: none; }
          .qhdr-signout { display: none !important; }
          .qhdr-right { gap: 6px !important; }
          .qhdr-signin { width: 36px; height: 36px; padding: 0 !important; justify-content: center; }
        }
        @media (max-width: 359px) {
          .qhdr-wordmark { display: none; }
          .qhdr-logo-gap { gap: 0 !important; }
          .qhdr-header { gap: 8px !important; }
        }
      `}</style>

      <header className="qhdr-header" style={{
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 18,
        padding: '14px clamp(12px,3vw,40px)',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'saturate(1.4) blur(8px)',
        minHeight: 65,
        overflowX: 'clip',
      }}>
        {/* Logo */}
        <Link href="/" className="qhdr-logo-gap" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', userSelect: 'none', flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, boxShadow: '0 4px 12px rgba(2,132,199,.35)', flexShrink: 0 }}>Q</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span className="qhdr-wordmark" style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-.02em' }}>Qadha</span>
            <span className="qhdr-tagline" style={{ fontSize: 10.5, color: 'var(--fg3)', fontWeight: 500, marginTop: 2 }}>{tr.tagline}</span>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="qhdr-nav" aria-label={lang === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}>
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
        <div className="qhdr-right" style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>

          {/* Desktop language toggle — EN / العربية */}
          <div className="qhdr-lang-full" style={{ padding: 3, background: 'var(--surface2)', borderRadius: 10, border: '1px solid var(--border)' }}>
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

          {/* Mobile compact language toggle — EN | ع */}
          <div className="qhdr-lang-compact" style={{ padding: 2, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)', gap: 0 }}>
            {(['en', 'ar'] as const).map(l => (
              <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} style={{
                border: 'none', fontFamily: 'inherit', fontWeight: 700, fontSize: 12,
                padding: '5px 9px', borderRadius: 6, cursor: 'pointer', minWidth: 32, height: 30,
                background: lang === l ? 'var(--surface)' : 'transparent',
                color: lang === l ? 'var(--accent)' : 'var(--fg2)',
                boxShadow: lang === l ? '0 1px 3px rgba(20,40,35,.12)' : 'none',
                transition: 'all .15s',
              }}>
                {l === 'en' ? 'EN' : 'ع'}
              </button>
            ))}
          </div>

          {/* Theme toggle */}
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg2)', flexShrink: 0 }}>
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          {/* Auth / Avatar */}
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Link href="/profile" style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 30, padding: 4, textDecoration: 'none' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#0284c7,#38bdf8)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                  {initials}
                </div>
              </Link>
              <button onClick={signOut} title={lang === 'ar' ? 'تسجيل الخروج' : 'Sign out'} aria-label={lang === 'ar' ? 'تسجيل الخروج' : 'Sign out'} className="qhdr-signout" style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', alignItems: 'center', justifyContent: 'center', color: 'var(--fg2)', flexShrink: 0 }}>
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <Link href="/auth/login" className="qhdr-signin" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontWeight: 600, fontSize: 13.5, padding: '8px 14px', borderRadius: 10, textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap' }}>
              <LogIn size={15} />
              <span className="qhdr-signin-label">{lang === 'ar' ? 'دخول' : 'Sign in'}</span>
            </Link>
          )}

          {/* Hamburger — mobile only */}
          <button
            className="qhdr-hamburger"
            onClick={() => setMenuOpen(v => !v)}
            aria-label={menuOpen ? (lang === 'ar' ? 'إغلاق القائمة' : 'Close menu') : (lang === 'ar' ? 'فتح القائمة' : 'Open menu')}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', cursor: 'pointer', alignItems: 'center', justifyContent: 'center', color: 'var(--fg2)', flexShrink: 0 }}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {/* Mobile dropdown — rendered outside the sticky header so it overlays page content */}
      {menuOpen && (
        <>
          {/* Backdrop for click-outside close */}
          <div
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.25)' }}
          />
          <nav
            id={menuId}
            role="navigation"
            aria-label={lang === 'ar' ? 'قائمة التنقل' : 'Navigation menu'}
            className="qhdr-dropdown"
            style={{
              position: 'fixed', top: 65, insetInlineStart: 0, insetInlineEnd: 0, zIndex: 49,
              flexDirection: 'column',
              background: 'var(--surface)',
              borderBottom: '1px solid var(--border)',
              boxShadow: '0 8px 24px rgba(0,0,0,.15)',
              padding: '8px 0',
            }}
          >
            {NAV.map(({ key, href }) => (
              <Link
                key={key}
                href={href}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center',
                  padding: '14px clamp(12px,3vw,40px)',
                  textDecoration: 'none',
                  fontWeight: 600, fontSize: 15,
                  color: active === key ? 'var(--accent)' : 'var(--fg)',
                  background: active === key ? 'var(--accent-soft)' : 'transparent',
                  borderInlineStart: active === key ? '3px solid var(--accent)' : '3px solid transparent',
                  transition: 'background .12s, color .12s',
                }}
              >
                {tr.nav[key as keyof typeof tr.nav]}
              </Link>
            ))}
            {user && (
              <button
                onClick={() => { setMenuOpen(false); signOut(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '14px clamp(12px,3vw,40px)',
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 600, fontSize: 15,
                  color: 'var(--fg2)',
                  borderInlineStart: '3px solid transparent',
                  borderTop: '1px solid var(--border)',
                  width: '100%', textAlign: 'start',
                }}
              >
                <LogOut size={16} />
                {lang === 'ar' ? 'تسجيل الخروج' : 'Sign out'}
              </button>
            )}
          </nav>
        </>
      )}
    </>
  );
}
