'use client';
import { useState } from 'react';
import { Star, Send, CheckCircle } from 'lucide-react';
import { useApp } from '@/lib/context';
import { createClient } from '@/lib/supabase';

const APP_VERSION = '0.1.0';

function StarRating({ value, onChange, label, required }: {
  value: number; onChange: (v: number) => void; label: string; required?: boolean;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--fg)' }}>{label}</span>
        {required && <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>*</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: n <= (hover || value) ? '#f59e0b' : 'var(--border)',
              transition: 'color .12s, transform .1s',
              transform: hover === n ? 'scale(1.2)' : 'scale(1)',
            }}
          >
            <Star size={28} fill={n <= (hover || value) ? '#f59e0b' : 'none'} strokeWidth={1.5} />
          </button>
        ))}
        {value > 0 && (
          <span style={{ alignSelf: 'center', marginInlineStart: 8, fontSize: 13, color: 'var(--fg2)', fontWeight: 600 }}>
            {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][value]}
          </span>
        )}
      </div>
    </div>
  );
}

function Textarea({ label, value, onChange, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--fg)', marginBottom: 6 }}>{label}</label>
      {hint && <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--fg2)' }}>{hint}</p>}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          background: 'var(--surface2)', border: '1.5px solid var(--border)',
          borderRadius: 12, padding: '12px 14px', fontSize: 14,
          fontFamily: 'inherit', color: 'var(--fg)', outline: 'none',
          transition: 'border-color .15s',
          minHeight: 100,
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
        onBlur={e => (e.target.style.borderColor = 'var(--border)')}
      />
    </div>
  );
}

