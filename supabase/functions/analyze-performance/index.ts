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
    if (d.completeness?.status === 'Incomplete' && d.completeness?.severity === 'high') ceiling = Math.min(ceiling, 45);
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

SCORING RUBRIC (follow exactly):
- Empty / no answer / "I don't know" → 0-10
- 1-5 words → 5-20
- Very short (<10 words) → 10-30
- Generic, no examples, no structure → 30-50
- Decent with some specifics → 50-65
- Good with clear examples → 65-80
- Excellent STAR-structured, specific, professional → 80-100

GLOBAL RULES:
1. overall_score = honest weighted average. Weak majority → under 40.
2. confidence (0-100): use MEASURED SPEECH DATA only — pace vs 120-150 WPM ideal, filler density, pause frequency, plus answer completeness. Never invent speech values.
3. ai_feedback: direct, honest coaching. Name weak answers specifically. No "great effort" for poor answers.
4. Return valid JSON only.

STRENGTHS — STRICT EVIDENCE RULES:
- ONLY list a strength directly supported by actual words the candidate said.
- FORBIDDEN contradictions:
  * accuracy = "Incorrect" → NEVER claim "technical knowledge" or "accurate understanding"
  * relevance = "Off-topic" → NEVER claim "answered the question clearly" or "relevant response"
  * star_structure = "Missing" or "Weak" → NEVER claim "STAR structure" or "well-structured"
  * answer_quality < 40 → NEVER claim "excellent communication" or "great delivery"
- Delivery strengths (pace, pronunciation) are valid ONLY if speech data confirms them.
- If no genuine strength exists: return ["No clear strengths could be identified from the answers provided."]

EMPTY / INVALID ANSWER HANDLING:
- Empty / silence / "skip" / only filler words → primary_issue = "no_answer"; all diagnosis dimensions = "Not Applicable" except completeness = "Missing" (severity critical); answer_score = 0; coach_feedback is supportive and explains what an answer should include.
- "I don't know" → primary_issue = "no_answer"; do NOT call it off_topic; supportive coach_feedback; improved_answer shows a starting direction.
- Nonsensical / random words → primary_issue = "nonsensical"; relevance = "Off-topic" severity critical.

ANSWER CLASSIFICATION (primary_issue values):
"off_topic" | "incorrect" | "incomplete" | "vague" | "contradictory" | "nonsensical" | "no_answer" | "skipped" | "acceptable" | "strong"

ANSWER DIAGNOSIS (8 dimensions):
- relevance: Does it address the question?
- accuracy: Factually/technically correct for the role?
- completeness: Covers all expected aspects?
- logic_coherence: Internally consistent and logical?
- specificity: Concrete details, numbers, named examples?
- supporting_example: Real example from candidate's experience?
- star_structure: STAR framework? Mark "Not Applicable" for factual/knowledge/definition questions.
- communication_clarity: Well-organized and easy to follow?

Valid statuses: "Excellent"|"Good"|"Acceptable"|"Needs Improvement"|"Weak"|"Off-topic"|"Incorrect"|"Incomplete"|"Contradictory"|"Unclear"|"Not Applicable"|"Missing"
Valid severities: "none"|"low"|"medium"|"high"|"critical"

Diagnosis field rules:
- evidence: quote or closely paraphrase actual words. Empty string if not applicable.
- reason: 1-2 sentences. Honest, evidence-based.
- how_to_improve: specific and actionable. Empty only for "Excellent" or "Not Applicable".
- Never accuse of lying. Use "Questionable credibility" for suspicious claims.

STAR SUB-DIAGNOSIS (star_sub_diagnosis):
- Only when star_structure IS applicable (behavioral questions: "tell me about a time...", "describe a situation...", etc.)
- If not applicable for this question type: set all 4 parts to "not_applicable"
- Valid per part: "present" | "partial" | "missing" | "not_applicable"

