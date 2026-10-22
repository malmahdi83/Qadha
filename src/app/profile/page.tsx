'use client';
import { useEffect, useState } from 'react';
import { Mic, Check, Shield, Clock, Trophy } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase';
import type { Lang } from '@/lib/i18n';

const BADGE_ICONS: Record<string, React.ElementType> = { mic: Mic, check: Check, shield: Shield, wave: Clock, clock: Clock, trophy: Trophy };

interface IdentityData {
  displayName: string;
  rawName: string | null;
  email: string;
  initials: string;
  createdAt: string;
}

function deriveInitials(name: string): string {
  return name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function formatMemberSince(isoDate: string, lang: Lang): string {
  const d = new Date(isoDate);
  // Use 'nu-latn' extension to force Latin numerals in Arabic locale
  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US';
  const monthName = d.toLocaleDateString(locale, { month: 'long' });
  const year = d.getFullYear();
  return lang === 'ar' ? `عضو منذ ${monthName} ${year}` : `Member since ${monthName} ${year}`;
}

interface ChartBar {
  monthKey: string;     // 'YYYY-MM' — language-agnostic key
  avgScore: number | null;  // null = no valid sessions that month
}

interface AchievementState {
  firstInterview: boolean;   // ≥1 session with mode === 'interview'
  fiveSessions: boolean;     // total ≥ 5
  confidenceMaster: boolean; // ≥1 session with score_confidence ≥ 80
  tenSessions: boolean;      // total ≥ 10
}

interface StatsData {
  total: number;
  avg: number | null;
  best: number | null;
  streak: number;
  chartBars: ChartBar[];  // 6 entries, oldest → newest
  achievements: AchievementState;
}

// Returns YYYY-MM-DD in the browser's local timezone, without relying on locale-specific formatting.
function localDateKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Returns YYYY-MM in the browser's local timezone.
function localMonthKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Short localized month label from a YYYY-MM key; called at render time so lang changes apply without re-fetching.
function shortMonthLabel(monthKey: string, lang: Lang): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const locale = lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US';
  return d.toLocaleDateString(locale, { month: 'short' });
}

// Subtracts one local calendar day from a YYYY-MM-DD key.
function prevDayKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function computeStreak(days: Set<string>): number {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const yestStr = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
  let cursor: string | null = days.has(todayStr) ? todayStr : days.has(yestStr) ? yestStr : null;
  if (!cursor) return 0;
  let count = 0;
  while (days.has(cursor)) {
    count++;
    cursor = prevDayKey(cursor);
  }
  return count;
}

