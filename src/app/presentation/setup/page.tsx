'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Presentation, ArrowRight, Upload, Check, Loader } from 'lucide-react';
import { useApp } from '@/lib/context';
import { t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase';

const ALLOWED = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export default function PresentationSetupPage() {
  const { lang, topic, setTopic } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploaded, setUploaded] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const handleFile = async (file: File) => {
    setUploadError('');
    if (!ALLOWED.includes(file.type)) {
      setUploadError(lang === 'ar' ? 'نوع الملف غير مدعوم' : 'Unsupported file type');
      return;
    }
    if (file.size > MAX_SIZE) {
      setUploadError(lang === 'ar' ? 'حجم الملف يتجاوز 10 ميجابايت' : 'File exceeds 10 MB');
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const path = user ? `${user.id}/${Date.now()}_${file.name}` : `anon/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('documents').upload(path, file);
    setUploading(false);
    if (error) {
      setUploadError(error.message);
    } else {
      setUploaded(file.name);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <section style={{ maxWidth: 660, margin: '0 auto', padding: 'clamp(28px,5vw,52px) clamp(16px,4vw,40px)' }}>
      <button onClick={() => router.push('/modes')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'transparent', color: 'var(--fg2)', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, cursor: 'pointer', padding: '6px 0', marginBottom: 18 }}>
        <span style={{ display: 'inline-flex', transform: dir === 'rtl' ? 'none' : 'scaleX(-1)' }}><ArrowRight size={16} /></span>
        {tr.pres.back}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, background: '#8b5cf6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Presentation size={28} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px,3.4vw,32px)', fontWeight: 800, letterSpacing: '-.025em' }}>{tr.pres.setupTitle}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--fg2)', fontSize: 15 }}>{tr.pres.setupSub}</p>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 'clamp(20px,3vw,30px)', marginTop: 24, display: 'flex', flexDirection: 'column', gap: 22, boxShadow: 'var(--shadow)' }}>
        {/* Topic */}
        <div>
          <label style={{ display: 'block', fontWeight: 700, fontSize: 14.5, marginBottom: 10 }}>{tr.pres.topicL}</label>
          <input type="text" value={topic} onChange={e => setTopic(e.target.value)}
            placeholder={tr.pres.topicPh}
            style={{ width: '100%', border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit', fontSize: 15, padding: '13px 16px', borderRadius: 12, outline: 'none', boxSizing: 'border-box', transition: 'border-color .15s' }}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = '#8b5cf6'}
            onBlur={e => (e.target as HTMLInputElement).style.borderColor = ''} />
        </div>

        {/* Upload */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <label style={{ fontWeight: 700, fontSize: 14.5 }}>{tr.pres.uploadL}</label>
            <span style={{ fontSize: 12, color: 'var(--fg3)', background: 'var(--surface2)', padding: '3px 9px', borderRadius: 20 }}>{tr.pres.uploadOpt}</span>
          </div>

          {uploadError && (
            <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '9px 14px', color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{uploadError}</div>
          )}

          <input ref={fileRef} type="file" accept=".pdf,.docx,.ppt,.pptx" style={{ display: 'none' }}
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

          <div onClick={() => !uploading && fileRef.current?.click()}
            onDrop={onDrop} onDragOver={e => e.preventDefault()}
            style={{ width: '100%', border: `1.5px dashed ${uploaded ? '#8b5cf6' : 'var(--border)'}`, background: uploaded ? 'rgba(139,92,246,.06)' : 'var(--bg)', borderRadius: 14, padding: '24px 16px', cursor: uploading ? 'wait' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transition: 'all .15s', boxSizing: 'border-box' }}>
            <div style={{ width: 44, height: 44, borderRadius: 11, background: uploaded ? '#8b5cf6' : 'var(--surface2)', color: uploaded ? '#fff' : 'var(--fg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {uploading ? <Loader size={22} style={{ animation: 'qspin 1s linear infinite' }} /> : uploaded ? <Check size={22} /> : <Upload size={22} />}
            </div>
            <span style={{ fontSize: 14, color: uploaded ? '#8b5cf6' : 'var(--fg)', fontWeight: uploaded ? 600 : 400 }}>
              {uploading ? (lang === 'ar' ? 'جارٍ الرفع…' : 'Uploading…') : uploaded ? uploaded : tr.pres.browse}
            </span>
            {!uploaded && !uploading && <span style={{ fontSize: 12, color: 'var(--fg3)' }}>{tr.pres.uploadHint}</span>}
          </div>
        </div>
      </div>

      <button onClick={() => router.push('/presentation/recording')}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', border: 'none', background: '#8b5cf6', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 16.5, padding: 17, borderRadius: 14, cursor: 'pointer', marginTop: 24, boxShadow: '0 12px 26px rgba(139,92,246,.3)', transition: 'transform .15s' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = ''}>
        {tr.pres.cta}
      </button>
    </section>
  );
}
