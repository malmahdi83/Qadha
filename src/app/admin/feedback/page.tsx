'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { useApp } from '@/lib/context';
import { BarChart2, Star, Bug, Sparkles, RefreshCw, Users, TrendingUp, Zap } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedbackRow {
  id: string;
  created_at: string;
  overall_rating: number | null;
  ease_of_use: number | null;
  evaluation_accuracy: number | null;
  report_quality: number | null;
  coaching_quality: number | null;
  module: string | null;
  liked: string | null;
  improvements: string | null;
  bug_report: string | null;
  email: string | null;
  language: string | null;
}

// ─── Theme extraction ─────────────────────────────────────────────────────────

const FEATURE_KEYWORDS: { label: string; terms: string[] }[] = [
  { label: 'Arabic Voice', terms: ['arabic voice', 'arabic audio', 'صوت عربي', 'تحويل نص', 'tts arabic'] },
  { label: 'Score Calibration', terms: ['score', 'calibration', 'rating', 'درجة', 'تقييم', 'accuracy'] },
  { label: 'PDF Export', terms: ['pdf', 'export', 'download', 'report download', 'تصدير'] },
  { label: 'Question Quality', terms: ['question', 'questions', 'أسئلة', 'سؤال', 'better question'] },
  { label: 'Voice Speed', terms: ['voice speed', 'slow', 'fast', 'pace', 'tts', 'سرعة الصوت'] },
  { label: 'UI / Design', terms: ['ui', 'design', 'interface', 'look', 'واجهة', 'تصميم'] },
  { label: 'Performance', terms: ['slow', 'loading', 'performance', 'lag', 'بطيء', 'تحميل'] },
  { label: 'Login / Auth', terms: ['login', 'signup', 'auth', 'register', 'تسجيل', 'دخول'] },
  { label: 'Coaching', terms: ['coaching', 'feedback', 'coach', 'تدريب', 'توجيه'] },
  { label: 'Dark Mode', terms: ['dark mode', 'theme', 'dark', 'الوضع الداكن'] },
  { label: 'Mobile Support', terms: ['mobile', 'phone', 'app', 'ios', 'android', 'جوال', 'هاتف'] },
];

function extractThemes(rows: FeedbackRow[]): { label: string; count: number }[] {
  const text = rows
    .map(r => [r.liked, r.improvements].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();

  return FEATURE_KEYWORDS
    .map(({ label, terms }) => ({
      label,
      count: terms.reduce((sum, term) => {
        const regex = new RegExp(term, 'gi');
        return sum + (text.match(regex)?.length ?? 0);
      }, 0),
    }))
    .filter(f => f.count > 0)
    .sort((a, b) => b.count - a.count);
}

function extractBugs(rows: FeedbackRow[]): { text: string; count: number; lastReported: string }[] {
  const bugs = rows
    .filter(r => r.bug_report && r.bug_report.trim().length > 5)
    .map(r => ({ text: r.bug_report!.trim(), date: r.created_at }));

  // Simple dedup by first 40 chars
  const groups: Record<string, { texts: string[]; dates: string[] }> = {};
  for (const b of bugs) {
    const key = b.text.slice(0, 40).toLowerCase().replace(/\s+/g, ' ');
    if (!groups[key]) groups[key] = { texts: [], dates: [] };
    groups[key].texts.push(b.text);
    groups[key].dates.push(b.date);
  }
  return Object.values(groups)
    .map(g => ({
      text: g.texts[0].slice(0, 120),
      count: g.texts.length,
      lastReported: g.dates.sort().at(-1)!,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

// ─── Mini chart components ────────────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .4s' }} />
    </div>
  );
}

function StarDisplay({ value }: { value: number }) {
  return (
    <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 15 }}>
      {'★'.repeat(Math.round(value))}{'☆'.repeat(5 - Math.round(value))}
    </span>
  );
}

function OverviewCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string;
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 22px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: color + '22', color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--fg2)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--fg3)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── Ratings by day chart (simple CSS) ───────────────────────────────────────

