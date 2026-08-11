'use client';
import { useState } from 'react';
import { Star, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';

interface Props {
  onClose: () => void;
  module: 'interview' | 'presentation';
  lang: 'en' | 'ar';
}

export default function QuickFeedback({ onClose, module, lang }: Props) {
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
    await supabase.from('feedback').insert({
      overall_rating: n,
      module,
      language: lang,
      user_agent: ua.slice(0, 300),
      browser,
      screen_size: `${window.screen.width}x${window.screen.height}`,
      app_version: '0.1.0',
    });
    setDone(true);
  };

  const wrapperStyle: React.CSSProperties = {
    position: 'fixed', bottom: 28, insetInlineEnd: 28, zIndex: 999,
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 18, padding: '20px 22px', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
    maxWidth: 320, width: '90vw',
    animation: 'fadeUp .25s ease',
  };

  if (done) {
    return (
      <div style={wrapperStyle}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, insetInlineEnd: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}>
          <X size={16} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🙌</div>
          <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 14 }}>
            {isAr ? 'شكراً!' : 'Thank you!'}
          </p>
          {rating <= 3 && (
            <Link href="/feedback" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
              {isAr ? 'أخبرنا بالمزيد' : 'Tell us more'} <ExternalLink size={13} />
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }`}</style>
      <button onClick={onClose} style={{ position: 'absolute', top: 12, insetInlineEnd: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}>
        <X size={16} />
      </button>
      <p style={{ margin: '0 0 14px', fontWeight: 700, fontSize: 14 }}>
        {isAr ? 'كيف كانت تجربتك؟' : 'How was your experience?'}
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => handleRate(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: n <= (hover || rating) ? '#f59e0b' : 'var(--border)',
              transform: hover === n ? 'scale(1.25)' : 'scale(1)',
              transition: 'transform .1s, color .1s',
            }}
          >
            <Star size={28} fill={n <= (hover || rating) ? '#f59e0b' : 'none'} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </div>
  );
}
