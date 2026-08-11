'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCcw, Loader2, AlertCircle, ChevronDown, Download } from 'lucide-react';
import { useApp, InterviewResults, QuestionMetrics, type PerQuestionDiagnosis, type AnswerDiagnosis, type DiagnosisDimension, type StarSubDiagnosis, type AnswerClassificationIssue } from '@/lib/context';
import { t } from '@/lib/i18n';
import { analyzePerformance, saveSession, getSession, SpeechSummary } from '@/lib/ai';

const ROLE_LABELS: Record<string, string> = {
  dev: 'Software Developer', pm: 'Project Manager', acc: 'Accountant',
  hr: 'HR Specialist', mkt: 'Marketing Specialist', cs: 'Customer Service',
};
const EDU_LABELS: Record<string, string> = {
  diploma: 'Diploma', bachelor: "Bachelor's", master: "Master's",
};
const EXP_LABELS: Record<string, string> = {
  fresh: 'Fresh Graduate', junior: 'Junior', mid: 'Mid-Level', senior: 'Senior',
};

// Aggregate per-question metrics into a single summary for the AI and for display
function aggregateSpeechMetrics(
  metrics: (QuestionMetrics | null)[],
  answeredIndices: number[]
): SpeechSummary | null {
  const valid = answeredIndices
    .map(i => metrics[i])
    .filter((m): m is QuestionMetrics => m != null && m.wpm > 0);

  if (valid.length === 0) return null;

  const avgWpm = Math.round(valid.reduce((s, m) => s + m.wpm, 0) / valid.length);
  const totalPauseCount = valid.reduce((s, m) => s + m.pauseCount, 0);
  const avgPauseDuration =
    totalPauseCount > 0
      ? parseFloat(
          (valid.reduce((s, m) => s + m.avgPauseDuration * m.pauseCount, 0) / totalPauseCount).toFixed(2)
        )
      : 0;
  const longestPauseDuration = parseFloat(
    Math.max(0, ...valid.map(m => m.longestPauseDuration)).toFixed(2)
  );

  // Merge filler counts across questions
  const fillerMap: Record<string, number> = {};
  for (const m of valid) {
    for (const f of m.fillerWords) {
      fillerMap[f.word] = (fillerMap[f.word] ?? 0) + f.count;
    }
  }
  const fillerWords = Object.entries(fillerMap)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);

  return { avgWpm, fillerWords, pauseCount: totalPauseCount, avgPauseDuration, longestPauseDuration };
}

function ScoreGauge({ score }: { score: number }) {
  const r = 70, C = 2 * Math.PI * r;
  const offset = (C * (1 - score / 100)).toFixed(1);
  const col = score >= 80 ? '#10b981' : score >= 60 ? 'var(--accent)' : '#f59e0b';
  return (
    <div style={{ position: 'relative', width: 170, height: 170 }}>
      <svg width="170" height="170" viewBox="0 0 170 170" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="85" cy="85" r={r} fill="none" stroke="var(--surface2)" strokeWidth="14" />
        <circle cx="85" cy="85" r={r} fill="none" stroke={col} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={C.toFixed(1)} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 38, fontWeight: 800, color: col }}>{score}</span>
        <span style={{ fontSize: 13, color: 'var(--fg3)', fontWeight: 600 }}>/100</span>
      </div>
    </div>
  );
}