function SectionDivider({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0 24px' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

export default function FeedbackPage() {
  const { lang } = useApp();
  const isAr = lang === 'ar';

  const [overall, setOverall] = useState(0);
  const [easeOfUse, setEaseOfUse] = useState(0);
  const [evalAccuracy, setEvalAccuracy] = useState(0);
  const [reportQuality, setReportQuality] = useState(0);
  const [coachingQuality, setCoachingQuality] = useState(0);
  const [module, setModule] = useState('');
  const [liked, setLiked] = useState('');
  const [improvements, setImprovements] = useState('');
  const [bugReport, setBugReport] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (overall === 0) {
      setError(isAr ? 'يرجى تقديم التقييم الإجمالي' : 'Please provide an overall rating');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      const ua = navigator.userAgent;
      const os = nav.userAgentData?.platform ?? (
        /Windows/.test(ua) ? 'Windows' :
        /Mac/.test(ua) ? 'macOS' :
        /Linux/.test(ua) ? 'Linux' :
        /Android/.test(ua) ? 'Android' :
        /iPhone|iPad/.test(ua) ? 'iOS' : 'Unknown'
      );
      const browser =
        /Edg/.test(ua) ? 'Edge' :
        /Chrome/.test(ua) ? 'Chrome' :
        /Firefox/.test(ua) ? 'Firefox' :
        /Safari/.test(ua) ? 'Safari' : 'Other';

      const supabase = createClient();
      const { error: dbErr } = await supabase.from('feedback').insert({
        overall_rating: overall,
        ease_of_use: easeOfUse || null,
        evaluation_accuracy: evalAccuracy || null,
        report_quality: reportQuality || null,
        coaching_quality: coachingQuality || null,
        module: module || null,
        liked: liked.trim() || null,
        improvements: improvements.trim() || null,
        bug_report: bugReport.trim() || null,
        email: email.trim() || null,
        user_agent: ua.slice(0, 300),
        browser,
        operating_system: os,
        screen_size: `${window.screen.width}x${window.screen.height}`,
        app_version: APP_VERSION,
        language: lang,
      });
      if (dbErr) throw dbErr;
      setSubmitted(true);
    } catch {
      setError(isAr ? 'حدث خطأ. يرجى المحاولة مجدداً.' : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <section style={{ maxWidth: 560, margin: '0 auto', padding: 'clamp(60px,10vw,100px) clamp(16px,4vw,40px)', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: 'var(--accent)' }}>
          <CheckCircle size={36} />
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: 26, fontWeight: 800 }}>
          {isAr ? 'شكراً على ملاحظاتك!' : 'Thank you for your feedback!'}
        </h1>
        <p style={{ color: 'var(--fg2)', fontSize: 16, lineHeight: 1.6, margin: 0 }}>
          {isAr
            ? 'ملاحظاتك تساعدنا على تحسين المنصة لجميع المستخدمين.'
            : 'Your feedback helps us improve the platform for everyone.'}
        </p>
      </section>
    );
  }

  const selectStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--surface2)', border: '1.5px solid var(--border)',
    borderRadius: 12, padding: '12px 14px', fontSize: 14,
    fontFamily: 'inherit', color: 'var(--fg)', outline: 'none',
    cursor: 'pointer', appearance: 'none',
  };

  return (
    <section style={{ maxWidth: 640, margin: '0 auto', padding: 'clamp(28px,5vw,52px) clamp(16px,4vw,40px)' }}>
      {/* Header */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 30, padding: '6px 14px', fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
          <Star size={14} fill="currentColor" />
          {isAr ? 'نسخة تجريبية' : 'Beta Feedback'}
        </div>
        <h1 style={{ margin: '0 0 10px', fontSize: 30, fontWeight: 800 }}>
          {isAr ? 'شاركنا رأيك' : 'Share Your Feedback'}
        </h1>
        <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 15, lineHeight: 1.6 }}>
          {isAr
            ? 'ساعدنا في تحسين قضاء. ملاحظاتك تصل مباشرة إلى فريق التطوير.'
            : 'Help us improve Qadha. Your feedback goes directly to the development team.'}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Ratings card */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '28px 28px 8px', marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <SectionDivider title={isAr ? 'التقييمات' : 'Ratings'} />
          <StarRating value={overall} onChange={setOverall} label={isAr ? 'التجربة الإجمالية' : 'Overall Experience'} required />
          <StarRating value={easeOfUse} onChange={setEaseOfUse} label={isAr ? 'سهولة الاستخدام' : 'Ease of Use'} />
          <StarRating value={evalAccuracy} onChange={setEvalAccuracy} label={isAr ? 'دقة تقييم الذكاء الاصطناعي' : 'AI Evaluation Accuracy'} />
          <StarRating value={reportQuality} onChange={setReportQuality} label={isAr ? 'جودة التقرير' : 'Report Quality'} />
          <StarRating value={coachingQuality} onChange={setCoachingQuality} label={isAr ? 'جودة التوجيه' : 'Coaching Quality'} />
        </div>

        {/* Module + text feedback */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '28px 28px 8px', marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <SectionDivider title={isAr ? 'تفاصيل إضافية' : 'Details'} />

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--fg)', marginBottom: 6 }}>
              {isAr ? 'أي وحدة جرّبت؟' : 'Which module did you test?'}
            </label>
            <select value={module} onChange={e => setModule(e.target.value)} style={selectStyle}>
              <option value="">{isAr ? '— اختر —' : '— Select —'}</option>
              <option value="interview">{isAr ? 'المقابلة' : 'Interview'}</option>
              <option value="presentation">{isAr ? 'العرض التقديمي' : 'Presentation'}</option>
              <option value="both">{isAr ? 'كلاهما' : 'Both'}</option>
            </select>
          </div>

          <Textarea
            label={isAr ? 'ما الذي أعجبك أكثر؟' : 'What did you like most?'}
            value={liked}
            onChange={setLiked}
            placeholder={isAr ? 'اذكر ما أعجبك في المنصة...' : 'Tell us what you enjoyed about the platform…'}
          />
          <Textarea
            label={isAr ? 'ما الذي يحتاج تحسينًا؟' : 'What needs improvement?'}
            value={improvements}
            onChange={setImprovements}
            placeholder={isAr ? 'اذكر أي شيء تودّ تحسينه...' : 'What would you like to see improved?'}
          />
          <Textarea
            label={isAr ? 'هل واجهت أي خلل تقني؟' : 'Did you encounter any bug?'}
            value={bugReport}
            onChange={setBugReport}
            placeholder={isAr ? 'صف ما حدث...' : 'Describe what happened…'}
          />
        </div>

        {/* Contact */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '28px 28px 28px', marginBottom: 24, boxShadow: 'var(--shadow)' }}>
          <SectionDivider title={isAr ? 'التواصل (اختياري)' : 'Contact (Optional)'} />
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--fg)', marginBottom: 6 }}>
              {isAr ? 'البريد الإلكتروني' : 'Email'}
            </label>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--fg2)' }}>
              {isAr ? 'فقط إذا أردت أن نتواصل معك.' : 'Only if you would like us to follow up with you.'}
            </p>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={isAr ? 'بريدك الإلكتروني' : 'your@email.com'}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--surface2)', border: '1.5px solid var(--border)',
                borderRadius: 12, padding: '12px 14px', fontSize: 14,
                fontFamily: 'inherit', color: 'var(--fg)', outline: 'none',
              }}
              onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border)')}
            />
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#dc2626', fontSize: 14, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            background: submitting ? 'var(--accent-soft)' : 'var(--accent)',
            color: submitting ? 'var(--accent)' : 'var(--accent-fg)',
            border: 'none', borderRadius: 14, padding: '16px 28px',
            fontFamily: 'inherit', fontWeight: 700, fontSize: 16,
            cursor: submitting ? 'not-allowed' : 'pointer',
            transition: 'background .15s',
          }}
        >
          <Send size={18} />
          {submitting
            ? (isAr ? 'جارٍ الإرسال…' : 'Submitting…')
            : (isAr ? 'إرسال الملاحظات' : 'Submit Feedback')}
        </button>
      </form>
    </section>
  );
}