export default function ProfilePage() {
  const { lang } = useApp();
  const tr = t(lang);

  const [identity, setIdentity] = useState<IdentityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [statsRetry, setStatsRetry] = useState(0);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [metaSyncFailed, setMetaSyncFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr || !user) {
          if (!cancelled) { setError(true); setLoading(false); }
          return;
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();

        if (cancelled) return;

        // Name: profiles.full_name → user_metadata.full_name → email prefix
        const rawName: string | null =
          (profile?.full_name as string | null) ||
          (user.user_metadata?.full_name as string | undefined | null) ||
          null;

        const displayName = rawName?.trim() || user.email || '';
        const initials = rawName?.trim()
          ? deriveInitials(rawName.trim())
          : (user.email?.[0]?.toUpperCase() ?? '?');

        setIdentity({
          displayName,
          rawName: rawName?.trim() ?? null,
          email: user.email ?? '',
          initials,
          createdAt: user.created_at,
        });
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr || !user) {
          if (!cancelled) { setStatsError(true); setStatsLoading(false); }
          return;
        }

        // Paginated fetch — PostgREST defaults to 1000 rows max per request.
        // Secondary sort on id ensures stable page boundaries for rows with identical created_at.
        const PAGE_SIZE = 1000;
        const allRows: Array<{
          score_overall: number | null;
          created_at: string;
          id: string;
          mode: string | null;
          score_confidence: number | null;
        }> = [];
        let from = 0;
        while (true) {
          const { data, error: qErr } = await supabase
            .from('sessions')
            .select('score_overall, created_at, id, mode, score_confidence')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + PAGE_SIZE - 1);
          if (qErr) throw qErr;
          if (cancelled) return;
          if (data && data.length > 0) allRows.push(...data);
          if (!data || data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }

        if (cancelled) return;

        const total = allRows.length;
        const validScores = allRows
          .map(r => r.score_overall)
          .filter((s): s is number => s !== null && Number.isFinite(s));
        const avg = validScores.length > 0
          ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
          : null;
        const best = validScores.length > 0
          ? validScores.reduce((max, s) => (s > max ? s : max), validScores[0])
          : null;

        const daySet = new Set<string>();
        for (const row of allRows) {
          if (row.created_at) daySet.add(localDateKey(row.created_at));
        }
        const streak = computeStreak(daySet);

        // Build 6-month window: current month and the 5 preceding, oldest first.
        const now = new Date();
        const monthKeys: string[] = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }

        // Group valid scores by month key.
        const monthScores = new Map<string, number[]>();
        for (const row of allRows) {
          if (!row.created_at) continue;
          const mk = localMonthKey(row.created_at);
          if (!monthKeys.includes(mk)) continue;
          if (row.score_overall === null || !Number.isFinite(row.score_overall)) continue;
          const bucket = monthScores.get(mk) ?? [];
          bucket.push(row.score_overall);
          monthScores.set(mk, bucket);
        }

        const chartBars: ChartBar[] = monthKeys.map(mk => {
          const scores = monthScores.get(mk);
          if (!scores || scores.length === 0) return { monthKey: mk, avgScore: null };
          return { monthKey: mk, avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) };
        });

        const achievements: AchievementState = {
          firstInterview: allRows.some(r => r.mode === 'interview'),
          fiveSessions: total >= 5,
          tenSessions: total >= 10,
          confidenceMaster: allRows.some(
            r => r.score_confidence !== null && Number.isFinite(r.score_confidence) && r.score_confidence >= 80
          ),
        };

        setStatsData({ total, avg, best, streak, chartBars, achievements });
      } catch {
        if (!cancelled) setStatsError(true);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [statsRetry]);

  const handleEditOpen = () => {
    setEditName(identity?.rawName ?? '');
    setSaveError('');
    setMetaSyncFailed(false);
    setEditing(true);
  };

  const handleEditCancel = () => {
    setEditing(false);
    setSaveError('');
    setMetaSyncFailed(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = editName.trim();

    if (!trimmed) {
      setSaveError(lang === 'ar' ? 'الاسم مطلوب' : 'Name is required');
      return;
    }
    if (trimmed.length > 100) {
      setSaveError(lang === 'ar' ? 'يجب ألا يتجاوز الاسم 100 حرف' : 'Name must be 100 characters or fewer');
      return;
    }
    if (trimmed === (identity?.rawName ?? '')) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setSaveError('');
    setMetaSyncFailed(false);

    try {
      const supabase = createClient();

      // Step A — verify authenticated user
      const { data: { user: verifiedUser }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !verifiedUser) {
        setSaveError(lang === 'ar' ? 'تعذّر التحقق من هويتك. يرجى تحديث الصفحة.' : 'Could not verify your identity. Please refresh the page.');
        setSaving(false);
        return;
      }

      // Step B — update profiles table first
      const { data: updatedRow, error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: trimmed })
        .eq('id', verifiedUser.id)
        .select('id, full_name')
        .single();

      if (profileError || !updatedRow || updatedRow.id !== verifiedUser.id) {
        setSaveError(lang === 'ar' ? 'تعذّر حفظ الملف الشخصي. يرجى المحاولة مرة أخرى.' : 'Could not save profile. Please try again.');
        setSaving(false);
        return;
      }

      // Step C — update local identity state immediately
      const newInitials = deriveInitials(trimmed);
      setIdentity(prev => prev ? {
        ...prev,
        rawName: trimmed,
        displayName: trimmed,
        initials: newInitials,
      } : prev);

      // Step D — sync auth metadata (soft failure)
      const { error: metadataError } = await supabase.auth.updateUser({
        data: { full_name: trimmed },
      });

      setSaving(false);
      if (metadataError) {
        setMetaSyncFailed(true);
        setEditing(false);
      } else {
        setEditing(false);
      }
    } catch {
      setSaveError(lang === 'ar' ? 'تعذّر حفظ الملف الشخصي. يرجى المحاولة مرة أخرى.' : 'Could not save profile. Please try again.');
      setSaving(false);
    }
  };

  const memberSince = identity ? formatMemberSince(identity.createdAt, lang) : null;

  return (
    <section style={{ maxWidth: 1000, margin: '0 auto', padding: 'clamp(28px,5vw,52px) clamp(16px,4vw,40px)' }}>
      {/* Profile header */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, padding: 28, display: 'flex', alignItems: 'center', gap: 22, marginBottom: 24, boxShadow: 'var(--shadow)', flexWrap: 'wrap' }}>
        {/* Avatar */}
        <div style={{ width: 84, height: 84, borderRadius: '50%', background: loading ? 'var(--surface2)' : 'linear-gradient(135deg,var(--accent),var(--accent-light))', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, flexShrink: 0, transition: 'background .2s' }}>
          {loading ? (
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
          ) : error ? '?' : identity?.initials ?? '?'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <>
              <div style={{ height: 22, width: 180, borderRadius: 8, background: 'var(--surface2)', marginBottom: 8 }} />
              <div style={{ height: 14, width: 220, borderRadius: 6, background: 'var(--surface2)', marginBottom: 6 }} />
              <div style={{ height: 14, width: 150, borderRadius: 6, background: 'var(--surface2)', marginBottom: 14 }} />
            </>
          ) : error ? (
            <>
              <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: 'var(--fg2)' }}>
                {lang === 'ar' ? 'تعذّر تحميل الملف' : 'Could not load profile'}
              </h1>
              <p style={{ margin: '0 0 14px', color: 'var(--fg3)', fontSize: 14 }}>
                {lang === 'ar' ? 'يرجى تحديث الصفحة' : 'Please refresh the page'}
              </p>
            </>
          ) : editing ? (
            <form onSubmit={handleSave} style={{ width: '100%' }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: 'var(--fg2)' }}>
                  {lang === 'ar' ? 'الاسم المعروض' : 'Display name'}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => { setEditName(e.target.value); setSaveError(''); }}
                  placeholder={lang === 'ar' ? 'أدخل اسمك' : 'Enter your name'}
                  maxLength={100}
                  disabled={saving}
                  style={{ width: '100%', border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 15, padding: '10px 12px', borderRadius: 10, outline: 'none', boxSizing: 'border-box', opacity: saving ? 0.7 : 1 }}
                  onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'}
                  onBlur={e => (e.target as HTMLInputElement).style.borderColor = ''}
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 4, color: 'var(--fg2)' }}>
                  {lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}
                </label>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--fg3)', padding: '4px 0' }}>{identity?.email}</p>
              </div>
              {saveError && (
                <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '8px 12px', color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
                  {saveError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '9px 18px', borderRadius: 10, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? (lang === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : (lang === 'ar' ? 'حفظ' : 'Save')}
                </button>
                <button
                  type="button"
                  onClick={handleEditCancel}
                  disabled={saving}
                  style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, padding: '9px 18px', borderRadius: 10, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                >
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1 style={{ margin: '0 0 2px', fontSize: 22, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {identity?.displayName}
              </h1>
              <p style={{ margin: '0 0 4px', color: 'var(--fg2)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {identity?.email}
              </p>
              <p style={{ margin: '0 0 14px', color: 'var(--fg3)', fontSize: 13 }}>
                {memberSince}
              </p>
              <button
                onClick={handleEditOpen}
                style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, padding: '9px 18px', borderRadius: 10, cursor: 'pointer' }}
              >
                {tr.profile.edit}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Meta-sync failure notice — shown after identity card closes */}
      {metaSyncFailed && (
        <div style={{ background: 'rgba(234,179,8,.1)', border: '1px solid rgba(234,179,8,.35)', borderRadius: 14, padding: '12px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: '#a16207', fontSize: 14 }}>
            {lang === 'ar'
              ? 'تم حفظ اسمك بنجاح، لكن تعذّر مزامنة عرضه في أجزاء أخرى من التطبيق. قد يظهر الاسم القديم في أماكن أخرى حتى تُعيد تحميل الصفحة.'
              : 'Profile name saved, but account display synchronization could not be completed. The old name may appear elsewhere until you refresh the page.'}
          </span>
          <button
            onClick={() => setMetaSyncFailed(false)}
            style={{ border: '1px solid rgba(234,179,8,.4)', background: 'rgba(234,179,8,.08)', color: '#a16207', fontFamily: 'inherit', fontWeight: 600, fontSize: 13, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', flexShrink: 0 }}
          >
            {lang === 'ar' ? 'حسناً' : 'OK'}
          </button>
        </div>
      )}

      {/* Stats error banner */}
      {statsError && !statsLoading && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 14, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: '#ef4444', fontSize: 14, fontWeight: 500 }}>
            {lang === 'ar' ? 'تعذّر تحميل الإحصائيات.' : 'Could not load statistics.'}
          </span>
          <button
            onClick={() => { setStatsLoading(true); setStatsError(false); setStatsRetry(n => n + 1); }}
            style={{ border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.08)', color: '#ef4444', fontFamily: 'inherit', fontWeight: 600, fontSize: 13, padding: '7px 14px', borderRadius: 8, cursor: 'pointer' }}
          >
            {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16, marginBottom: 24 }}>
        {[
          {
            label: tr.profile.sessions,
            value: statsLoading ? null : statsError ? '—' : String(statsData?.total ?? 0),
          },
          {
            label: tr.profile.avg,
            value: statsLoading ? null : statsError ? '—' : (statsData?.avg !== null && statsData?.avg !== undefined ? String(statsData.avg) : '—'),
          },
          {
            label: tr.profile.best,
            value: statsLoading ? null : statsError ? '—' : (statsData?.best !== null && statsData?.best !== undefined ? String(statsData.best) : '—'),
          },
          {
            label: tr.profile.streak,
            value: statsLoading ? null : statsError ? '—' : String(statsData?.streak ?? 0),
          },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '22px 20px', textAlign: 'center', boxShadow: 'var(--shadow)' }}>
            {s.value === null ? (
              <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 56, height: 36, borderRadius: 8, background: 'var(--surface2)' }} />
              </div>
            ) : (
              <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-.02em', color: s.value === '—' ? 'var(--fg3)' : 'var(--accent)' }}>{s.value}</div>
            )}
            <div style={{ fontSize: 13.5, color: 'var(--fg2)', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
        {/* Progress chart */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, padding: 28, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{tr.profile.progressH}</div>
          {statsLoading ? (
            /* Loading: six skeleton bars */
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
              {[40, 55, 35, 65, 50, 45].map((h, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: 'var(--surface2)', height: `${h}%` }} />
                  <div style={{ height: 10, width: '60%', borderRadius: 4, background: 'var(--surface2)' }} />
                </div>
              ))}
            </div>
          ) : statsError ? (
            /* Error: reuse P2 error state — brief inline note */
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'var(--fg3)', fontSize: 13 }}>
                {lang === 'ar' ? 'تعذّر تحميل البيانات.' : 'Could not load data.'}
              </span>
            </div>
          ) : statsData && statsData.chartBars.every(b => b.avgScore === null) ? (
            /* No sessions in the last 6 months */
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'var(--fg3)', fontSize: 13, textAlign: 'center' }}>
                {lang === 'ar' ? 'لا توجد جلسات خلال الأشهر الستة الماضية.' : 'No sessions in the last 6 months.'}
              </span>
            </div>
          ) : (
            /* Real data */
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
              {(statsData?.chartBars ?? []).map(bar => (
                <div key={bar.monthKey} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  {bar.avgScore !== null ? (
                    <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: 'var(--accent)', height: `${Math.min(100, Math.max(0, bar.avgScore))}%`, transition: 'height .5s ease', minHeight: 4 }} />
                  ) : (
                    <div style={{ width: '100%', height: 0 }} />
                  )}
                  <div style={{ fontSize: 11, color: 'var(--fg3)' }}>{shortMonthLabel(bar.monthKey, lang)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Achievements */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, padding: 28, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{tr.profile.badgesH}</div>
          {statsError && !statsLoading ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--fg3)', fontSize: 13 }}>
              {lang === 'ar' ? 'تعذّر تحميل الإنجازات.' : 'Could not load achievements.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {tr.profile.badges.map((b, i) => {
                // Compute real earned state; badges 4 (index 3) and 5 (index 4) remain deferred.
                let earned = false;
                if (!statsLoading && !statsError && statsData) {
                  if (i === 0) earned = statsData.achievements.firstInterview;
                  else if (i === 1) earned = statsData.achievements.fiveSessions;
                  else if (i === 2) earned = statsData.achievements.confidenceMaster;
                  else if (i === 5) earned = statsData.achievements.tenSessions;
                  // i === 3 (Smooth Speaker) and i === 4 (Perfect Pace): earned stays false
                }
                const Icon = BADGE_ICONS[b.icon] || Mic;
                return (
                  <div key={i} title={b.d} style={{
                    background: earned ? 'var(--accent-soft)' : 'var(--surface2)',
                    border: `1px solid ${earned ? 'rgba(2,132,199,.2)' : 'var(--border)'}`,
                    borderRadius: 14, padding: '14px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    opacity: earned ? 1 : 0.55, transition: 'opacity .2s',
                  }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: earned ? 'var(--accent)' : 'var(--border)', color: earned ? '#fff' : 'var(--fg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={20} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>{b.t}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </section>
  );
}