function FeedbackTimeline({ rows }: { rows: FeedbackRow[] }) {
  const byDay: Record<string, number> = {};
  rows.forEach(r => {
    const day = r.created_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  });
  const days = Object.keys(byDay).sort().slice(-14);
  const max = Math.max(...days.map(d => byDay[d]), 1);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
        {days.map(day => (
          <div key={day} title={`${day}: ${byDay[day]}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: '100%', background: 'var(--accent)', borderRadius: '4px 4px 0 0',
              height: `${(byDay[day] / max) * 64}px`, minHeight: 4, transition: 'height .3s',
              opacity: 0.85,
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {days.length > 0 && <>
          <span style={{ fontSize: 11, color: 'var(--fg3)' }}>{days[0]}</span>
          <span style={{ fontSize: 11, color: 'var(--fg3)' }}>{days.at(-1)}</span>
        </>}
      </div>
    </div>
  );
}

// ─── Ratings distribution ─────────────────────────────────────────────────────

function RatingsBar({ rows }: { rows: FeedbackRow[] }) {
  const dist = [1, 2, 3, 4, 5].map(n => ({
    n,
    count: rows.filter(r => r.overall_rating === n).length,
  }));
  const max = Math.max(...dist.map(d => d.count), 1);
  const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {dist.reverse().map(({ n, count }) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 16, fontSize: 13, color: 'var(--fg2)', fontWeight: 600 }}>{n}★</span>
          <MiniBar value={count} max={max} color={colors[n - 1]} />
          <span style={{ width: 28, fontSize: 12, color: 'var(--fg3)', textAlign: 'end' }}>{count}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Module pie (CSS) ─────────────────────────────────────────────────────────

function ModulePie({ rows }: { rows: FeedbackRow[] }) {
  const counts = { interview: 0, presentation: 0, both: 0, unset: 0 };
  rows.forEach(r => {
    if (r.module === 'interview') counts.interview++;
    else if (r.module === 'presentation') counts.presentation++;
    else if (r.module === 'both') counts.both++;
    else counts.unset++;
  });
  const total = rows.length || 1;
  const slices = [
    { label: 'Interview', count: counts.interview, color: '#3b82f6' },
    { label: 'Presentation', count: counts.presentation, color: '#8b5cf6' },
    { label: 'Both', count: counts.both, color: '#10b981' },
    { label: 'Not specified', count: counts.unset, color: 'var(--border)' },
  ].filter(s => s.count > 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {slices.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--fg2)' }}>{s.label}</span>
            <span style={{ fontWeight: 700 }}>{Math.round((s.count / total) * 100)}%</span>
          </div>
        ))}
      </div>
      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 16, borderRadius: 8, overflow: 'hidden', gap: 2 }}>
        {slices.map(s => (
          <div key={s.label} style={{ flex: s.count, background: s.color, minWidth: s.count > 0 ? 4 : 0 }} />
        ))}
      </div>
    </div>
  );
}

// ─── Avg ratings by module ────────────────────────────────────────────────────

function AvgByModule({ rows }: { rows: FeedbackRow[] }) {
  const modules = ['interview', 'presentation', 'both'];
  const dims = [
    { key: 'overall_rating' as keyof FeedbackRow, label: 'Overall' },
    { key: 'evaluation_accuracy' as keyof FeedbackRow, label: 'AI Accuracy' },
    { key: 'coaching_quality' as keyof FeedbackRow, label: 'Coaching' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {modules.map(mod => {
        const subset = rows.filter(r => r.module === mod);
        if (subset.length === 0) return null;
        return (
          <div key={mod}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg2)', marginBottom: 6, textTransform: 'capitalize' }}>
              {mod} <span style={{ fontWeight: 400, color: 'var(--fg3)' }}>({subset.length})</span>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              {dims.map(dim => {
                const vals = subset.map(r => r[dim.key] as number | null).filter((v): v is number => v !== null);
                const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                return (
                  <div key={dim.key} style={{ fontSize: 12, color: 'var(--fg3)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--fg2)' }}>{dim.label}: </span>
                    <span style={{ color: '#f59e0b', fontWeight: 700 }}>{avg.toFixed(1)}★</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Priority matrix ──────────────────────────────────────────────────────────

function priorityLabel(count: number): { label: string; color: string } {
  if (count >= 10) return { label: 'High', color: '#ef4444' };
  if (count >= 4) return { label: 'Medium', color: '#f97316' };
  return { label: 'Low', color: '#22c55e' };
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function AdminFeedbackPage() {
  const { lang } = useApp();
  const router = useRouter();
  const isAr = lang === 'ar';

  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/auth/login'); return; }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (!profile || profile.role !== 'admin') { setUnauthorized(true); setLoading(false); return; }

    const { data } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    setRows(data ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => { loadData(); }, [loadData]);

  const generateAiSummary = async () => {
    if (rows.length === 0) return;
    setAiLoading(true);
    setAiSummary('');
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';

      const feedbackText = rows.slice(0, 80).map((r, i) =>
        `[${i + 1}] Rating:${r.overall_rating}/5 Module:${r.module ?? 'n/a'} ` +
        `Liked:"${r.liked ?? ''}" Improve:"${r.improvements ?? ''}" Bug:"${r.bug_report ?? ''}"`
      ).join('\n');

      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/analyze-feedback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ feedback: feedbackText, count: rows.length }),
        }
      );
      if (!resp.ok) throw new Error('Edge function error');
      const data = await resp.json();
      setAiSummary(data.summary ?? 'No summary generated.');
    } catch {
      setAiSummary('Failed to generate summary. Please try again.');
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--fg2)' }}>Loading…</div>;
  if (unauthorized) return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🚫</div>
      <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800 }}>Unauthorized</h1>
      <p style={{ color: 'var(--fg2)' }}>This page is for admins only.</p>
    </div>
  );

  // ── Derived metrics ──
  const n = rows.length;
  const avg = (key: keyof FeedbackRow) => {
    const vals = rows.map(r => r[key] as number | null).filter((v): v is number => v !== null);
    return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };
  const avgOverall = avg('overall_rating');
  const avgAccuracy = avg('evaluation_accuracy');
  const avgCoaching = avg('coaching_quality');
  const avgEase = avg('ease_of_use');

  const themes = extractThemes(rows);
  const bugs = extractBugs(rows);

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 18, padding: '24px 26px', boxShadow: 'var(--shadow)',
  };

  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(24px,4vw,48px) clamp(16px,4vw,36px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 32 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent)', color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart2 size={18} />
            </div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
              {isAr ? 'تحليلات الملاحظات' : 'Feedback Analytics'}
            </h1>
          </div>
          <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 14 }}>
            {isAr ? `${n} ملاحظة` : `${n} feedback submissions`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={loadData} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', fontFamily: 'inherit', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', color: 'var(--fg2)' }}>
            <RefreshCw size={14} /> {isAr ? 'تحديث' : 'Refresh'}
          </button>
          <a href="/admin" style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', fontWeight: 600, fontSize: 13.5, textDecoration: 'none', color: 'var(--fg2)' }}>
            ← {isAr ? 'لوحة الإدارة' : 'Admin Panel'}
          </a>
        </div>
      </div>

      {n === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--fg2)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
          <p style={{ fontSize: 16, fontWeight: 600 }}>{isAr ? 'لا توجد ملاحظات بعد' : 'No feedback yet'}</p>
          <p style={{ fontSize: 14 }}>{isAr ? 'ستظهر الملاحظات هنا بمجرد وصولها.' : 'Submissions will appear here once received.'}</p>
        </div>
      ) : (
        <>
          {/* Overview cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14, marginBottom: 28 }}>
            <OverviewCard icon={<Users size={20} />} label={isAr ? 'إجمالي الملاحظات' : 'Total Feedback'} value={n} color="#3b82f6" />
            <OverviewCard icon={<Star size={20} />} label={isAr ? 'متوسط التقييم' : 'Avg Overall'} value={avgOverall.toFixed(1) + '★'} sub={isAr ? 'من 5' : 'out of 5'} color="#f59e0b" />
            <OverviewCard icon={<Zap size={20} />} label={isAr ? 'دقة الذكاء الاصطناعي' : 'AI Accuracy'} value={avgAccuracy.toFixed(1) + '★'} color="#8b5cf6" />
            <OverviewCard icon={<TrendingUp size={20} />} label={isAr ? 'جودة التوجيه' : 'Coaching Quality'} value={avgCoaching.toFixed(1) + '★'} color="#10b981" />
            <OverviewCard icon={<BarChart2 size={20} />} label={isAr ? 'سهولة الاستخدام' : 'Ease of Use'} value={avgEase.toFixed(1) + '★'} color="#06b6d4" />
          </div>

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, marginBottom: 20 }}>
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>{isAr ? 'الملاحظات بمرور الوقت' : 'Feedback Over Time'}</h2>
              <FeedbackTimeline rows={rows} />
            </div>
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>{isAr ? 'توزيع التقييمات' : 'Ratings Distribution'}</h2>
              <RatingsBar rows={rows} />
            </div>
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>{isAr ? 'الوحدات المُختبرة' : 'Modules Tested'}</h2>
              <ModulePie rows={rows} />
            </div>
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>{isAr ? 'متوسط التقييمات حسب الوحدة' : 'Avg Ratings by Module'}</h2>
              <AvgByModule rows={rows} />
            </div>
          </div>

          {/* Feature themes + Bug analysis */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20, marginBottom: 20 }}>
            {/* Feature requests */}
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>
                {isAr ? 'أكثر الميزات المطلوبة' : 'Most Requested Features'}
              </h2>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--fg3)' }}>
                {isAr ? 'مستخلص من النصوص الحرة' : 'Extracted from free-text feedback'}
              </p>
              {themes.length === 0 ? (
                <p style={{ color: 'var(--fg3)', fontSize: 13 }}>{isAr ? 'لا توجد بيانات كافية' : 'Not enough data yet'}</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--fg3)', fontWeight: 600 }}>
                      <th style={{ textAlign: 'start', paddingBottom: 8 }}>{isAr ? 'الميزة' : 'Feature'}</th>
                      <th style={{ textAlign: 'center', paddingBottom: 8 }}>{isAr ? 'الإشارات' : 'Mentions'}</th>
                      <th style={{ textAlign: 'start', paddingBottom: 8 }}>{isAr ? 'الأولوية' : 'Priority'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {themes.map(f => {
                      const pri = priorityLabel(f.count);
                      return (
                        <tr key={f.label} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '9px 0', fontWeight: 600 }}>{f.label}</td>
                          <td style={{ padding: '9px 0', textAlign: 'center', fontWeight: 700, color: 'var(--accent)' }}>{f.count}</td>
                          <td style={{ padding: '9px 0' }}>
                            <span style={{ background: pri.color + '22', color: pri.color, borderRadius: 6, padding: '2px 8px', fontWeight: 700, fontSize: 12 }}>{pri.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Bug analysis */}
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bug size={16} color="#ef4444" />
                {isAr ? 'تحليل الأخطاء' : 'Bug Reports'}
              </h2>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--fg3)' }}>
                {bugs.length} {isAr ? 'نوع خلل مُبلَّغ عنه' : 'distinct issues reported'}
              </p>
              {bugs.length === 0 ? (
                <p style={{ color: 'var(--fg3)', fontSize: 13 }}>✅ {isAr ? 'لا أخطاء مُبلَّغ عنها' : 'No bugs reported yet'}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {bugs.map((b, i) => (
                    <div key={i} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ fontSize: 13, color: 'var(--fg)', marginBottom: 6 }}>{b.text}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg3)' }}>
                        <span style={{ fontWeight: 700, color: '#ef4444' }}>{b.count}×</span>
                        <span>{b.lastReported.slice(0, 10)}</span>
                        <span style={{ background: '#fef9c3', color: '#854d0e', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>Open</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Priority matrix */}
          {themes.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: 20 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>
                {isAr ? 'مصفوفة الأولويات' : 'Priority Matrix'}
              </h2>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--fg3)' }}>
                {isAr ? 'قائمة التحسينات المرتبة حسب الطلب' : 'Ranked improvement list based on request frequency'}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: 10 }}>
                {themes.slice(0, 9).map((f, i) => {
                  const pri = priorityLabel(f.count);
                  return (
                    <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface2)', borderRadius: 10, padding: '10px 14px' }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg3)', width: 20 }}>#{i + 1}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{f.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg3)' }}>{f.count} {isAr ? 'إشارة' : 'mentions'}</div>
                      </div>
                      <span style={{ background: pri.color + '22', color: pri.color, borderRadius: 6, padding: '3px 9px', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{pri.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI Summary */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={16} color="var(--accent)" />
                  {isAr ? 'ملخص الذكاء الاصطناعي' : 'AI Summary'}
                </h2>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--fg3)' }}>
                  {isAr ? 'تحليل شامل لجميع الملاحظات' : 'Comprehensive analysis of all feedback'}
                </p>
              </div>
              <button
                onClick={generateAiSummary}
                disabled={aiLoading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: aiLoading ? 'var(--accent-soft)' : 'var(--accent)',
                  color: aiLoading ? 'var(--accent)' : 'var(--accent-fg)',
                  border: 'none', borderRadius: 10, padding: '10px 18px',
                  fontFamily: 'inherit', fontWeight: 700, fontSize: 13.5,
                  cursor: aiLoading ? 'not-allowed' : 'pointer',
                  transition: 'background .15s',
                }}
              >
                <Sparkles size={15} />
                {aiLoading
                  ? (isAr ? 'جارٍ التحليل…' : 'Analysing…')
                  : (isAr ? 'إنشاء ملخص' : 'Generate AI Summary')}
              </button>
            </div>
            {aiSummary ? (
              <div style={{ background: 'var(--surface2)', borderRadius: 12, padding: '18px 20px', fontSize: 14, lineHeight: 1.7, color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>
                {aiSummary}
              </div>
            ) : (
              <div style={{ background: 'var(--surface2)', borderRadius: 12, padding: '24px', textAlign: 'center', color: 'var(--fg3)', fontSize: 14 }}>
                {isAr
                  ? 'اضغط "إنشاء ملخص" لتحليل جميع الملاحظات بالذكاء الاصطناعي.'
                  : 'Click "Generate AI Summary" to analyse all feedback with AI.'}
              </div>
            )}
          </div>

          {/* Raw table */}
          <div style={{ ...cardStyle, marginTop: 20, overflow: 'hidden' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>
              {isAr ? 'آخر الملاحظات' : 'Recent Submissions'}
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                    {[isAr ? 'التاريخ' : 'Date', isAr ? 'التقييم' : 'Rating', isAr ? 'الوحدة' : 'Module', isAr ? 'أعجبه' : 'Liked', isAr ? 'التحسين' : 'Improvement', isAr ? 'خلل' : 'Bug'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'start', fontWeight: 700, color: 'var(--fg2)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => (
                    <tr key={r.id} style={{ borderBottom: i < Math.min(rows.length, 20) - 1 ? '1px solid var(--border)' : 'none' }}>
                      <td style={{ padding: '10px 14px', color: 'var(--fg2)', whiteSpace: 'nowrap' }}>{r.created_at.slice(0, 10)}</td>
                      <td style={{ padding: '10px 14px' }}><StarDisplay value={r.overall_rating ?? 0} /></td>
                      <td style={{ padding: '10px 14px', color: 'var(--fg2)', textTransform: 'capitalize' }}>{r.module ?? '—'}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--fg2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.liked ?? '—'}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--fg2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.improvements ?? '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        {r.bug_report
                          ? <span style={{ background: '#fef2f2', color: '#dc2626', borderRadius: 6, padding: '2px 8px', fontWeight: 700, fontSize: 12 }}>Yes</span>
                          : <span style={{ color: 'var(--fg3)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
