import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const MODEL = 'anthropic/claude-haiku-4-5';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const ALLOWED_ORIGINS = [
  'https://qadha-gules.vercel.app',
  'http://localhost:3000',
];

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateCounts.get(key);
  if (!entry || now > entry.resetAt) {
    rateCounts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

async function extractUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ── Programmatic consistency enforcement ────────────────────────────────────

function enforceConsistency(parsed: Record<string, unknown>, mode: string): void {
  if (mode !== 'interview') return;

  const diag = parsed.per_question_diagnosis;
  if (!Array.isArray(diag) || diag.length === 0) return;

  // ── 1. Per-question score ceilings ──────────────────────────────────────
  let totalCeiling = 0;
  for (const item of diag) {
    const rec = item as Record<string, unknown>;
    const d = rec?.diagnosis as Record<string, Record<string, string>> | undefined;
    if (!d) { totalCeiling += 100; continue; }

    let ceiling = 100;
    if (d.relevance?.status === 'Off-topic') ceiling = Math.min(ceiling, 15);
    if (d.accuracy?.status === 'Incorrect') ceiling = Math.min(ceiling, 30);
    if (d.logic_coherence?.status === 'Contradictory') ceiling = Math.min(ceiling, 25);
    if (d.completeness?.status === 'Missing') ceiling = Math.min(ceiling, 10);
    if ((d.completeness?.status === 'Incomplete' || d.completeness?.status === 'Partially Complete') && d.completeness?.severity === 'high') ceiling = Math.min(ceiling, 45);
    if (d.specificity?.status === 'Weak' && d.supporting_example?.status === 'Weak') ceiling = Math.min(ceiling, 55);
    totalCeiling += ceiling;
  }
  const avgCeiling = Math.round(totalCeiling / diag.length);
  if (typeof parsed.answer_quality === 'number') {
    parsed.answer_quality = Math.min(parsed.answer_quality, avgCeiling);
  }

  // ── 2. Strengths validation against diagnosis ────────────────────────────
  const strengths = parsed.strengths;
  if (!Array.isArray(strengths)) return;

  // Collect flags from all questions
  let anyOffTopic = false;
  let anyIncorrect = false;
  let anyStarMissing = false;
  const answerQuality = typeof parsed.answer_quality === 'number' ? parsed.answer_quality : 100;

  for (const item of diag) {
    const d = (item as Record<string, unknown>)?.diagnosis as Record<string, Record<string, string>> | undefined;
    if (!d) continue;
    if (d.relevance?.status === 'Off-topic') anyOffTopic = true;
    if (d.accuracy?.status === 'Incorrect') anyIncorrect = true;
    if (d.star_structure?.status === 'Missing' || d.star_structure?.status === 'Weak') anyStarMissing = true;
  }

  // Keyword patterns that contradict known issues
  const forbiddenIfOffTopic = /answered.{0,20}question|addressed.{0,20}question|relevant|on.?topic|clear.{0,15}answer/i;
  const forbiddenIfIncorrect = /technical.{0,20}knowl|accurate|correct.{0,20}knowl|strong.{0,20}know/i;
  const forbiddenIfStarMissing = /star.{0,10}struct|structured.{0,10}respon|well.?struct/i;
  const forbiddenIfLowScore = /excellent.{0,15}comm|great.{0,15}comm|strong.{0,15}comm/i;

  const validated = (strengths as unknown[]).filter((s) => {
    if (typeof s !== 'string') return false;
    if (anyOffTopic && forbiddenIfOffTopic.test(s)) return false;
    if (anyIncorrect && forbiddenIfIncorrect.test(s)) return false;
    if (anyStarMissing && forbiddenIfStarMissing.test(s)) return false;
    if (answerQuality < 40 && forbiddenIfLowScore.test(s)) return false;
    return true;
  });

  parsed.strengths = validated.length > 0
    ? validated
    : ['No clear strengths could be identified from the answers provided.'];
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const origin = req.headers.get('origin') ?? '';
  if (req.method !== 'OPTIONS' && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const userId = await extractUserId(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!checkRateLimit(userId)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. You can analyze up to 5 sessions per hour.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' } }
      );
    }

    const body = await req.json();

    const VALID_MODE = ['interview', 'presentation'];
    const VALID_LANG = ['en', 'ar'];
    const VALID_EDUCATION = ['high_school', 'bachelor', 'master', 'phd', 'other'];
    const VALID_EXPERIENCE = ['intern', 'junior', 'mid', 'senior', 'lead', 'other'];

    const mode = VALID_MODE.includes(body.mode) ? body.mode : '';
    const lang = VALID_LANG.includes(body.lang) ? body.lang : '';

    if (!mode || !lang) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sanitize = (s: unknown, maxLen = 500) =>
      typeof s === 'string' ? s.trim().slice(0, maxLen).replace(/[`\\]/g, '') : '';

    interface FillerEntry { word: string; count: number }
    interface SpeechMetricsRaw {
      avgWpm?: number; wpm?: number;
      fillerWords?: FillerEntry[];
      pauseCount?: number; avgPauseDuration?: number;
      longestPauseDuration?: number; durationSeconds?: number;
    }
    const sm: SpeechMetricsRaw = (body.speechMetrics && typeof body.speechMetrics === 'object')
      ? body.speechMetrics as SpeechMetricsRaw : {};

    const avgWpm: number | null = typeof sm.avgWpm === 'number' ? Math.round(sm.avgWpm)
      : typeof sm.wpm === 'number' ? Math.round(sm.wpm) : null;
    const pauseCount: number | null = typeof sm.pauseCount === 'number' ? sm.pauseCount : null;
    const avgPauseDuration: number | null = typeof sm.avgPauseDuration === 'number' ? sm.avgPauseDuration : null;
    const longestPauseDuration: number | null = typeof sm.longestPauseDuration === 'number' ? sm.longestPauseDuration : null;
    const fillerWords: FillerEntry[] = Array.isArray(sm.fillerWords) ? sm.fillerWords as FillerEntry[] : [];

    const wpmLine = avgWpm !== null
      ? `- Speaking pace: ${avgWpm} WPM (ideal interview range: 120–150 WPM)`
      : '- Speaking pace: not available';
    const pauseLine = pauseCount !== null
      ? `- Long pauses (>2 s): ${pauseCount}${pauseCount > 0 && avgPauseDuration !== null ? `, avg ${avgPauseDuration.toFixed(1)} s, longest ${(longestPauseDuration ?? 0).toFixed(1)} s` : ''}`
      : '- Long pauses: not available';
    const fillerLine = fillerWords.length > 0
      ? `- Filler words detected: ${fillerWords.map((f: FillerEntry) => `"${f.word}" ×${f.count}`).join(', ')}`
      : '- Filler words: none detected';

    const speechMetricsBlock = `MEASURED SPEECH DATA (from actual audio — do NOT re-estimate):
${wpmLine}
${pauseLine}
${fillerLine}`;

    const isArabic = lang === 'ar';
    let systemPrompt: string;
    let userPrompt: string;

    if (mode === 'interview') {
      const role = sanitize(body.role, 60);
      const education = VALID_EDUCATION.includes(body.education) ? body.education : 'unspecified';
      const experience = VALID_EXPERIENCE.includes(body.experience) ? body.experience : 'unspecified';
      const questions = Array.isArray(body.questions)
        ? body.questions.slice(0, 5).map((q: unknown) => {
            const item = q as Record<string, unknown>;
            return { question: sanitize(item.question, 300), answer: sanitize(item.answer, 2000) };
          })
        : [];

      const contentOnlyMask: boolean[] = Array.isArray(body.contentOnlyMask)
        ? body.contentOnlyMask.slice(0, 5).map((v: unknown) => v === true)
        : Array(questions.length).fill(false);
      const hasContentOnly = contentOnlyMask.some(Boolean);

      systemPrompt = `You are a strict, realistic interview performance analyst — like a senior hiring manager who has seen thousands of interviews. Evaluate ACTUAL answer quality only.

SCORE RANGES — use these consistently for every answer and overall score:
  Excellent:           90–100  (comprehensive, specific, STAR if behavioural, professional)
  Very Good:           80–89   (strong with minor gaps)
  Good:                70–79   (clear, relevant, some depth)
  Acceptable:          55–69   (addresses question, but lacks detail or examples)
  Partially Complete:  40–54   (core idea present, important aspects missing)
  Weak:                20–39   (very vague, wrong direction, or barely relevant)
  Very Weak:            5–19   (almost no usable content)
  No Answer:            0–5    (empty, skip, "I don't know", nonsensical)

DIMENSION WEIGHTS for computing answer_quality (must sum to 100%):
  Relevance:           20%
  Accuracy:            20%
  Completeness:        15%
  Logic & Coherence:   15%
  Specificity:         10%
  Supporting Example:  10%
  Communication:        5%
  STAR Structure:       5%  (behavioural questions only)
  → If STAR = "Not Applicable": redistribute its 5% proportionally across the other 7 dimensions.
  → Compute a weighted score per dimension using the ranges above, then average for answer_quality.
  → overall_score = weighted average of all per-question answer_quality scores.

GLOBAL RULES:
1. answer_quality must match the dimension weights — do NOT estimate it independently.
2. confidence (0–100): use MEASURED SPEECH DATA only. Never invent.
3. ai_feedback: direct coaching. Name specific weaknesses. No "great effort" for poor answers.
4. Return valid JSON only.

COMPLETENESS — distinguish clearly (common errors to avoid):
  "Complete":           All expected aspects covered → Excellent or Good
  "Partially Complete": Core idea present but key detail, example, or step missing → 40–54 range
  "Needs Improvement":  Thin coverage, main aspects touched but shallow → 35–50
  "Incomplete":         Major aspects absent, answer very thin or fragmented → 20–39
  "Missing":            No relevant content at all → 0–10
  RULE: "I would use analytics to improve customer retention." = Partially Complete, NOT Incomplete.
  The idea is present. What is missing is the HOW (tools, steps, metrics). Score accordingly.

DIMENSION CALIBRATION:
  Relevance:
    Off-topic:          0–15 (heavy overall penalty, applies score ceiling 15)
    Partially Relevant: 35–54 (some credit)
    Relevant:           55–100 (no penalty)

  Accuracy:
    Correct:            65–100
    Minor error:        reduce Accuracy by 10–20 points, leave other dimensions unaffected
    Fundamentally wrong: "Incorrect" status, score ceiling 30

  Logic & Coherence:
    Clear reasoning:    Good–Excellent
    Weak reasoning:     Needs Improvement (35–50)
    Contradictory:      ceiling 25
    Nonsensical:        ceiling 15

  Specificity:
    Concrete (named tools, numbers, events, steps): 70–100
    Generic claims only: 25–45

  Supporting Example:
    Strong real example:      Excellent (85–100)
    Hypothetical example:     Acceptable (55–65)
    Weak or partial example:  Needs Improvement (35–50)
    No example:               Weak (20–35)

  Communication:
    Evaluates ONLY: clarity, sentence flow, organisation, professional wording.
    NEVER evaluates technical correctness.
    A technically wrong answer CAN score Good or Excellent on communication.

  STAR Structure:
    Applies ONLY to behavioural questions ("tell me about a time...", "describe a situation...").
    Knowledge/factual/technical/definition questions → always "Not Applicable", zero penalty.

ANSWER CLASSIFICATION (primary_issue values):
"off_topic"|"incorrect"|"incomplete"|"vague"|"contradictory"|"nonsensical"|"no_answer"|"skipped"|"acceptable"|"strong"

ANSWER DIAGNOSIS (8 dimensions):
  - relevance:           Does it address the question?
  - accuracy:            Factually/technically correct for the role?
  - completeness:        Covers all expected aspects?
  - logic_coherence:     Internally consistent and logical?
  - specificity:         Concrete details, numbers, named examples?
  - supporting_example:  Real example from candidate's experience?
  - star_structure:      STAR framework? (behavioural only, otherwise Not Applicable)
  - communication_clarity: Clarity, flow, organisation, professional wording only.

Valid statuses: "Excellent"|"Very Good"|"Good"|"Acceptable"|"Partially Complete"|"Needs Improvement"|"Weak"|"Off-topic"|"Incorrect"|"Incomplete"|"Contradictory"|"Unclear"|"Not Applicable"|"Missing"
Valid severities: "none"|"low"|"medium"|"high"|"critical"

Diagnosis field rules:
  - evidence: brief quote or paraphrase. Empty string if not applicable.
  - reason: 1 sentence. Honest, evidence-based.
  - how_to_improve: 1 sentence. Empty only for "Excellent" or "Not Applicable".
  - Never accuse of lying. Use "Questionable credibility" for suspicious claims.

STAR SUB-DIAGNOSIS (star_sub_diagnosis):
  - Include only when star_structure IS applicable.
  - If not applicable: all 4 parts = "not_applicable".
  - Valid per part: "present"|"partial"|"missing"|"not_applicable"

SCORE CEILING RULES (also enforced server-side — your scores must respect these):
  - relevance = "Off-topic"                              → ceiling 15
  - accuracy = "Incorrect"                               → ceiling 30
  - logic_coherence = "Contradictory"                    → ceiling 25
  - completeness = "Missing"                             → ceiling 10
  - completeness = "Incomplete" + severity high          → ceiling 45
  - specificity = "Weak" AND supporting_example = "Weak" → ceiling 55

EMPTY / INVALID ANSWER HANDLING:
  - Empty/silence/skip/fillers only → primary_issue="no_answer"; completeness="Missing" (critical); all others="Not Applicable"; score 0–5.
  - "I don't know" → primary_issue="no_answer"; supportive coach_feedback; improved_answer gives direction.
  - Nonsensical/random → primary_issue="nonsensical"; relevance="Off-topic" (critical).

STRENGTHS — STRICT EVIDENCE RULES:
  - ONLY list a strength directly supported by actual words the candidate said.
  - FORBIDDEN contradictions:
    * accuracy="Incorrect" → NEVER claim "technical knowledge" or "accurate understanding"
    * relevance="Off-topic" → NEVER claim "answered the question clearly"
    * star_structure="Missing"/"Weak" → NEVER claim "STAR structure" or "well-structured"
    * answer_quality<40 → NEVER claim "excellent communication" or "great delivery"
  - Delivery strengths (pace, pronunciation) valid ONLY if speech data confirms them.
  - If no genuine strength: ["No clear strengths could be identified from the answers provided."]

COACHING FIELDS (KEEP SHORT to fit token budget):
  - what_interviewer_expected: 1 sentence only.
  - coach_feedback: 2 sentences — what went wrong and how to fix it.
  - improved_answer: 2–3 sentences. Role/level-appropriate model answer. Address the ACTUAL question.

SELF-CHECK (run internally before returning the final JSON):
  1. Does every dimension status map to the correct score range above?
  2. Does answer_quality match the weighted dimension scores?
  3. If majority of dimensions are Acceptable or better → overall_score must be ≥ 50.
  4. If only ONE dimension is Weak → overall_score must NOT drop below 35.
  5. If 3+ critical dimensions fail → overall_score must be ≤ 30.
  6. If relevance="Off-topic" → no content strengths; improved_answer addresses the actual question.
  7. If accuracy="Incorrect" → feedback names the specific error; improved_answer corrects it.
  8. Would a human interviewer assign a similar score? If not, adjust before returning.`;

      const diagExample = `{"relevance":{"status":"Off-topic","severity":"critical","reason":"The answer discusses personal hobbies instead of the accounting concept asked.","evidence":"I like football and travelling.","how_to_improve":"Start with a direct definition of what was asked."},"accuracy":{"status":"Not Applicable","severity":"none","reason":"Cannot assess — answer is entirely off-topic.","evidence":"","how_to_improve":""},"completeness":{"status":"Missing","severity":"critical","reason":"No relevant content was provided.","evidence":"","how_to_improve":"Cover the definition, comparison, and an example."},"logic_coherence":{"status":"Acceptable","severity":"low","reason":"The sentence is grammatically coherent, just unrelated.","evidence":"","how_to_improve":""},"specificity":{"status":"Not Applicable","severity":"none","reason":"No relevant content to assess.","evidence":"","how_to_improve":""},"supporting_example":{"status":"Not Applicable","severity":"none","reason":"No relevant content.","evidence":"","how_to_improve":""},"star_structure":{"status":"Not Applicable","severity":"none","reason":"Not a behavioral question.","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"The response is grammatically clear.","evidence":"","how_to_improve":""}}`;

      userPrompt = isArabic
        ? `قيّم أداء هذا المرشح لوظيفة ${role} (تعليم: ${education}، خبرة: ${experience}).

${speechMetricsBlock}
${hasContentOnly ? '\nملاحظة: إجابات محددة بـ [محتوى فقط] قُدِّمت بلغة مختلفة. قيّم المحتوى والأفكار فقط — تجاهل اللغة والتواصل اللفظي لها.\n' : ''}
الإجابات الفعلية:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. السؤال: ${q.question}\nالإجابة: "${q.answer || '(لم تُقدَّم إجابة)'}"${contentOnlyMask[i] ? ' [محتوى فقط]' : ''}`).join('\n\n')}

أعد JSON فقط. هيكل كل سؤال في per_question_diagnosis:
{"question":"...","answer_classification":{"primary_issue":"off_topic|incorrect|incomplete|vague|no_answer|acceptable|strong","secondary_issues":[]},"diagnosis":{...8 dimensions...},"star_sub_diagnosis":{"situation":"present|partial|missing|not_applicable","task":"...","action":"...","result":"..."},"what_interviewer_expected":"جملة واحدة.","coach_feedback":"جملتان فقط.","improved_answer":"جملتان أو ثلاث."}

{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"strengths":["نقطة قوة حقيقية"],"improvements":["تحسين 1","تحسين 2","تحسين 3"],"ai_feedback":"تغذية راجعة صادقة.","recommendations":[{"title":"توصية 1","description":"نصيحة 1"},{"title":"توصية 2","description":"نصيحة 2"},{"title":"توصية 3","description":"نصيحة 3"}],"per_question_diagnosis":[{"question":"السؤال الفعلي 1","answer_classification":{"primary_issue":"off_topic","secondary_issues":[]},"diagnosis":${diagExample},"star_sub_diagnosis":{"situation":"not_applicable","task":"not_applicable","action":"not_applicable","result":"not_applicable"},"what_interviewer_expected":"تعريف الأصول والخصوم مع مثال مقارن.","coach_feedback":"الإجابة خارج الموضوع تماماً. ابدأ دائماً بالإجابة المباشرة على السؤال.","improved_answer":"الأصول موارد تمتلكها المنشأة كالنقد والمخزون. الخصوم التزامات مستحقة عليها كالقروض."},{"question":"السؤال الفعلي 2","answer_classification":{"primary_issue":"incomplete","secondary_issues":["vague"]},"diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"تتناول السؤال لكنها ناقصة.","evidence":"","how_to_improve":"أضف مثالاً محدداً ونتيجة."},"accuracy":{"status":"Acceptable","severity":"low","reason":"لا أخطاء واضحة.","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"تغطي الأساسيات لكن تفتقر لجوانب مهمة.","evidence":"","how_to_improve":"تناول الإجراءات والنتيجة."},"logic_coherence":{"status":"Good","severity":"none","reason":"منطقية ومتسقة.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"ادعاءات مبهمة بلا أرقام.","evidence":"أنا أعمل بجد.","how_to_improve":"استبدل بموقف محدد وقابل للقياس."},"supporting_example":{"status":"Incomplete","severity":"medium","reason":"مثال جزئي بلا نتيجة.","evidence":"","how_to_improve":"أكمل بالإجراء والنتيجة."},"star_structure":{"status":"Incomplete","severity":"medium","reason":"الموقف موجود لكن الإجراء والنتيجة غائبان.","evidence":"","how_to_improve":"أضف ما فعلته ونتيجة قابلة للقياس."},"communication_clarity":{"status":"Good","severity":"none","reason":"واضحة وسهلة الفهم.","evidence":"","how_to_improve":""}},"star_sub_diagnosis":{"situation":"present","task":"missing","action":"partial","result":"missing"},"what_interviewer_expected":"موقف محدد، دور، إجراءات، ونتيجة قابلة للقياس.","coach_feedback":"الإجابة ناقصة لأنها تفتقر للإجراء والنتيجة. استخدم منهج STAR بالكامل.","improved_answer":"في دوري السابق واجه الفريق تأخراً في مشروع حرج. أنشأت اجتماعات يومية وأعدت توزيع المهام، فتم التسليم في الموعد وجدد العميل العقد."}]}`
        : `You are evaluating a candidate for ${role} (Education: ${education}, Experience: ${experience}).

${speechMetricsBlock}
${hasContentOnly ? '\nNOTE: Answers marked [CONTENT ONLY] were in a different language. Evaluate ideas, structure, relevance only — do NOT penalize language or communication style.\n' : ''}
Candidate's actual answers:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. Q: ${q.question}\n   A: "${q.answer || '(no answer given)'}"${contentOnlyMask[i] ? ' [CONTENT ONLY]' : ''}`).join('\n\n')}

Return ONLY valid JSON. Per-question structure in per_question_diagnosis:
{"question":"...","answer_classification":{"primary_issue":"off_topic|incorrect|incomplete|vague|no_answer|acceptable|strong","secondary_issues":[]},"diagnosis":{...8 dimensions...},"star_sub_diagnosis":{"situation":"present|partial|missing|not_applicable","task":"...","action":"...","result":"..."},"what_interviewer_expected":"1 sentence.","coach_feedback":"2 sentences.","improved_answer":"2-3 sentences."}

{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"strengths":["Genuine strength or no-strengths message"],"improvements":["Specific improvement 1","Specific improvement 2","Specific improvement 3"],"ai_feedback":"Direct honest coaching.","recommendations":[{"title":"Rec 1","description":"Advice 1"},{"title":"Rec 2","description":"Advice 2"},{"title":"Rec 3","description":"Advice 3"}],"per_question_diagnosis":[{"question":"Actual Q1 text","answer_classification":{"primary_issue":"off_topic","secondary_issues":[]},"diagnosis":${diagExample},"star_sub_diagnosis":{"situation":"not_applicable","task":"not_applicable","action":"not_applicable","result":"not_applicable"},"what_interviewer_expected":"Define assets and liabilities with a brief comparison example.","coach_feedback":"The answer is entirely off-topic, which signals a knowledge gap to any interviewer. Always address the actual question directly first.","improved_answer":"Assets are economic resources a business owns (cash, inventory, equipment). Liabilities are obligations it owes (loans, payables). A company vehicle is an asset; the loan to buy it is a liability."},{"question":"Actual Q2 text","answer_classification":{"primary_issue":"incomplete","secondary_issues":["vague"]},"diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"Addresses the question but lacks depth.","evidence":"","how_to_improve":"Add a specific example with a measurable result."},"accuracy":{"status":"Acceptable","severity":"low","reason":"No factual errors detected.","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"Covers basics but misses action and result.","evidence":"","how_to_improve":"Include what you did and the outcome."},"logic_coherence":{"status":"Good","severity":"none","reason":"Coherent and logical.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"Vague claim with no detail.","evidence":"I always work hard.","how_to_improve":"Replace with a named situation and measurable outcome."},"supporting_example":{"status":"Incomplete","severity":"medium","reason":"Example lacks action and result.","evidence":"","how_to_improve":"Complete with STAR structure."},"star_structure":{"status":"Incomplete","severity":"medium","reason":"Situation present but action and result missing.","evidence":"","how_to_improve":"Add what you did and a quantifiable result."},"communication_clarity":{"status":"Good","severity":"none","reason":"Clear and easy to follow.","evidence":"","how_to_improve":""}},"star_sub_diagnosis":{"situation":"present","task":"missing","action":"partial","result":"missing"},"what_interviewer_expected":"A specific situation, your role, the actions you took, and a measurable result.","coach_feedback":"The answer is incomplete — no result means the interviewer cannot judge your impact. Finish the STAR loop with a concrete outcome.","improved_answer":"When my team was behind on a critical project, I identified blockers, set up daily 15-minute syncs, and reallocated tasks. We delivered on time and the client renewed the contract."}]}`;

    } else if (mode === 'presentation') {
      const topic = sanitize(body.topic, 200);
      const transcript = sanitize(body.transcript, 8000);
      const contentOnly = body.contentOnly === true;

      if (!transcript || transcript.trim().length < 10) {
        return new Response(
          JSON.stringify({ error: 'No presentation content to analyze. Please record your presentation first.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const transcriptWordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
      const durationSec: number | null = typeof sm.durationSeconds === 'number' ? sm.durationSeconds : null;

      const contentOnlyNote = contentOnly
        ? '\nIMPORTANT: This presentation was recorded in a different language. Evaluate CONTENT ONLY: structure, organization, clarity, message, relevance. Do NOT penalize language fluency or pronunciation.\n'
        : '';

      systemPrompt = `You are a strict, professional presentation coach. Evaluate recorded presentations honestly and directly.

SCORING RUBRIC:
0–15: Empty, no content, completely off-topic, or incoherent
16–35: Very weak — extremely short (<30 words), no structure, generic/irrelevant ideas
36–55: Basic — some relevant ideas, weak organization, limited examples, missing intro or conclusion
56–75: Good — clear topic, logical flow, reasonable supporting details, identifiable structure
76–90: Strong — well organized, clear intro/body/conclusion, good transitions, effective delivery
91–100: Excellent — professional structure, engaging, compelling examples, memorable conclusion

CRITICAL RULES:
1. Be brutally honest. Do NOT inflate scores.
2. Under 30 words → overall_score MUST be below 30. Under 80 words → below 45. Under 150 words → below 60.
3. Off-topic → communication_effectiveness MUST be below 30.
4. strengths: ONLY list if clearly supported by transcript or speech data. If weak: ["No clear strengths could be identified from this presentation."]
5. improvements: specific and actionable, tied to actual weaknesses.
6. score_reasons: 1–2 honest sentences per score referencing actual evidence.
7. structure_review: evaluate each section specifically, reference what was actually said.
8. ai_feedback: 2–4 direct coaching sentences. Name specific weaknesses. No generic praise.
9. Return valid JSON only.${contentOnlyNote}`;

      const metricsSummary = [
        durationSec !== null ? `Duration: ${Math.round(durationSec)} seconds` : null,
        `Word count: ${transcriptWordCount} words`,
        wpmLine, pauseLine, fillerLine,
      ].filter(Boolean).join('\n');

      userPrompt = isArabic
        ? `قيّم هذا العرض حول: "${topic}"\n\n${speechMetricsBlock}\nعدد الكلمات: ${transcriptWordCount}\n${contentOnlyNote}\nالنص: "${transcript}"\n\nأعد JSON فقط:\n{"overall_score":0,"confidence":0,"structure":0,"communication_effectiveness":0,"strengths":["نقطة قوة حقيقية"],"improvements":["تحسين 1","تحسين 2","تحسين 3"],"score_reasons":{"confidence":"سبب...","structure":"سبب...","communication_effectiveness":"سبب..."},"structure_review":{"opening":{"score":0,"feedback":"...","suggestions":"..."},"body":{"score":0,"feedback":"...","suggestions":"..."},"transitions":{"score":0,"feedback":"...","suggestions":"..."},"conclusion":{"score":0,"feedback":"...","suggestions":"..."}},"ai_feedback":"تغذية راجعة مباشرة.","recommendations":[{"title":"توصية 1","description":"نصيحة 1"},{"title":"توصية 2","description":"نصيحة 2"},{"title":"توصية 3","description":"نصيحة 3"}]}`
        : `Evaluate this presentation on: "${topic}"\n\n${speechMetricsBlock}\n${metricsSummary}\n${contentOnlyNote}\nFull transcript (${transcriptWordCount} words):\n"${transcript}"\n\nReturn ONLY valid JSON:\n{"overall_score":0,"confidence":0,"structure":0,"communication_effectiveness":0,"strengths":["Genuine strength from transcript/data, or the fixed no-strengths message"],"improvements":["Specific improvement 1","Specific improvement 2","Specific improvement 3"],"score_reasons":{"confidence":"Why this score...","structure":"Why this score...","communication_effectiveness":"Why this score..."},"structure_review":{"opening":{"score":0,"feedback":"What was said and how effective.","suggestions":"One specific improvement."},"body":{"score":0,"feedback":"How organized, what examples.","suggestions":"One specific improvement."},"transitions":{"score":0,"feedback":"How smoothly ideas connected.","suggestions":"One specific improvement."},"conclusion":{"score":0,"feedback":"How the presentation ended.","suggestions":"One specific improvement."}},"ai_feedback":"Direct 2-4 sentence coaching naming specific weaknesses.","recommendations":[{"title":"Rec 1","description":"Advice 1"},{"title":"Rec 2","description":"Advice 2"},{"title":"Rec 3","description":"Advice 3"}]}`;

    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid mode' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://laqtqzsvsbucbszuhkal.supabase.co',
        'X-Title': 'Qadha AI Coach',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
      }),
      signal: AbortSignal.timeout(140000),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenRouter error:', err);
      return new Response(
        JSON.stringify({ error: 'AI service temporarily unavailable. Please try again.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '{}';
    const finishReason = choice?.finish_reason ?? '';

    if (finishReason === 'length') {
      console.error('analyze-performance: AI response truncated (finish_reason=length)');
      return new Response(
        JSON.stringify({ error: 'AI response was cut off. Please try again.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      try {
        const match = content.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : {};
      } catch {
        parsed = {};
      }
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).overall_score !== 'number'
    ) {
      return new Response(
        JSON.stringify({ error: 'AI returned an unexpected response. Please try again.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    enforceConsistency(parsed as Record<string, unknown>, mode);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      console.error('OpenRouter timeout:', err);
      return new Response(
        JSON.stringify({ error: 'Analysis timed out. Please try again.' }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