SCORE CEILING RULES (enforced by server too):
- relevance = "Off-topic" → answer_score ceiling 15
- accuracy = "Incorrect" → answer_score ceiling 30
- logic_coherence = "Contradictory" → answer_score ceiling 25
- completeness = "Missing" → answer_score ceiling 10
- completeness = "Incomplete" + severity high → ceiling 45
- specificity = "Weak" AND supporting_example = "Weak" → ceiling 55

COACHING FIELDS (per question — be concise):
- what_interviewer_expected: 1-2 sentences. What a good answer should have covered.
- coach_feedback: 2-3 direct sentences — what went wrong, why it matters in a real interview, how to fix it.
- improved_answer: 2-4 sentences. A model answer appropriate for this role and experience level, in the interview language. Must address the ACTUAL question. Do NOT copy the user's incorrect content.

CONSISTENCY CHECK before returning:
- If relevance = "Off-topic": answer_score must be ≤15, no content strengths, feedback mentions irrelevance, improved_answer addresses the actual question.
- If accuracy = "Incorrect": answer_score must be ≤30, feedback identifies the specific error, improved_answer corrects it.
- All fields must agree with each other. Run this check mentally before outputting.`;

      const diagExample = `{"relevance":{"status":"Off-topic","severity":"critical","reason":"The answer discusses personal hobbies instead of the accounting concept asked.","evidence":"I like football and travelling.","how_to_improve":"Start with a direct definition of what was asked."},"accuracy":{"status":"Not Applicable","severity":"none","reason":"Cannot assess — answer is entirely off-topic.","evidence":"","how_to_improve":""},"completeness":{"status":"Missing","severity":"critical","reason":"No relevant content was provided.","evidence":"","how_to_improve":"Cover the definition, comparison, and an example."},"logic_coherence":{"status":"Acceptable","severity":"low","reason":"The sentence is grammatically coherent, just unrelated.","evidence":"","how_to_improve":""},"specificity":{"status":"Not Applicable","severity":"none","reason":"No relevant content to assess.","evidence":"","how_to_improve":""},"supporting_example":{"status":"Not Applicable","severity":"none","reason":"No relevant content.","evidence":"","how_to_improve":""},"star_structure":{"status":"Not Applicable","severity":"none","reason":"Not a behavioral question.","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"The response is grammatically clear.","evidence":"","how_to_improve":""}}`;

      userPrompt = isArabic
        ? `قيّم أداء هذا المرشح لوظيفة ${role} (تعليم: ${education}، خبرة: ${experience}).

${speechMetricsBlock}
${hasContentOnly ? '\nملاحظة: إجابات محددة بـ [محتوى فقط] قُدِّمت بلغة مختلفة. قيّم المحتوى والأفكار فقط — تجاهل اللغة والتواصل اللفظي لها.\n' : ''}
الإجابات الفعلية:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. السؤال: ${q.question}\nالإجابة: "${q.answer || '(لم تُقدَّم إجابة)'}"${contentOnlyMask[i] ? ' [محتوى فقط]' : ''}`).join('\n\n')}

أعد JSON فقط (بدون markdown)، جميع الحقول يجب أن تعكس الإجابات الفعلية.
الهيكل المطلوب لكل سؤال في per_question_diagnosis:
{"question":"...","answer_classification":{"primary_issue":"off_topic|incorrect|incomplete|vague|no_answer|acceptable|strong","secondary_issues":[]},"diagnosis":{...8 dimensions...},"star_sub_diagnosis":{"situation":"present|partial|missing|not_applicable","task":"...","action":"...","result":"..."},"what_interviewer_expected":"...","coach_feedback":"...","improved_answer":"..."}

