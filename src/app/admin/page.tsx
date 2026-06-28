'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, type Profile } from '@/lib/supabase';
import { useApp } from '@/lib/context';

export default function AdminPage() {
  const { lang } = useApp();
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth/login'); return; }

      const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (!profile || profile.role !== 'admin') { setUnauthorized(true); setLoading(false); return; }

      const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
      setProfiles(data ?? []);
      setLoading(false);
    })();
  }, [router]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--fg2)' }}>Loading…</div>;

  if (unauthorized) return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🚫</div>
      <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>
        {lang === 'ar' ? 'غير مصرح' : 'Unauthorized'}
      </h1>
      <p style={{ color: 'var(--fg2)' }}>{lang === 'ar' ? 'هذه الصفحة للمسؤولين فقط.' : 'This page is for admins only.'}</p>
    </div>
  );

  return (
    <section style={{ maxWidth: 1000, margin: '0 auto', padding: 'clamp(28px,5vw,52px) clamp(16px,4vw,40px)' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800 }}>{lang === 'ar' ? 'لوحة الإدارة' : 'Admin Panel'}</h1>
      <p style={{ margin: '0 0 28px', color: 'var(--fg2)' }}>{profiles.length} {lang === 'ar' ? 'مستخدم' : 'users'}</p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
              {[lang === 'ar' ? 'الاسم' : 'Name', lang === 'ar' ? 'البريد' : 'Email', lang === 'ar' ? 'الدور' : 'Role', lang === 'ar' ? 'تاريخ الإنشاء' : 'Created'].map(h => (
                <th key={h} style={{ padding: '13px 18px', textAlign: 'start', fontWeight: 700, color: 'var(--fg2)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: i < profiles.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <td style={{ padding: '13px 18px', fontWeight: 600 }}>{p.full_name || '—'}</td>
                <td style={{ padding: '13px 18px', color: 'var(--fg2)' }}>{p.email}</td>
                <td style={{ padding: '13px 18px' }}>
                  <span style={{ background: p.role === 'admin' ? 'var(--accent-soft)' : 'var(--surface2)', color: p.role === 'admin' ? 'var(--accent)' : 'var(--fg2)', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>
                    {p.role}
                  </span>
                </td>
                <td style={{ padding: '13px 18px', color: 'var(--fg3)', fontSize: 13 }}>{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