function Bar({ label, value, max = 100, color = 'var(--accent)', tooltip }: {
  label: string; value: number; max?: number; color?: string; tooltip?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {label}
          {tooltip && (
            <span
              title={tooltip}
              style={{ marginLeft: 5, cursor: 'help', color: 'var(--fg3)', fontSize: 13 }}
            >ⓘ</span>
          )}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}<span style={{ fontSize: 12, color: 'var(--fg3)' }}>/{max}</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
        <div style={{ width: `${(value / max) * 100}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 1s ease' }} />
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  'Excellent': '#10b981',
  'Very Good': '#10b981',
  'Good': '#10b981',
  'Acceptable': '#0284c7',
  'Partially Complete': '#d97706',
  'Needs Improvement': '#d97706',
  'Weak': '#ea580c',
  'Missing': '#ea580c',
  'Off-topic': '#dc2626',
  'Incorrect': '#dc2626',
  'Incomplete': '#d97706',
  'Contradictory': '#dc2626',
  'Unclear': '#d97706',
  'Not Applicable': '#6b7280',
};

const SEVERITY_COLOR: Record<string, string> = {
  none: '#6b7280',
  low: '#10b981',
  medium: '#d97706',
  high: '#ea580c',
  critical: '#dc2626',
};

const SEVERITY_BG: Record<string, string> = {
  none: 'rgba(107,114,128,.1)',
  low: 'rgba(16,185,129,.1)',
  medium: 'rgba(217,119,6,.1)',
  high: 'rgba(234,88,12,.1)',
  critical: 'rgba(220,38,38,.1)',
};

const DIMENSION_LABELS_EN: Record<string, string> = {
  relevance: 'Relevance',
  accuracy: 'Accuracy',
  completeness: 'Completeness',
  logic_coherence: 'Logic & Coherence',
  specificity: 'Specificity',
  supporting_example: 'Supporting Example',
  star_structure: 'STAR Structure',
  communication_clarity: 'Communication Clarity',
};

const DIMENSION_LABELS_AR: Record<string, string> = {
  relevance: 'الصلة بالسؤال',
  accuracy: 'الدقة',
  completeness: 'الاكتمال',
  logic_coherence: 'المنطق والتماسك',
  specificity: 'التحديد',
  supporting_example: 'المثال الداعم',
  star_structure: 'منهج STAR',
  communication_clarity: 'وضوح التواصل',
};

const DIMENSION_ORDER = [
  'relevance', 'accuracy', 'completeness', 'logic_coherence',
  'specificity', 'supporting_example', 'star_structure', 'communication_clarity',
] as const;

const CLASSIFICATION_COLOR: Record<AnswerClassificationIssue, { bg: string; text: string; border: string; label: string; labelAr: string }> = {
  strong:            { bg: 'rgba(16,185,129,.12)',   text: '#059669', border: 'rgba(16,185,129,.35)',  label: 'Strong',       labelAr: 'ممتازة' },
  acceptable:        { bg: 'rgba(2,132,199,.12)',    text: '#0369a1', border: 'rgba(2,132,199,.35)',   label: 'Acceptable',   labelAr: 'مقبولة' },
  incomplete:        { bg: 'rgba(217,119,6,.12)',    text: '#b45309', border: 'rgba(217,119,6,.35)',   label: 'Incomplete',   labelAr: 'ناقصة' },
  vague:             { bg: 'rgba(217,119,6,.12)',    text: '#b45309', border: 'rgba(217,119,6,.35)',   label: 'Vague',        labelAr: 'مبهمة' },
  off_topic:         { bg: 'rgba(220,38,38,.12)',    text: '#b91c1c', border: 'rgba(220,38,38,.35)',   label: 'Off-topic',    labelAr: 'خارج الموضوع' },
  incorrect:         { bg: 'rgba(220,38,38,.12)',    text: '#b91c1c', border: 'rgba(220,38,38,.35)',   label: 'Incorrect',    labelAr: 'غير صحيحة' },
  contradictory:     { bg: 'rgba(220,38,38,.12)',    text: '#b91c1c', border: 'rgba(220,38,38,.35)',   label: 'Contradictory',labelAr: 'متناقضة' },
  nonsensical:       { bg: 'rgba(220,38,38,.12)',    text: '#b91c1c', border: 'rgba(220,38,38,.35)',   label: 'Nonsensical',  labelAr: 'غير مفهومة' },
  no_answer:         { bg: 'rgba(220,38,38,.12)',    text: '#b91c1c', border: 'rgba(220,38,38,.35)',   label: 'No Answer',    labelAr: 'لا توجد إجابة' },
  skipped:           { bg: 'rgba(107,114,128,.12)',  text: '#374151', border: 'rgba(107,114,128,.35)', label: 'Skipped',      labelAr: 'تم التخطي' },
  unsupported_claim: { bg: 'rgba(217,119,6,.12)',    text: '#b45309', border: 'rgba(217,119,6,.35)',   label: 'Unsupported',  labelAr: 'غير مدعومة' },
};

const STAR_PART_COLOR: Record<string, { dot: string; label: string; labelAr: string }> = {
  present:        { dot: '#10b981', label: 'Present',     labelAr: 'موجود' },
  partial:        { dot: '#d97706', label: 'Partial',     labelAr: 'جزئي' },
  missing:        { dot: '#dc2626', label: 'Missing',     labelAr: 'غائب' },
  not_applicable: { dot: '#9ca3af', label: 'N/A',         labelAr: 'لا ينطبق' },
};

// Severity rank — higher = worse — used to pick the most problematic instance per dimension
const STATUS_RANK: Record<string, number> = {
  'Excellent': 0, 'Very Good': 1, 'Good': 2, 'Acceptable': 3, 'Not Applicable': 3,
  'Partially Complete': 4, 'Needs Improvement': 4, 'Incomplete': 4, 'Unclear': 4,
  'Weak': 5, 'Missing': 6,
  'Off-topic': 7, 'Incorrect': 7, 'Contradictory': 7,
};
const STAR_RANK: Record<string, number> = {
  not_applicable: 0, present: 1, partial: 2, missing: 3,
};

interface DimSummary {
  status: string; severity: string;
  reason: string; evidence: string; how_to_improve: string;
  questionIndex: number;
}

interface StarAgg {
  applicable: boolean;
  situation: string; task: string; action: string; result: string;
  reason: string;
}

function buildAggDiag(items: PerQuestionDiagnosis[]): Record<string, DimSummary | null> {
  const result: Record<string, DimSummary | null> = {};
  for (const k of DIMENSION_ORDER) {
    if (k === 'star_structure') continue;
    let worst: DimSummary | null = null;
    let worstRank = -1;
    items.forEach((item, qi) => {
      const dim = item.diagnosis?.[k as keyof AnswerDiagnosis];
      if (!dim) return;
      const rank = STATUS_RANK[dim.status] ?? 3;
      if (rank > worstRank) {
        worstRank = rank;
        worst = { status: dim.status, severity: dim.severity ?? 'none', reason: dim.reason ?? '', evidence: dim.evidence ?? '', how_to_improve: dim.how_to_improve ?? '', questionIndex: qi };
      }
    });
    result[k] = worst;
  }
  return result;
}

function buildStarAgg(items: PerQuestionDiagnosis[]): StarAgg {
  const anyApplicable = items.some(item => {
    const s = item.diagnosis?.star_structure;
    return s && s.status !== 'Not Applicable';
  });
  if (!anyApplicable) {
    const reason = items.find(i => i.diagnosis?.star_structure?.reason)?.diagnosis?.star_structure?.reason ?? '';
    return { applicable: false, situation: 'not_applicable', task: 'not_applicable', action: 'not_applicable', result: 'not_applicable', reason };
  }
  const parts = ['situation', 'task', 'action', 'result'] as const;
  const worst: Record<string, string> = {};
  for (const p of parts) {
    let wr = -1; let wv = 'not_applicable';
    for (const item of items) {
      const sub = item.star_sub_diagnosis;
      if (!sub) continue;
      const val = sub[p] ?? 'not_applicable';
      const rank = STAR_RANK[val] ?? 0;
      if (rank > wr) { wr = rank; wv = val; }
    }
    worst[p] = wv;
  }
  return { applicable: true, situation: worst.situation, task: worst.task, action: worst.action, result: worst.result, reason: '' };
}

function StarSubDiagnosisPanel({ star, lang }: { star: StarSubDiagnosis; lang: string }) {
  const isAr = lang === 'ar';
  const parts: { key: keyof StarSubDiagnosis; labelEn: string; labelAr: string }[] = [
    { key: 'situation', labelEn: 'Situation', labelAr: 'الموقف' },
    { key: 'task',      labelEn: 'Task',      labelAr: 'المهمة' },
    { key: 'action',    labelEn: 'Action',    labelAr: 'الإجراء' },
    { key: 'result',    labelEn: 'Result',    labelAr: 'النتيجة' },
  ];
  const allNA = parts.every(p => star[p.key] === 'not_applicable');
  if (allNA) return null;

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg3)', marginBottom: 12 }}>
        {isAr ? 'تفاصيل منهج STAR' : 'STAR Breakdown'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        {parts.map(p => {
          const val = star[p.key];
          const col = STAR_PART_COLOR[val] ?? STAR_PART_COLOR.not_applicable;
          return (
            <div key={p.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '8px 4px', background: 'var(--surface)', borderRadius: 9, border: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--accent)' }}>{p.labelEn[0]}</span>
              <span style={{ fontSize: 11, color: 'var(--fg3)', fontWeight: 600 }}>{isAr ? p.labelAr : p.labelEn}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: col.dot }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: col.dot, flexShrink: 0, display: 'inline-block' }} />
                {isAr ? col.labelAr : col.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DiagnosisPanel({ diagnosis, lang }: { diagnosis: AnswerDiagnosis; lang: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const isAr = lang === 'ar';
  const labels = isAr ? DIMENSION_LABELS_AR : DIMENSION_LABELS_EN;

  const hasCritical = DIMENSION_ORDER.some(k => {
    const d = diagnosis[k as keyof AnswerDiagnosis];
    return d && (d.severity === 'critical' || d.severity === 'high');
  });

  return (
    <div style={{ background: hasCritical ? 'rgba(220,38,38,.04)' : 'rgba(107,114,128,.04)', border: `1px solid ${hasCritical ? 'rgba(220,38,38,.2)' : 'var(--border)'}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: hasCritical ? '#dc2626' : 'var(--fg3)' }}>
          {isAr ? 'تشخيص الإجابة' : 'Answer Diagnosis'}
        </span>
        {hasCritical && (
          <span style={{ fontSize: 11, background: 'rgba(220,38,38,.12)', color: '#dc2626', border: '1px solid rgba(220,38,38,.25)', borderRadius: 10, padding: '1px 8px', fontWeight: 700 }}>
            {isAr ? 'يحتاج مراجعة' : 'Needs Attention'}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {DIMENSION_ORDER.map((key, idx) => {
          const dim: DiagnosisDimension | undefined = diagnosis[key as keyof AnswerDiagnosis];
          if (!dim) return null;
          const isNa = dim.status === 'Not Applicable';
          const isOpen = expanded === key;
          const hasDetails = !isNa && (dim.reason || dim.evidence || dim.how_to_improve);
          const statusColor = STATUS_COLOR[dim.status] ?? '#6b7280';
          const sevColor = SEVERITY_COLOR[dim.severity] ?? '#6b7280';
          const sevBg = SEVERITY_BG[dim.severity] ?? 'rgba(107,114,128,.1)';

          return (
            <div key={key} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--border)' }}>
              <button
                onClick={() => hasDetails ? setExpanded(isOpen ? null : key) : undefined}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'none', border: 'none', cursor: hasDetails ? 'pointer' : 'default', fontFamily: 'inherit', textAlign: isAr ? 'right' : 'left' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: sevColor, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: isNa ? 'var(--fg3)' : 'var(--fg)' }}>
                  {labels[key]}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}35`, borderRadius: 10, padding: '2px 9px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {dim.status}
                </span>
                {dim.severity !== 'none' && !isNa && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: sevColor, background: sevBg, borderRadius: 8, padding: '2px 7px', whiteSpace: 'nowrap', flexShrink: 0, textTransform: 'uppercase' }}>
                    {dim.severity}
                  </span>
                )}
                {hasDetails && (
                  <ChevronDown size={14} style={{ color: 'var(--fg3)', transition: 'transform .15s', transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
                )}
              </button>

              {isOpen && hasDetails && (
                <div style={{ padding: '4px 16px 14px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dim.reason && (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--fg2)', lineHeight: 1.55 }}>{dim.reason}</p>
                  )}
                  {dim.evidence && (
                    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px', borderLeft: `3px solid ${statusColor}` }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg3)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 }}>
                        {isAr ? 'من الإجابة' : 'From answer'}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--fg)', fontStyle: 'italic' }}>"{dim.evidence}"</span>
                    </div>
                  )}
                  {dim.how_to_improve && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 14, color: '#10b981', flexShrink: 0 }}>→</span>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--fg2)', lineHeight: 1.55 }}>{dim.how_to_improve}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnswerDiagnosisSection({ items, lang }: { items: PerQuestionDiagnosis[]; lang: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const isAr = lang === 'ar';
  const labels = isAr ? DIMENSION_LABELS_AR : DIMENSION_LABELS_EN;
  const aggDiag = buildAggDiag(items);
  const starAgg = buildStarAgg(items);
  if (items.length === 0) return null;

  const critCount = DIMENSION_ORDER.filter(k => {
    if (k === 'star_structure') return false;
    const d = aggDiag[k];
    return d && (d.severity === 'critical' || d.severity === 'high');
  }).length;

  const nonStarDims = DIMENSION_ORDER.filter(k => k !== 'star_structure') as string[];
  const starKey = 'star_structure';

  const STAR_PARTS = [
    { key: 'situation' as const, en: 'Situation', ar: 'الموقف' },
    { key: 'task'      as const, en: 'Task',      ar: 'المهمة' },
    { key: 'action'    as const, en: 'Action',    ar: 'الإجراء' },
    { key: 'result'    as const, en: 'Result',    ar: 'النتيجة' },
  ];

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, boxShadow: 'var(--shadow)', marginBottom: 20, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{isAr ? 'تشخيص الإجابات' : 'Answer Diagnosis'}</h2>
          <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--fg3)' }}>
            {isAr
              ? 'تحليل مفصّل لكل بُعد — انقر لعرض الشرح والدليل وطريقة التحسين'
              : 'Click any dimension to see explanation, evidence, and how to improve'}
          </p>
        </div>
        {critCount > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(220,38,38,.1)', color: '#dc2626', border: '1px solid rgba(220,38,38,.25)', borderRadius: 20, padding: '4px 12px', whiteSpace: 'nowrap' }}>
            {critCount} {isAr ? 'بُعد يحتاج اهتماماً' : critCount === 1 ? 'dimension needs attention' : 'dimensions need attention'}
          </span>
        )}
      </div>

      {/* Non-STAR dimension rows */}
      {nonStarDims.map((key, idx) => {
        const summary = aggDiag[key] ?? null;
        const isOpen = expanded === key;
        const statusColor = summary ? (STATUS_COLOR[summary.status] ?? '#6b7280') : '#9ca3af';
        const sevColor = summary ? (SEVERITY_COLOR[summary.severity] ?? '#6b7280') : '#9ca3af';
        const isNa = summary?.status === 'Not Applicable';
        const hasDetails = !!summary && !isNa && !!(summary.reason || summary.evidence || summary.how_to_improve);

        return (
          <div key={key} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--border)' }}>
            <button
              onClick={() => hasDetails ? setExpanded(isOpen ? null : key) : undefined}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 20px', background: 'none', border: 'none', cursor: hasDetails ? 'pointer' : 'default', fontFamily: 'inherit', textAlign: isAr ? 'right' : 'left' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: summary && !isNa ? sevColor : '#9ca3af', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: isNa || !summary ? 'var(--fg3)' : 'var(--fg)' }}>{labels[key]}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}35`, borderRadius: 10, padding: '2px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {summary ? summary.status : (isAr ? 'غير متاح' : 'Not Available')}
              </span>
              {summary && !isNa && summary.severity && summary.severity !== 'none' && (
                <span style={{ fontSize: 10, fontWeight: 700, color: sevColor, background: `${sevColor}18`, borderRadius: 8, padding: '2px 7px', whiteSpace: 'nowrap', flexShrink: 0, textTransform: 'uppercase' as const }}>
                  {summary.severity}
                </span>
              )}
              {hasDetails && (
                <ChevronDown size={14} style={{ color: 'var(--fg3)', transition: 'transform .15s', transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
              )}
            </button>
            {isOpen && hasDetails && summary && (
              <div style={{ padding: '2px 20px 16px 36px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {summary.reason && (
                  <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fg2)', lineHeight: 1.6 }}>{summary.reason}</p>
                )}
                {summary.evidence && (
                  <div style={{ background: 'var(--surface2)', borderRadius: 9, padding: '9px 13px', borderLeft: `3px solid ${statusColor}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 4 }}>
                      {isAr ? 'من إجابتك' : 'Evidence'}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--fg)', fontStyle: 'italic' }}>"{summary.evidence}"</span>
                  </div>
                )}
                {summary.how_to_improve && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span style={{ color: '#10b981', flexShrink: 0, fontWeight: 800, fontSize: 14 }}>→</span>
                    <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fg2)', lineHeight: 1.6 }}>{summary.how_to_improve}</p>
                  </div>
                )}
                <span style={{ fontSize: 11, color: 'var(--fg3)', fontStyle: 'italic' }}>
                  {isAr ? `من السؤال ${summary.questionIndex + 1}` : `From Question ${summary.questionIndex + 1}`}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* STAR row */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        {starAgg.applicable ? (
          <>
            <button
              onClick={() => setExpanded(expanded === starKey ? null : starKey)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 20px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: isAr ? 'right' : 'left' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{isAr ? 'منهج STAR' : 'STAR Structure'}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#8b5cf6', background: 'rgba(139,92,246,.12)', border: '1px solid rgba(139,92,246,.3)', borderRadius: 10, padding: '2px 10px', flexShrink: 0 }}>
                S · T · A · R
              </span>
              <ChevronDown size={14} style={{ color: 'var(--fg3)', transition: 'transform .15s', transform: expanded === starKey ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
            </button>
            {expanded === starKey && (
              <div style={{ padding: '4px 20px 16px 36px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                  {STAR_PARTS.map(({ key: pk, en, ar }) => {
                    const val = starAgg[pk];
                    const col = STAR_PART_COLOR[val] ?? STAR_PART_COLOR.not_applicable;
                    return (
                      <div key={pk} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '10px 4px', background: 'var(--surface2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                        <span style={{ fontWeight: 800, fontSize: 16, color: '#8b5cf6' }}>{en[0]}</span>
                        <span style={{ fontSize: 11, color: 'var(--fg3)', fontWeight: 600 }}>{isAr ? ar : en}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: col.dot }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: col.dot, display: 'inline-block' }} />
                          {isAr ? col.labelAr : col.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9ca3af', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg3)', minWidth: 120 }}>{isAr ? 'منهج STAR' : 'STAR Structure'}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', background: 'rgba(156,163,175,.12)', border: '1px solid rgba(156,163,175,.3)', borderRadius: 10, padding: '2px 10px', flexShrink: 0 }}>
              {isAr ? 'لا ينطبق' : 'Not Applicable'}
            </span>
            {starAgg.reason && (
              <span style={{ fontSize: 12, color: 'var(--fg3)', width: '100%', paddingLeft: 18 }}>{starAgg.reason}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AccordionCard({
  index, question, userAnswer, idealAnswer, lang, contentOnly, diagnosisItem,
}: { index: number; question: string; userAnswer: string; idealAnswer: string; lang: string; contentOnly?: boolean; diagnosisItem?: PerQuestionDiagnosis }) {
  const [open, setOpen] = useState(false);
  const isAr = lang === 'ar';

  const classification = diagnosisItem?.answer_classification;
  const classStyle = classification ? CLASSIFICATION_COLOR[classification.primary_issue] : null;
  // Only show badge for non-trivial issues
  const showBadge = classStyle && classification?.primary_issue !== 'acceptable' && classification?.primary_issue !== 'strong';

  const showAnswer = idealAnswer || diagnosisItem?.improved_answer;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="accordion-toggle"
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '18px 22px', background: 'none', border: 'none', cursor: 'pointer', textAlign: isAr ? 'right' : 'left', fontFamily: 'inherit' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{index + 1}</div>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 15, color: 'var(--fg)', lineHeight: 1.4 }}>{question}</span>
        {showBadge && (
          <span style={{ fontSize: 11, fontWeight: 700, background: classStyle.bg, color: classStyle.text, border: `1px solid ${classStyle.border}`, padding: '2px 9px', borderRadius: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {isAr ? classStyle.labelAr : classStyle.label}
          </span>
        )}
        {contentOnly && (
          <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,.15)', color: '#d97706', border: '1px solid rgba(245,158,11,.3)', padding: '2px 8px', borderRadius: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {isAr ? 'محتوى فقط' : 'Content Only'}
          </span>
        )}
        <ChevronDown size={18} style={{ color: 'var(--fg3)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
      </button>

      <div className="accordion-body" style={{ padding: '0 22px 20px', display: open ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}>
        {contentOnly && (
          <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400e', lineHeight: 1.55 }}>
            {isAr
              ? 'تم تقييم محتوى هذه الإجابة فقط لأن لغة الإجابة لم تتطابق مع لغة المقابلة المحددة. درجات اللغة والتواصل لم تُحتسب لهذه الإجابة. النص الأصلي محفوظ دون ترجمة.'
              : 'This answer was evaluated for content only because the spoken language did not match the selected interview language. Language and communication scores were not applied to this answer. The original transcript is preserved without translation.'}
          </div>
        )}

        {/* Your Answer */}
        <div style={{ background: 'rgba(2,132,199,.07)', border: '1.5px solid rgba(2,132,199,.2)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
            {isAr ? 'إجابتك' : 'Your Answer'}
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>
            {userAnswer || (isAr ? '(لم تُقدَّم إجابة)' : '(no answer given)')}
          </p>
        </div>

        {/* Answer Diagnosis */}
        {diagnosisItem?.diagnosis && (
          <DiagnosisPanel diagnosis={diagnosisItem.diagnosis} lang={lang} />
        )}

        {/* STAR Sub-diagnosis */}
        {diagnosisItem?.star_sub_diagnosis && (
          <StarSubDiagnosisPanel star={diagnosisItem.star_sub_diagnosis} lang={lang} />
        )}

        {/* Coaching Section */}
        {(diagnosisItem?.what_interviewer_expected || diagnosisItem?.coach_feedback) && (
          <div style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#b45309', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#d97706' }} />
              {isAr ? 'إرشادات المحاور' : 'Interview Coach'}
            </div>
            {diagnosisItem.what_interviewer_expected && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg3)', marginBottom: 4 }}>
                  {isAr ? 'ما الذي كان المحاور يتوقعه؟' : 'What the interviewer expected'}
                </div>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--fg2)' }}>{diagnosisItem.what_interviewer_expected}</p>
              </div>
            )}
            {diagnosisItem.coach_feedback && (
              <div style={{ borderTop: diagnosisItem.what_interviewer_expected ? '1px solid rgba(245,158,11,.2)' : 'none', paddingTop: diagnosisItem.what_interviewer_expected ? 10 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg3)', marginBottom: 4 }}>
                  {isAr ? 'نصيحة التحسين' : 'Coaching tip'}
                </div>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--fg)' }}>{diagnosisItem.coach_feedback}</p>
              </div>
            )}
          </div>
        )}

        {/* Improved / Ideal Answer */}
        {showAnswer && (
          <div style={{ background: 'rgba(16,185,129,.07)', border: '1.5px solid rgba(16,185,129,.25)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: '#10b981', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
              {isAr ? 'مثال على إجابة قوية' : 'Strong Answer Example'}
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--fg)', whiteSpace: 'pre-wrap' }}>
              {diagnosisItem?.improved_answer || idealAnswer}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InterviewResultsPage() {
  const { lang, role, education, experience, intLang, questions, answers, answerMetrics,
    contentOnlyAnswers, interviewResults, setInterviewResults, resetInterview, interviewMode,
    setQuestions, setAnswer } = useApp();
  const tr = t(lang);
  const router = useRouter();
  const calledRef = useRef(false);
  const savedRef = useRef(false);
  const [loading, setLoading] = useState(!interviewResults);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState(false);

  // Pre-compute aggregated speech metrics once
  const answeredIndices = answers.map((a, i) => a ? i : -1).filter(i => i >= 0);
  const speechSummary = aggregateSpeechMetrics(answerMetrics, answeredIndices);

  // Load from DB when coming from history (session ID in URL, no live context state)
  useEffect(() => {
    if (interviewResults) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');
    if (!sessionId) return;
    setLoading(true);
    getSession(sessionId).then(row => {
      if (!row) { setLoading(false); return; }
      const reconstructed: InterviewResults = {
        overall_score: row.score_overall ?? 0,
        communication: row.score_communication ?? 0,
        confidence: row.score_confidence ?? 0,
        answer_quality: row.score_quality ?? 0,
        strengths: Array.isArray(row.strengths) ? row.strengths as string[] : [],
        improvements: Array.isArray(row.improvements) ? row.improvements as string[] : [],
        ai_feedback: row.ai_feedback ?? '',
        recommendations: Array.isArray(row.recommendations) ? row.recommendations as { title: string; description: string }[] : [],
        ideal_answers: Array.isArray(row.ideal_answers) ? row.ideal_answers as { question: string; ideal_answer: string }[] : undefined,
        per_question_diagnosis: Array.isArray(row.per_question_diagnosis) ? row.per_question_diagnosis as PerQuestionDiagnosis[] : undefined,
      };
      setInterviewResults(reconstructed);

      // Restore question strings and answers so the accordion section renders
      if (Array.isArray(row.questions)) {
        type QAPair = { question: string; answer: string };
        const pairs = row.questions as QAPair[];
        const qStrings = pairs.map(p => p.question);
        setQuestions(qStrings);
        pairs.forEach((p, i) => setAnswer(i, p.answer ?? ''));
      }

      setLoading(false);
    }).catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // If loading from history via DB, let the DB-load effect handle it
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('session')) return;
    }
    if (interviewResults || calledRef.current) { setLoading(false); return; }
    calledRef.current = true;

    const qaPairs = questions.length === 5
      ? questions.map((q, i) => ({ question: q, answer: answers[i] || '(no answer provided)' }))
      : answers.filter(Boolean).map((a, i) => ({ question: `Question ${i + 1}`, answer: a }));

    if (qaPairs.length === 0) {
      setError(lang === 'ar' ? 'لا توجد إجابات لتحليلها.' : 'No answers to analyze.');
      setLoading(false); return;
    }

    analyzePerformance<InterviewResults>({
      mode: 'interview',
      lang: intLang,
      role: ROLE_LABELS[role] ?? role,
      education: education,
      experience: experience,
      questions: qaPairs,
      speechMetrics: speechSummary ?? {
        avgWpm: 0,
        fillerWords: [],
        pauseCount: 0,
        avgPauseDuration: 0,
        longestPauseDuration: 0,
      },
      contentOnlyMask: contentOnlyAnswers.some(Boolean) ? contentOnlyAnswers : undefined,
    })
      .then(res => { setInterviewResults(res); setLoading(false); })
      .catch(err => {
        console.error('Analyze error:', err);
        setError(lang === 'ar'
          ? 'تعذّر تحليل الأداء. يُرجى المحاولة مجددًا.'
          : 'Could not analyze performance. Please try again.');
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save to DB once results are available
  useEffect(() => {
    if (!interviewResults || savedRef.current) return;
    savedRef.current = true;

    const qaPairs = questions.map((q, i) => ({ question: q, answer: answers[i] || '' }));

    saveSession({
      mode: 'interview',
      lang: intLang,
      role: ROLE_LABELS[role] ?? role,
      education: education,
      experience: experience,
      questions: qaPairs,
      answers: answers,
      score_overall: interviewResults.overall_score,
      score_communication: interviewResults.communication,
      score_confidence: interviewResults.confidence,
      score_quality: interviewResults.answer_quality,
      // Store real code-computed values in DB
      pace_wpm: speechSummary?.avgWpm ?? undefined,
      filler_words: speechSummary?.fillerWords ?? [],
      long_pauses: speechSummary?.pauseCount ?? undefined,
      ai_feedback: interviewResults.ai_feedback,
      strengths: interviewResults.strengths,
      improvements: interviewResults.improvements,
      recommendations: interviewResults.recommendations,
      ideal_answers: interviewResults.ideal_answers,
      per_question_diagnosis: interviewResults.per_question_diagnosis,
    })
      .then(id => { if (id === null) setSaveError(true); })
      .catch(() => setSaveError(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewResults]);

  if (loading) {
    return (
      <section style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={32} style={{ color: 'var(--accent)', animation: 'qspin 1s linear infinite' }} />
        </div>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>
          {lang === 'ar' ? 'جارٍ تحليل أدائك…' : 'Analyzing your performance…'}
        </h2>
        <p style={{ margin: 0, color: 'var(--fg2)', textAlign: 'center', maxWidth: '28em' }}>
          {lang === 'ar' ? 'يراجع الذكاء الاصطناعي إجاباتك ويحضّر تقريرًا مفصّلًا.' : 'AI is reviewing your answers and preparing a detailed report.'}
        </p>
        <p style={{ margin: 0, color: 'var(--fg3)', textAlign: 'center', maxWidth: '28em', fontSize: 13, padding: '10px 16px', background: 'var(--surface2)', borderRadius: 10 }}>
          {lang === 'ar'
            ? '⏳ قد يستغرق هذا ما يصل إلى دقيقة واحدة. يرجى البقاء في هذه الصفحة.'
            : '⏳ This may take up to 1 minute. Please stay on this page.'}
        </p>
      </section>
    );
  }

  if (error || !interviewResults) {
    return (
      <section style={{ minHeight: 'calc(100vh - 65px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
        <AlertCircle size={48} style={{ color: '#f59e0b' }} />
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 22 }}>{lang === 'ar' ? 'خطأ في التحليل' : 'Analysis Error'}</h2>
        <p style={{ color: 'var(--fg2)', textAlign: 'center', maxWidth: '28em' }}>{error}</p>
        <button onClick={() => router.push('/interview/session')} style={{ border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, padding: '12px 24px', borderRadius: 12, cursor: 'pointer' }}>
          {lang === 'ar' ? 'العودة للجلسة' : 'Back to Session'}
        </button>
      </section>
    );
  }

  const r2 = interviewResults;
  const isAr = lang === 'ar';

  const confidenceTooltip = isAr
    ? 'تقدير مبني على: وتيرة الكلام، كثافة كلمات الحشو، تكرار التوقفات، واكتمال الإجابات. ليس قياسًا نفسيًا أو صوتيًا مباشرًا.'
    : 'Estimated from: speaking pace, filler word density, pause frequency, and answer completeness. Not a direct acoustic or psychological measurement.';

  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(20px,3.5vw,44px) clamp(16px,4vw,40px)' }}>
      <style>{`
        @media print {
          nav, header, .no-print { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
          section { max-width: 100% !important; padding: 16px !important; }
          * { box-shadow: none !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .accordion-toggle { pointer-events: none; }
          .accordion-toggle svg:last-child { display: none; }
          .accordion-body { display: flex !important; }
        }
      `}</style>
      {saveError && (
        <div style={{ marginBottom: 16, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.4)', borderRadius: 12, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, color: '#92400e' }}>
            {isAr ? '⚠️ تعذّر حفظ الجلسة. لن تظهر في السجل.' : '⚠️ Could not save this session. It will not appear in your history.'}
          </span>
          <button onClick={() => setSaveError(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: '#92400e', padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}
      {/* Hero */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 24, padding: 'clamp(24px,4vw,48px)', boxShadow: 'var(--shadow)', marginBottom: 24, display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap' }}>
        <ScoreGauge score={r2.overall_score} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: 'var(--accent)', textTransform: 'uppercase' }}>
              {isAr ? 'نتيجة المقابلة' : 'Interview Score'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--surface2)', color: 'var(--fg3)', border: '1px solid var(--border)', padding: '2px 10px', borderRadius: 20 }}>
              {tr.session.interviewModeLabel}:{' '}
              {interviewMode === 'real' ? tr.session.realModeLabel : tr.session.assistedModeLabel}
            </span>
            {contentOnlyAnswers.some(Boolean) && (
              <span
                title={isAr
                  ? `${contentOnlyAnswers.filter(Boolean).length} من إجاباتك قُيِّمت من حيث المحتوى فقط (اختلاف اللغة — تم تخطي درجات اللغة والتواصل)`
                  : `${contentOnlyAnswers.filter(Boolean).length} answer(s) evaluated for content only (language mismatch — language & communication scores skipped)`}
                style={{ fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,.15)', color: '#d97706', border: '1px solid rgba(245,158,11,.35)', padding: '2px 10px', borderRadius: 20, cursor: 'help' }}>
                {isAr ? 'تقييم محتوى فقط ⓘ' : 'Content Only Evaluation ⓘ'}
              </span>
            )}
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, letterSpacing: '-.02em' }}>
            {isAr ? 'تقرير الأداء' : 'Performance Report'}
          </h1>
          <p style={{ margin: '0 0 20px', color: 'var(--fg2)', fontSize: 15 }}>
            {r2.overall_score >= 80
              ? (isAr ? 'أداء ممتاز! أنت مستعد للمقابلة.' : 'Excellent performance! You\'re interview-ready.')
              : r2.overall_score >= 60
              ? (isAr ? 'أداء جيد مع مجال للتحسين.' : 'Good performance with room to improve.')
              : (isAr ? 'يحتاج الأمر إلى مزيد من التدريب.' : 'More practice will sharpen your skills.')}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => { resetInterview(); router.push('/interview/setup'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 11, cursor: 'pointer' }} className="no-print">
              <RotateCcw size={16} />{isAr ? 'محاولة جديدة' : 'Try Again'}
            </button>
            <button onClick={() => router.push('/modes')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 11, cursor: 'pointer' }} className="no-print">
              {isAr ? 'اختر وضعًا آخر' : 'Try Another Mode'}<ArrowRight size={16} />
            </button>
            <button
              onClick={() => {
                const prev = document.title;
                document.title = isAr ? 'تقرير الأداء - قضاء' : 'Performance Report - Qadha';
                window.print();
                document.title = prev;
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--fg)', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, padding: '10px 18px', borderRadius: 11, cursor: 'pointer' }}
              className="no-print">
              <Download size={16} />{isAr ? 'تنزيل PDF' : 'Download PDF'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, marginBottom: 20 }}>
        {/* Sub-scores */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{isAr ? 'تفاصيل الأداء' : 'Performance Breakdown'}</h2>
          <Bar label={isAr ? 'التواصل' : 'Communication'} value={r2.communication} color="var(--accent)" />
          <Bar
            label={isAr ? 'تقدير الثقة في الإلقاء' : 'Delivery Confidence Estimate'}
            value={r2.confidence}
            color="#8b5cf6"
            tooltip={confidenceTooltip}
          />
          <Bar label={isAr ? 'جودة الإجابة' : 'Answer Quality'} value={r2.answer_quality} color="#10b981" />

          {/* Real speech metrics from recordings */}
          <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{isAr ? 'وتيرة الكلام' : 'Speaking Pace'}</span>
              {speechSummary && speechSummary.avgWpm > 0
                ? <span style={{ fontWeight: 700, fontSize: 18 }}>{speechSummary.avgWpm} <span style={{ fontSize: 12, color: 'var(--fg3)', fontWeight: 500 }}>WPM</span></span>
                : <span style={{ fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>{isAr ? 'غير متاح' : 'Not available'}</span>
              }
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{isAr ? 'توقفات طويلة (>٢ ث)' : 'Long Pauses (>2 s)'}</span>
              {speechSummary
                ? <span style={{ fontWeight: 700, fontSize: 18 }}>{speechSummary.pauseCount}</span>
                : <span style={{ fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>{isAr ? 'غير متاح' : 'Not available'}</span>
              }
            </div>
            {speechSummary && speechSummary.pauseCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--fg3)' }}>{isAr ? 'أطول توقف' : 'Longest pause'}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg2)' }}>{speechSummary.longestPauseDuration.toFixed(1)} s</span>
              </div>
            )}
          </div>
        </div>

        {/* Filler words — from real transcript analysis */}
        {speechSummary && speechSummary.fillerWords.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
            <h2 style={{ margin: '0 0 18px', fontSize: 17, fontWeight: 700 }}>{isAr ? 'كلمات الحشو' : 'Filler Words'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {speechSummary.fillerWords.map((f, i) => {
                const max = speechSummary.fillerWords[0].count || 1;
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, fontStyle: 'italic' }}>"{f.word}"</span>
                      <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{f.count}×</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 3, background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ width: `${(f.count / max) * 100}%`, height: '100%', background: '#f59e0b', borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {r2.per_question_diagnosis && r2.per_question_diagnosis.length > 0 && (
        <AnswerDiagnosisSection items={r2.per_question_diagnosis} lang={lang} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, marginBottom: 20 }}>
        {r2.strengths?.length > 0 && (() => {
          const noStrengths = r2.strengths.length === 1 && (
            r2.strengths[0].includes('No clear strengths') ||
            r2.strengths[0].includes('لم تتضح نقاط قوة')
          );
          return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>{isAr ? 'نقاط القوة' : 'Strengths'}</h2>
              {noStrengths ? (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--fg3)', fontStyle: 'italic' }}>{r2.strengths[0]}</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {r2.strengths.map((s, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 15, color: '#10b981', flexShrink: 0 }}>✓</span>
                      <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })()}

        {r2.improvements?.length > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: 'var(--shadow)' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 700 }}>{isAr ? 'مجالات التحسين' : 'Areas to Improve'}</h2>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {r2.improvements.map((s, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 15, color: '#f59e0b', flexShrink: 0 }}>→</span>
                  <span style={{ fontSize: 14, color: 'var(--fg2)' }}>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {r2.ai_feedback && (
        <div style={{ background: 'var(--accent-soft)', border: '1px solid rgba(2,132,199,.2)', borderRadius: 20, padding: 28, marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 19 }}>✦</div>
            <div>
              <h2 style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 700, color: 'var(--accent)' }}>{isAr ? 'تغذية راجعة من الذكاء الاصطناعي' : 'AI Feedback'}</h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: 'var(--fg)' }}>{r2.ai_feedback}</p>
            </div>
          </div>
        </div>
      )}

      {r2.recommendations?.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 19, fontWeight: 700 }}>{isAr ? 'توصيات للتطوير' : 'Recommendations'}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 16 }}>
            {r2.recommendations.map((rec, i) => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 22px', boxShadow: 'var(--shadow)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, marginBottom: 12 }}>{i + 1}</div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700 }}>{rec.title}</h3>
                <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 13.5, lineHeight: 1.55 }}>{rec.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {questions.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
                {isAr ? 'أسئلة المقابلة والإجابات المثالية' : 'Interview Questions & Ideal Answers'}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--fg3)' }}>
                {isAr
                  ? 'انقر على كل سؤال لمقارنة إجابتك بالإجابة المثالية'
                  : 'Click each question to compare your answer with the ideal response'}
              </p>
            </div>
            <div style={{ background: 'rgba(16,185,129,.12)', color: '#10b981', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, whiteSpace: 'nowrap' }}>
              {isAr ? 'بمنهج STAR' : 'STAR Method'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {questions.map((q, i) => (
              <AccordionCard
                key={i}
                index={i}
                question={q}
                userAnswer={answers[i] || ''}
                idealAnswer={
                  r2.ideal_answers?.find(ia => ia.question === q)?.ideal_answer
                  ?? r2.ideal_answers?.[i]?.ideal_answer
                  ?? ''
                }
                lang={lang}
                contentOnly={contentOnlyAnswers[i]}
                diagnosisItem={
                  r2.per_question_diagnosis?.find(d => d.question === q)
                  ?? r2.per_question_diagnosis?.[i]
                }
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