{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"strengths":["نقطة قوة حقيقية مدعومة من الإجابات الفعلية"],"improvements":["تحسين محدد 1","تحسين محدد 2","تحسين محدد 3"],"ai_feedback":"تغذية راجعة صادقة ومباشرة.","recommendations":[{"title":"توصية 1","description":"نصيحة 1"},{"title":"توصية 2","description":"نصيحة 2"},{"title":"توصية 3","description":"نصيحة 3"}],"ideal_answers":[{"question":"السؤال الفعلي 1","ideal_answer":"إجابة مثالية بمنهج STAR"},{"question":"السؤال الفعلي 2","ideal_answer":""},{"question":"السؤال الفعلي 3","ideal_answer":""},{"question":"السؤال الفعلي 4","ideal_answer":""},{"question":"السؤال الفعلي 5","ideal_answer":""}],"per_question_diagnosis":[{"question":"السؤال الفعلي 1","answer_classification":{"primary_issue":"off_topic","secondary_issues":[]},"diagnosis":${diagExample},"star_sub_diagnosis":{"situation":"not_applicable","task":"not_applicable","action":"not_applicable","result":"not_applicable"},"what_interviewer_expected":"تعريف للأصول وتعريف للخصوم مع مثال مقارن.","coach_feedback":"الإجابة لا تتناول السؤال المطروح. في المقابلة الحقيقية، هذا يعني أن المرشح لا يعرف الأساسيات. ابدأ دائماً بالإجابة المباشرة على ما طُرح.","improved_answer":"الأصول هي الموارد التي تمتلكها المنشأة وتمنحها قيمة مستقبلية، مثل النقد أو المخزون. الخصوم هي الالتزامات المستحقة على المنشأة، مثل القروض. مثلاً: السيارة التجارية أصل، والقرض الذي اشتُريت به خصم."},{"question":"السؤال الفعلي 2","answer_classification":{"primary_issue":"incomplete","secondary_issues":["vague"]},"diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"الإجابة تتناول السؤال لكنها ناقصة.","evidence":"","how_to_improve":"أضف تفاصيل وأمثلة محددة."},"accuracy":{"status":"Acceptable","severity":"low","reason":"لا أخطاء واضحة.","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"تغطي الأساسيات لكن تفتقر لجوانب مهمة.","evidence":"","how_to_improve":"تناول أيضاً النقطة س وص."},"logic_coherence":{"status":"Good","severity":"none","reason":"الإجابة منطقية.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"ادعاءات مبهمة.","evidence":"أنا أعمل بجد دائماً.","how_to_improve":"استبدل بأمثلة محددة."},"supporting_example":{"status":"Incomplete","severity":"medium","reason":"مثال جزئي بلا تفاصيل.","evidence":"","how_to_improve":"أكمل بالموقف والإجراء والنتيجة."},"star_structure":{"status":"Incomplete","severity":"medium","reason":"الموقف موجود لكن الإجراء والنتيجة غائبان.","evidence":"","how_to_improve":"أضف ما قمت به ونتيجة قابلة للقياس."},"communication_clarity":{"status":"Good","severity":"none","reason":"الإجابة سهلة الفهم.","evidence":"","how_to_improve":""}},"star_sub_diagnosis":{"situation":"present","task":"missing","action":"partial","result":"missing"},"what_interviewer_expected":"موقف محدد، وصف الدور والمسؤولية، الإجراءات المتخذة، ونتيجة قابلة للقياس.","coach_feedback":"الإجابة تبدأ جيداً لكنها تفتقر للتفاصيل والنتيجة. في المقابلة، غياب النتيجة يجعل الإجابة غير مكتملة. استخدم منهج STAR بالكامل.","improved_answer":"في دوري السابق واجهت مشكلة تأخر في تسليم المشروع. حددت السبب الرئيسي وهو عدم التنسيق بين الفرق، وأنشأت اجتماعاً أسبوعياً للمتابعة. نتيجةً لذلك، تم تسليم المشروع في الموعد المحدد وبجودة أعلى من المتوقع."}]}`
        : `You are evaluating a candidate for ${role} (Education: ${education}, Experience: ${experience}).

${speechMetricsBlock}
${hasContentOnly ? '\nNOTE: Answers marked [CONTENT ONLY] were in a different language. Evaluate ideas, structure, relevance only — do NOT penalize language or communication style.\n' : ''}
Candidate's actual answers:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. Q: ${q.question}\n   A: "${q.answer || '(no answer given)'}"${contentOnlyMask[i] ? ' [CONTENT ONLY]' : ''}`).join('\n\n')}

Return ONLY valid JSON. Every field must reflect the actual answer quality. Required structure per question in per_question_diagnosis:
{"question":"...","answer_classification":{"primary_issue":"off_topic|incorrect|incomplete|vague|no_answer|acceptable|strong","secondary_issues":[]},"diagnosis":{...8 dimensions...},"star_sub_diagnosis":{"situation":"present|partial|missing|not_applicable","task":"...","action":"...","result":"..."},"what_interviewer_expected":"1-2 sentences.","coach_feedback":"2-3 direct coaching sentences.","improved_answer":"2-4 sentence model answer in the interview language."}

{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"strengths":["Genuine strength supported by actual answer content, or the fixed no-strengths message"],"improvements":["Specific improvement tied to actual weakness 1","Specific improvement 2","Specific improvement 3"],"ai_feedback":"Direct, honest coaching naming which answers were weak and exactly why.","recommendations":[{"title":"Specific rec 1","description":"Practical advice 1"},{"title":"Specific rec 2","description":"Practical advice 2"},{"title":"Specific rec 3","description":"Practical advice 3"}],"ideal_answers":[{"question":"Actual Q1 text","ideal_answer":"STAR ideal answer at ${experience} level"},{"question":"Actual Q2 text","ideal_answer":""},{"question":"Actual Q3 text","ideal_answer":""},{"question":"Actual Q4 text","ideal_answer":""},{"question":"Actual Q5 text","ideal_answer":""}],"per_question_diagnosis":[{"question":"Actual Q1 text","answer_classification":{"primary_issue":"off_topic","secondary_issues":[]},"diagnosis":${diagExample},"star_sub_diagnosis":{"situation":"not_applicable","task":"not_applicable","action":"not_applicable","result":"not_applicable"},"what_interviewer_expected":"A definition of assets, a definition of liabilities, and a simple comparison example.","coach_feedback":"The answer was entirely unrelated to the accounting concept asked. In a real interview this signals a fundamental knowledge gap. Always begin by directly addressing what was asked.","improved_answer":"Assets are resources owned by a business that provide future economic value, such as cash, inventory, or equipment. Liabilities are obligations the business owes, such as loans or accounts payable. For example, a company vehicle is an asset, while the loan used to purchase it is a liability."},{"question":"Actual Q2 text","answer_classification":{"primary_issue":"incomplete","secondary_issues":["vague"]},"diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"The answer addresses the question but is incomplete.","evidence":"","how_to_improve":"Add specific examples and a measurable result."},"accuracy":{"status":"Acceptable","severity":"low","reason":"No obvious factual errors.","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"Covers basics but misses key aspects.","evidence":"","how_to_improve":"Also address X and Y."},"logic_coherence":{"status":"Good","severity":"none","reason":"Logical flow.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"Claims are vague with no concrete details.","evidence":"I always work hard.","how_to_improve":"Replace with a specific situation and measurable result."},"supporting_example":{"status":"Incomplete","severity":"medium","reason":"Partial example mentioned but lacks detail.","evidence":"","how_to_improve":"Complete the example with action taken and the outcome."},"star_structure":{"status":"Incomplete","severity":"medium","reason":"Situation present but action and result missing.","evidence":"","how_to_improve":"Add what you did and a quantifiable result."},"communication_clarity":{"status":"Good","severity":"none","reason":"Easy to follow.","evidence":"","how_to_improve":""}},"star_sub_diagnosis":{"situation":"present","task":"missing","action":"partial","result":"missing"},"what_interviewer_expected":"A specific situation, your role and responsibility, the actions you took, and a measurable result.","coach_feedback":"The answer starts well but lacks a result and specific actions. Without a result, interviewers cannot assess your impact. Always complete the STAR loop with a concrete outcome.","improved_answer":"In my previous role, the team was behind schedule on a critical project. I mapped the blockers, set up a daily 15-minute sync, and redistributed tasks based on availability. We delivered on time and the client extended the contract for another year."}]}`;

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
    const content = data.choices?.[0]?.message?.content ?? '{}';

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
