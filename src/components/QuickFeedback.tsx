'use client';
import { useState } from 'react';
import { Star, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';

interface Props {
  onClose: () => void;
  module: 'interview' | 'presentation';
  lang: 'en' | 'ar';
  sessionId?: string | null;
  score?: number | null;
}

export default function QuickFeedback({ onClose, module, lang, sessionId, score }: Props) {
  const isAr = lang === 'ar';
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [done, setDone] = useState(false);

  const handleRate = async (n: number) => {
    setRating(n);
    const supabase = createClient();
    const ua = navigator.userAgent;
    const browser =
      /Edg/.test(ua) ? 'Edge' :
      /Chrome/.test(ua) ? 'Chrome' :
      /Firefox/.test(ua) ? 'Firefox' :
      /Safari/.test(ua) ? 'Safari' : 'Other';

    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const os = nav.userAgentData?.platform ?? (
      /Windows/.test(ua) ? 'Windows' :
      /Mac/.test(ua) ? 'macOS' :
      /Linux/.test(ua) ? 'Linux' :
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad/.test(ua) ? 'iOS' : 'Unknown'
    );

    const row: Record<string, unknown> = {
      overall_rating: n,
      module,
      language: lang,
      user_agent: ua.slice(0, 300),
      browser,
      operating_system: os,
      screen_size: `${window.screen.width}x${window.screen.height}`,
      app_version: '0.1.0',
    };

    if (sessionId) row.session_id = sessionId;
    if (score != null) {
      if (module === 'interview') row.interview_score = score;
      else row.presentation_score = score;
    }

    await supabase.from('feedback').insert(row);
    setDone(true);
  };

  const wrapperStyle: React.CSSProperties = {
    position: 'fixed', bottom: 28, insetInlineEnd: 28, zIndex: 999,
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 18, padding: '20px 22px', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
    maxWidth: 320, width: 'calc(100vw - 40px)',
    animation: 'qfeedbackUp .25s ease',
  };

  if (done) {
    const isNegative = rating <= 3;
    return (
      <div style={wrapperStyle}>
        <style>{`@keyframes qfeedbackUp { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:translateY(0) } }`}</style>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 12, insetInlineEnd: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4 }}>
          <X size={16} />
        </button>
        <div style={{ textAlign: 'center', paddingTop: 4 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>{isNegative ? '💬' : '🙌'}</div>
          <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 15 }}>
            {isNegative
              ? (isAr ? 'نأسف لذلك!' : 'Sorry to hear that!')
              : (isAr ? 'شكراً!' : 'Thank you!')}
          </p>
          <Link
            href="/feedback"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
          >
            {isNegative
              ? (isAr ? 'أخبرنا بما يمكن تحسينه' : 'Tell us what we can improve')
              : (isAr ? 'اترك ملاحظات مفصّلة' : 'Leave detailed feedback')}
            <ExternalLink size={13} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      <style>{`@keyframes qfeedbackUp { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:translateY(0) } }`}</style>
      <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 12, insetInlineEnd: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4 }}>
        <X size={16} />
      </button>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 14 }}>
        {isAr ? 'كيف كانت تجربتك؟' : 'How was your experience?'}
      </p>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--fg3)' }}>
        {isAr ? 'انقر على نجمة للتقييم' : 'Tap a star to rate'}
      </p>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => handleRate(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n} star`}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: n <= (hover || rating) ? '#f59e0b' : 'var(--border)',
              transform: hover === n ? 'scale(1.25)' : 'scale(1)',
              transition: 'transform .1s, color .1s',
            }}
          >
            <Star size={30} fill={n <= (hover || rating) ? '#f59e0b' : 'none'} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </div>
  );
}
