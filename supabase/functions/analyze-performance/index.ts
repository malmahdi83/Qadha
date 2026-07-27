import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const MODEL = 'anthropic/claude-3-5-sonnet-20241022';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const ALLOWED_ORIGINS = [
  'https://qadha-gules.vercel.app',
  'http://localhost:3000',
];

// Rate limit: 5 analyses per user per hour
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
// NOTE: This in-memory rate limit resets on every cold start and is not shared
// across isolate instances. It provides a best-effort guard against accidental
// overuse but can be bypassed. For production enforcement, replace with a
// persistent store (e.g. Supabase KV, Redis, or a DB counter).
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

    // Extract pre-computed speech metrics from client (no defaults — if absent, prompt says unavailable)
    interface FillerEntry { word: string; count: number }
    interface SpeechMetricsRaw {
      avgWpm?: number;
      wpm?: number;
      fillerWords?: FillerEntry[];
      pauseCount?: number;
      avgPauseDuration?: number;
      longestPauseDuration?: number;
      durationSeconds?: number;
    }
    const sm: SpeechMetricsRaw = (body.speechMetrics && typeof body.speechMetrics === 'object')
      ? body.speechMetrics as SpeechMetricsRaw
      : {};

    const avgWpm: number | null = typeof sm.avgWpm === 'number' ? Math.round(sm.avgWpm)
      : typeof sm.wpm === 'number' ? Math.round(sm.wpm) : null;
    const pauseCount: number | null = typeof sm.pauseCount === 'number' ? sm.pauseCount : null;
    const avgPauseDuration: number | null = typeof sm.avgPauseDuration === 'number' ? sm.avgPauseDuration : null;
    const longestPauseDuration: number | null = typeof sm.longestPauseDuration === 'number' ? sm.longestPauseDuration : null;
    const fillerWords: FillerEntry[] = Array.isArray(sm.fillerWords) ? sm.fillerWords as FillerEntry[] : [];

    // Build human-readable speech metrics block for the prompt
    const wpmLine = avgWpm !== null
      ? `- Speaking pace: ${avgWpm} WPM (ideal interview range: 120–150 WPM)`
      : '- Speaking pace: not available';
    const pauseLine = pauseCount !== null
      ? `- Long pauses (>2 s): ${pauseCount}${pauseCount > 0 && avgPauseDuration !== null ? `, avg ${avgPauseDuration.toFixed(1)} s, longest ${(longestPauseDuration ?? 0).toFixed(1)} s` : ''}`
      : '- Long pauses: not available';
    const fillerLine = fillerWords.length > 0
      ? `- Filler words detected: ${fillerWords.map((f: FillerEntry) => `"${f.word}" ×${f.count}`).join(', ')}`
      : '- Filler words: none detected';

    const speechMetricsBlock = `MEASURED SPEECH DATA (from actual audio analysis — do NOT re-estimate these):
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
            return {
              question: sanitize(item.question, 300),
              answer: sanitize(item.answer, 2000),
            };
          })
        : [];

      const contentOnlyMask: boolean[] = Array.isArray(body.contentOnlyMask)
        ? body.contentOnlyMask.slice(0, 5).map((v: unknown) => v === true)
        : Array(questions.length).fill(false);
      const hasContentOnly = contentOnlyMask.some(Boolean);

      systemPrompt = `You are a strict, realistic interview performance analyst — like a senior hiring manager who has seen thousands of interviews. Your job is to evaluate the ACTUAL quality of what the candidate said, not what they could have said.

CRITICAL RULES:
1. Be brutally honest. Do NOT inflate scores. A short, vague, or irrelevant answer must score LOW.
2. Score each dimension based ONLY on evidence in the actual answers.
3. Scoring rubric you MUST follow:
   - Empty / no answer → 0-10
   - 1-3 word answer or "I don't know" → 5-15
   - Very short (<10 words), incomplete → 10-30
   - Generic answer, no examples, no structure → 30-50
   - Decent answer with some specifics → 50-65
   - Good answer with clear examples → 65-80
   - Excellent STAR-structured, specific, professional → 80-100
4. overall_score = weighted average of ALL answers' quality. If most answers are poor, overall must be LOW (under 40).
5. Strengths: ONLY list strengths that are CLEARLY and DIRECTLY supported by specific things the candidate actually said. If the answers are weak, vague, or empty, write exactly: "No clear strengths could be identified from the answers provided." — do NOT invent strengths.
6. Improvements: must be specific, actionable, and tied to the ACTUAL weaknesses observed in the answers.
7. For "confidence" (delivery confidence estimate 0-100): factor in the measured speech data provided — pace vs ideal range, filler word frequency, pause frequency — as well as answer completeness and hesitation markers visible in the transcript. A fast, filler-heavy, pause-riddled delivery should lower this score even if answers are decent.
8. ai_feedback: be honest and direct, like a real coach. Point out weak answers specifically. Do NOT say "great effort" if the answers were poor.
9. Return valid JSON only, no markdown, no extra text.

ANSWER DIAGNOSIS RULES (new — follow for every question):
For each answer, you must diagnose it across 8 dimensions. Be honest, evidence-based, and specific. Do not invent or hallucinate evidence.

Dimensions:
- relevance: Does the answer address what was asked?
- accuracy: Is the content factually/technically correct for the role?
- completeness: Does the answer cover all expected aspects?
- logic_coherence: Is the answer internally consistent and logically structured?
- specificity: Does the answer include concrete details, numbers, named examples?
- supporting_example: Is there a real example from the candidate's experience?
- star_structure: Is the Situation-Task-Action-Result framework present? (mark Not Applicable for knowledge questions)
- communication_clarity: Is the answer well-organized and easy to follow?

Valid statuses: "Excellent" | "Good" | "Acceptable" | "Needs Improvement" | "Weak" | "Off-topic" | "Incorrect" | "Incomplete" | "Contradictory" | "Unclear" | "Not Applicable"
Valid severities: "none" | "low" | "medium" | "high" | "critical"

SCORE CEILING RULES — enforce these on answer_quality:
- Answer is off-topic (relevance status = "Off-topic", severity ≥ high) → answer_quality ceiling 15
- Answer is factually incorrect (accuracy status = "Incorrect", severity ≥ high) → answer_quality ceiling 30
- Answer is contradictory (logic_coherence = "Contradictory", severity ≥ high) → answer_quality ceiling 25
- Answer is empty or near-empty → answer_quality ceiling 10
- Answer is relevant but very incomplete (completeness severity ≥ high) → answer_quality ceiling 45
- Generic answer, no examples at all → answer_quality ceiling 55

IMPORTANT RULES FOR DIAGNOSIS:
- "evidence" field: quote or closely paraphrase the actual words from the answer. Empty string if no evidence applies.
- "reason" field: 1-2 sentences explaining the diagnosis.
- "how_to_improve" field: specific actionable guidance. Empty string only for "Excellent" or "Not Applicable".
- Never accuse the user of lying. For suspicious claims use "Credibility: Questionable" in reason.
- Use respectful coaching language. Never say "stupid", "nonsense", "ridiculous".
- Short but directly relevant answer = "Incomplete", not "Off-topic".
- Generic claim without evidence (e.g. "I work hard") → specificity = "Weak", supporting_example = "Missing" or "Weak".`;

      userPrompt = isArabic
        ? `أنت محلّل مقابلات صارم وواقعي. قيّم أداء هذا المرشح لوظيفة ${role} (تعليم: ${education}, خبرة: ${experience}).

${speechMetricsBlock}
${hasContentOnly ? `\nتنبيه: بعض الإجابات المحددة بـ [محتوى فقط] قُدِّمت بلغة مختلفة عن لغة المقابلة. لهذه الإجابات: قيّم المحتوى والأفكار والبنية فقط — تجاهل درجات اللغة والتواصل اللفظي لها في مقياس communication.\n` : ''}
إجاباته الفعلية:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. السؤال: ${q.question}\nالإجابة: "${q.answer || '(لم يُقدِّم إجابة)'}"${contentOnlyMask[i] ? ' [محتوى فقط — تجاهل تقييم اللغة]' : ''}`).join('\n\n')}

تعليمات صارمة يجب اتباعها:
1. قيّم كل إجابة بناءً على: الصلة بالسؤال، الاكتمال، التحديد، الاحترافية، وجود أمثلة، منهج STAR.
2. سلّم الدرجات وفق هذا المقياس الصارم:
   - إجابة فارغة أو "لا أعرف" → 0-15
   - إجابة قصيرة جداً (أقل من 10 كلمات) → 10-30
   - إجابة عامة بدون أمثلة → 30-50
   - إجابة جيدة مع أمثلة → 60-80
   - إجابة ممتازة بمنهج STAR → 80-100
3. overall_score = متوسط حقيقي لجودة كل الإجابات. إذا كانت معظم الإجابات ضعيفة، يجب أن تكون النتيجة الإجمالية منخفضة (أقل من 40).
4. نقاط القوة: اذكرها فقط إذا كانت مدعومة بوضوح من الإجابات الفعلية. إذا كانت الإجابات ضعيفة اكتب بالضبط: ["لم تتضح نقاط قوة واضحة من إجابات هذه الجلسة."]
5. "confidence" (تقدير الثقة في الإلقاء): احسبه بناءً على بيانات الكلام المقاسة أعلاه (وتيرة الكلام مقارنة بالمثالية، كثافة كلمات الحشو، تكرار التوقفات) إضافةً إلى اكتمال الإجابات وعلامات التردد في النص.
6. اكتب إجابة مثالية لكل سؤال بالعربية بمنهج STAR مناسبة لمستوى ${experience} في ${role}.

تعليمات تشخيص الإجابات (جديدة — طبّقها على كل سؤال):
لكل إجابة، يجب تشخيصها عبر 8 أبعاد. كن صادقاً ومحدداً ومبنياً على الأدلة الفعلية. لا تخترع أدلة.

الأبعاد:
- relevance: هل تتناول الإجابة ما طُرح في السؤال؟
- accuracy: هل المحتوى دقيق مهنياً/تقنياً بما يتناسب مع الدور؟
- completeness: هل الإجابة تغطي جميع الجوانب المتوقعة؟
- logic_coherence: هل الإجابة متسقة داخلياً ومنطقياً؟
- specificity: هل تتضمن الإجابة تفاصيل ملموسة أو أرقاماً أو أمثلة محددة؟
- supporting_example: هل يوجد مثال حقيقي من تجربة المرشح؟
- star_structure: هل يوجد منهج STAR؟ (اكتب "Not Applicable" للأسئلة المعرفية)
- communication_clarity: هل الإجابة منظمة وسهلة الفهم؟

قواعد سقف الدرجات:
- إجابة خارج الموضوع (relevance = "Off-topic") → سقف answer_quality = 15
- إجابة غلط فعلياً (accuracy = "Incorrect") → سقف answer_quality = 30
- إجابة متناقضة (logic_coherence = "Contradictory") → سقف answer_quality = 25
- إجابة فارغة → سقف answer_quality = 10
- إجابة ذات صلة لكن ناقصة جداً → سقف answer_quality = 45
- إجابة عامة بلا أمثلة → سقف answer_quality = 55

أعد JSON فقط، جميع القيم يجب أن تعكس الإجابات الفعلية:
{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"strengths":["نقطة قوة حقيقية مدعومة بالإجابات أو الجملة الثابتة إذا لم توجد"],"improvements":["تحسين محدد مبني على ضعف فعلي في الإجابة 1","تحسين محدد 2","تحسين محدد 3"],"ai_feedback":"تغذية راجعة صريحة وصادقة كمدرب مقابلات حقيقي، تشير إلى الإجابات الضعيفة بالتحديد.","recommendations":[{"title":"توصية محددة 1","description":"نصيحة عملية 1"},{"title":"توصية محددة 2","description":"نصيحة عملية 2"},{"title":"توصية محددة 3","description":"نصيحة عملية 3"}],"ideal_answers":[{"question":"نص السؤال 1","ideal_answer":"إجابة مثالية بمنهج STAR"},{"question":"نص السؤال 2","ideal_answer":"إجابة مثالية"},{"question":"نص السؤال 3","ideal_answer":"إجابة مثالية"},{"question":"نص السؤال 4","ideal_answer":"إجابة مثالية"},{"question":"نص السؤال 5","ideal_answer":"إجابة مثالية"}],"per_question_diagnosis":[{"question":"نص السؤال 1","diagnosis":{"relevance":{"status":"Off-topic","severity":"critical","reason":"الإجابة لا تتناول السؤال المطروح.","evidence":"أنا أحب كرة القدم والسفر.","how_to_improve":"ابدأ بالإجابة المباشرة على ما طُرح."},"accuracy":{"status":"Not Applicable","severity":"none","reason":"لا يمكن تقييم الدقة لأن الإجابة خارج الموضوع.","evidence":"","how_to_improve":""},"completeness":{"status":"Weak","severity":"high","reason":"لم يُقدَّم أي محتوى ذي صلة.","evidence":"","how_to_improve":"غطِّ جميع الجوانب المطلوبة."},"logic_coherence":{"status":"Acceptable","severity":"low","reason":"الجملة متماسكة نحوياً.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"لا توجد تفاصيل محددة تتعلق بالسؤال.","evidence":"","how_to_improve":"أضف أمثلة وأرقاماً ومواقف محددة."},"supporting_example":{"status":"Not Applicable","severity":"none","reason":"لا يوجد محتوى ذي صلة.","evidence":"","how_to_improve":""},"star_structure":{"status":"Not Applicable","severity":"none","reason":"لا ينطبق على هذا النوع من الأسئلة.","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"الإجابة واضحة نحوياً.","evidence":"","how_to_improve":""}}},{"question":"نص السؤال 2","diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"الإجابة تتناول السؤال.","evidence":"","how_to_improve":"أضف أمثلة محددة أكثر."},"accuracy":{"status":"Acceptable","severity":"low","reason":"لا توجد أخطاء واضحة.","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"الإجابة تغطي الأساسيات لكن تفتقر لجوانب مهمة.","evidence":"","how_to_improve":"تناول أيضاً النقطة س و ص."},"logic_coherence":{"status":"Good","severity":"none","reason":"الإجابة منطقية ومتسلسلة.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"الادعاءات مبهمة.","evidence":"أنا دائماً أعمل بجد.","how_to_improve":"استبدل الادعاءات العامة بأمثلة محددة."},"supporting_example":{"status":"Incomplete","severity":"medium","reason":"مثال جزئي لكن بلا تفاصيل كافية.","evidence":"","how_to_improve":"أكمل المثال بالموقف والإجراء والنتيجة."},"star_structure":{"status":"Incomplete","severity":"medium","reason":"الموقف موجود لكن الإجراء والنتيجة غائبان.","evidence":"","how_to_improve":"أضف ما قمت به والنتيجة التي تحققت."},"communication_clarity":{"status":"Good","severity":"none","reason":"الإجابة سهلة المتابعة.","evidence":"","how_to_improve":""}}},{"question":"نص السؤال 3","diagnosis":{"relevance":{"status":"Excellent","severity":"none","reason":"","evidence":"","how_to_improve":""},"accuracy":{"status":"Excellent","severity":"none","reason":"","evidence":"","how_to_improve":""},"completeness":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"logic_coherence":{"status":"Excellent","severity":"none","reason":"","evidence":"","how_to_improve":""},"specificity":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"supporting_example":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"star_structure":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Excellent","severity":"none","reason":"","evidence":"","how_to_improve":""}}},{"question":"نص السؤال 4","diagnosis":{"relevance":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"accuracy":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"","evidence":"","how_to_improve":""},"logic_coherence":{"status":"Good","severity":"none","reason":"","evidence":"","how_to_improve":""},"specificity":{"status":"Needs Improvement","severity":"medium","reason":"","evidence":"","how_to_improve":""},"supporting_example":{"status":"Weak","severity":"medium","reason":"","evidence":"","how_to_improve":""},"star_structure":{"status":"Not Applicable","severity":"none","reason":"","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"","evidence":"","how_to_improve":""}}},{"question":"نص السؤال 5","diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"accuracy":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"completeness":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"logic_coherence":{"status":"Good","severity":"none","reason":"","evidence":"","how_to_improve":""},"specificity":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"supporting_example":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"star_structure":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"","evidence":"","how_to_improve":""}}}]}`
        : `You are a strict, realistic interview coach evaluating a candidate for a ${role} role (Education: ${education}, Experience: ${experience}).

${speechMetricsBlock}

Candidate's actual answers:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. Q: ${q.question}\n   A: "${q.answer || '(no answer given)'}"${contentOnlyMask[i] ? ' [CONTENT ONLY — language mismatch, skip language/communication scoring for this answer]' : ''}`).join('\n\n')}
${hasContentOnly ? '\nNOTE: Answers marked [CONTENT ONLY] were answered in a different language than the interview language. For these answers ONLY: evaluate ideas, structure, relevance, and completeness — do NOT penalize language or communication style. Adjust overall communication score accordingly.' : ''}

STRICT EVALUATION RULES — follow exactly:
1. Evaluate each answer on: relevance, completeness, specificity, professionalism, use of examples, STAR structure.
2. Apply this scoring scale — do NOT deviate:
   - Empty / "I don't know" / no answer → 0-15
   - 1-5 words → 5-20
   - Very short (<10 words), incomplete → 10-30
   - Generic, no examples, no structure → 30-50
   - Decent answer with some specifics → 50-65
   - Good answer with clear examples → 65-80
   - Excellent STAR-structured, specific → 80-100
3. overall_score = honest weighted average of ALL answers. If most answers are short/vague/empty, overall MUST be under 40.
4. strengths: ONLY list if clearly supported by actual answer content. If answers are weak, return exactly: ["No clear strengths could be identified from the answers provided."]
5. "confidence" (delivery confidence estimate 0-100): base it on the MEASURED SPEECH DATA above — pace vs ideal range (120-150 WPM), filler word density, pause frequency — plus answer completeness and hesitation markers in the transcript. Do NOT invent or re-estimate speech values.
6. Write a professional ideal answer for each question using STAR, tailored to ${experience}-level ${role}.
7. ai_feedback: be direct and honest like a real coach. Name the weak answers specifically. Do NOT pad with generic praise.

Return ONLY valid JSON, all values must reflect actual answer quality:
{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"strengths":["Genuine strength from answers, or the fixed message if none"],"improvements":["Specific improvement tied to weak answer 1","Specific improvement 2","Specific improvement 3"],"ai_feedback":"Direct, honest coaching feedback naming which answers were weak and why.","recommendations":[{"title":"Specific recommendation 1","description":"Practical advice 1"},{"title":"Specific recommendation 2","description":"Practical advice 2"},{"title":"Specific recommendation 3","description":"Practical advice 3"}],"ideal_answers":[{"question":"Actual Q1 text","ideal_answer":"STAR ideal answer for Q1"},{"question":"Actual Q2 text","ideal_answer":"Ideal answer for Q2"},{"question":"Actual Q3 text","ideal_answer":"Ideal answer for Q3"},{"question":"Actual Q4 text","ideal_answer":"Ideal answer for Q4"},{"question":"Actual Q5 text","ideal_answer":"Ideal answer for Q5"}],"per_question_diagnosis":[{"question":"Actual Q1 text","diagnosis":{"relevance":{"status":"Off-topic","severity":"critical","reason":"The answer does not address the question.","evidence":"I like football.","how_to_improve":"Start by directly addressing what was asked."},"accuracy":{"status":"Not Applicable","severity":"none","reason":"Cannot assess accuracy since the answer is off-topic.","evidence":"","how_to_improve":""},"completeness":{"status":"Weak","severity":"high","reason":"No relevant content was provided.","evidence":"","how_to_improve":"Include all key aspects of the answer."},"logic_coherence":{"status":"Acceptable","severity":"low","reason":"The sentence is grammatically coherent.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"No specific details related to the question.","evidence":"","how_to_improve":"Add concrete examples, numbers, or named situations."},"supporting_example":{"status":"Not Applicable","severity":"none","reason":"No relevant content to build an example from.","evidence":"","how_to_improve":""},"star_structure":{"status":"Not Applicable","severity":"none","reason":"Not applicable to this question type or answer.","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"The response is grammatically clear.","evidence":"","how_to_improve":""}}},{"question":"Actual Q2 text","diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"The answer addresses the question.","evidence":"","how_to_improve":"Add more specific examples."},"accuracy":{"status":"Acceptable","severity":"low","reason":"No obvious factual errors.","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"The answer covers the basics but misses key aspects.","evidence":"","how_to_improve":"Also address X and Y."},"logic_coherence":{"status":"Good","severity":"none","reason":"The answer follows a logical flow.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"Claims are vague.","evidence":"I always work hard.","how_to_improve":"Replace general claims with specific examples."},"supporting_example":{"status":"Incomplete","severity":"medium","reason":"A partial example is mentioned but lacks detail.","evidence":"","how_to_improve":"Complete the example with situation, action, and result."},"star_structure":{"status":"Incomplete","severity":"medium","reason":"Situation is present but action and result are missing.","evidence":"","how_to_improve":"Add what you did and what the outcome was."},"communication_clarity":{"status":"Good","severity":"none","reason":"The answer is easy to follow.","evidence":"","how_to_improve":""}}},{"question":"Actual Q3 text","diagnosis":{"relevance":{"status":"Excellent","severity":"none","reason":"","evidence":"","how_to_improve":""},"accuracy":{"status":"Excellent","severity":"none","reason":"","evidence":"","how_to_improve":""},"completeness":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"logic_coherence":{"status":"Excellent","severity":"none","reason":"","evidence":"","how_to_improve":""},"specificity":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"supporting_example":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"star_structure":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Excellent","severity":"none","reason":"","evidence":"","how_to_improve":""}}},{"question":"Actual Q4 text","diagnosis":{"relevance":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"accuracy":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"","evidence":"","how_to_improve":""},"logic_coherence":{"status":"Good","severity":"none","reason":"","evidence":"","how_to_improve":""},"specificity":{"status":"Needs Improvement","severity":"medium","reason":"","evidence":"","how_to_improve":""},"supporting_example":{"status":"Weak","severity":"medium","reason":"","evidence":"","how_to_improve":""},"star_structure":{"status":"Not Applicable","severity":"none","reason":"","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"","evidence":"","how_to_improve":""}}},{"question":"Actual Q5 text","diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"accuracy":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"completeness":{"status":"Good","severity":"low","reason":"","evidence":"","how_to_improve":""},"logic_coherence":{"status":"Good","severity":"none","reason":"","evidence":"","how_to_improve":""},"specificity":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"supporting_example":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"star_structure":{"status":"Acceptable","severity":"low","reason":"","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"","evidence":"","how_to_improve":""}}}]}`;

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

      // Compute word count and duration from speech metrics for rubric enforcement
      const transcriptWordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
      const durationSec: number | null = typeof sm.durationSeconds === 'number' ? sm.durationSeconds : null;

      const contentOnlyNote = contentOnly
        ? '\nIMPORTANT: This presentation was recorded in a different language than the selected presentation language. Evaluate CONTENT ONLY: structure, organization, clarity, message, relevance. Do NOT evaluate English/Arabic fluency, grammar, or pronunciation. Do NOT score communication_effectiveness based on language quality — only on message clarity and content.\n'
        : '';

      systemPrompt = `You are a strict, professional presentation coach. You evaluate recorded presentations honestly and directly, like a real coach preparing someone for a professional or academic setting.

SCORING RUBRIC — follow exactly:
0–15: Empty, no content, completely off-topic, or incoherent
16–35: Very weak — extremely short (<30 words), no structure, generic/irrelevant ideas
36–55: Basic — some relevant ideas, weak organization, limited examples, missing introduction or conclusion
56–75: Good — clear topic, logical flow, reasonable supporting details, identifiable structure
76–90: Strong — well organized, clear introduction/body/conclusion, good transitions, effective delivery
91–100: Excellent — professional structure, engaging, compelling examples, memorable conclusion, polished delivery

CRITICAL RULES:
1. Be brutally honest. Do NOT inflate scores to be encouraging.
2. Under 30 words → overall_score MUST be below 30. Under 80 words → below 45. Under 150 words → below 60.
3. Off-topic presentations → communication_effectiveness MUST be below 30.
4. strengths: ONLY list if clearly supported by the actual transcript or speech data. If the presentation is weak, write exactly: ["No clear strengths could be identified from this presentation."]
5. improvements: be specific and actionable, tied to actual weaknesses observed.
6. score_reasons: explain in 1–2 honest sentences WHY each score was given. Reference specific evidence from the transcript.
7. structure_review: evaluate each section as a professional coach would — be specific, quote or reference what the speaker actually said.
8. ai_feedback: 2–4 sentences of direct, honest coaching. Name specific weaknesses. Do NOT pad with generic praise.
9. Return valid JSON only, no markdown, no extra text.${contentOnlyNote}`;

      const metricsSummary = [
        durationSec !== null ? `Duration: ${Math.round(durationSec)} seconds (${Math.round(durationSec / 60 * 10) / 10} min)` : null,
        `Word count: ${transcriptWordCount} words`,
        wpmLine,
        pauseLine,
        fillerLine,
      ].filter(Boolean).join('\n');

      userPrompt = isArabic
        ? `أنت مدرّب عروض تقديمية محترف وصارم. قيّم هذا العرض الفعلي حول موضوع: "${topic}"

${speechMetricsBlock}
مدة التسجيل: ${durationSec !== null ? `${Math.round(durationSec)} ثانية` : 'غير متاح'}
عدد الكلمات: ${transcriptWordCount} كلمة
${contentOnlyNote}
النص الكامل للعرض:
"${transcript}"

تعليمات صارمة:
1. اتبع مقياس التقييم بدقة — لا ترفع الدرجات.
2. أقل من 30 كلمة: overall_score أقل من 30. أقل من 80 كلمة: أقل من 45. أقل من 150 كلمة: أقل من 60.
3. موضوع غير ذي صلة: communication_effectiveness أقل من 30.
4. نقاط القوة: اذكرها فقط إذا كانت مدعومة بوضوح من النص أو بيانات الكلام. إذا كان العرض ضعيفاً اكتب بالضبط: ["لم تتضح نقاط قوة واضحة من هذا العرض."]
5. تقييم البنية: قيّم كل قسم (المقدمة، الجسم، الانتقالات، الخاتمة) كمدرب محترف — كن محدداً واستشهد بما قاله المتحدث فعلاً.
6. score_reasons: اشرح بجملة أو جملتين لماذا أعطيت هذه الدرجة بالاستناد إلى النص.
7. ai_feedback: 2-4 جمل من التغذية الراجعة الصادقة والمباشرة — سمّ نقاط الضعف تحديداً.

أعد JSON فقط:
{"overall_score":0,"confidence":0,"structure":0,"communication_effectiveness":0,"strengths":["نقطة قوة حقيقية مدعومة بالنص أو الجملة الثابتة"],"improvements":["تحسين محدد 1","تحسين محدد 2","تحسين محدد 3"],"score_reasons":{"confidence":"سبب الدرجة...","structure":"سبب الدرجة...","communication_effectiveness":"سبب الدرجة..."},"structure_review":{"opening":{"score":0,"feedback":"تقييم المقدمة...","suggestions":"اقتراحات..."},"body":{"score":0,"feedback":"تقييم الجسم...","suggestions":"اقتراحات..."},"transitions":{"score":0,"feedback":"تقييم الانتقالات...","suggestions":"اقتراحات..."},"conclusion":{"score":0,"feedback":"تقييم الخاتمة...","suggestions":"اقتراحات..."}},"ai_feedback":"تغذية راجعة مباشرة وصادقة تسمي نقاط الضعف تحديداً.","recommendations":[{"title":"توصية محددة 1","description":"نصيحة عملية 1"},{"title":"توصية محددة 2","description":"نصيحة عملية 2"},{"title":"توصية محددة 3","description":"نصيحة عملية 3"}]}`
        : `You are a strict, professional presentation coach. Evaluate this ACTUAL recorded presentation on: "${topic}"

${speechMetricsBlock}
${metricsSummary}
${contentOnlyNote}
Full transcript (${transcriptWordCount} words):
"${transcript}"

STRICT EVALUATION RULES — follow exactly:
1. Apply the scoring rubric. Do NOT inflate scores.
2. Under 30 words → overall_score MUST be below 30. Under 80 words → below 45. Under 150 words → below 60.
3. Off-topic → communication_effectiveness MUST be below 30.
4. strengths: ONLY list if clearly supported by transcript or speech data. If weak, return exactly: ["No clear strengths could be identified from this presentation."]
5. improvements: specific and actionable, tied to observed weaknesses.
6. score_reasons: 1–2 honest sentences explaining WHY each score. Reference specific evidence.
7. structure_review: evaluate each section like a professional coach. Be specific — reference what was actually said.
8. ai_feedback: 2–4 direct coaching sentences. Name specific weaknesses. No generic praise.
9. Return ONLY valid JSON:

{"overall_score":0,"confidence":0,"structure":0,"communication_effectiveness":0,"strengths":["Genuine strength from transcript/data, or the fixed no-strengths message"],"improvements":["Specific improvement 1 tied to actual weakness","Specific improvement 2","Specific improvement 3"],"score_reasons":{"confidence":"Why this score — reference pace/fillers/pauses...","structure":"Why this score — reference intro/body/conclusion...","communication_effectiveness":"Why this score — reference clarity/relevance..."},"structure_review":{"opening":{"score":0,"feedback":"What was actually said in the opening and how effective it was.","suggestions":"One specific way to improve the opening."},"body":{"score":0,"feedback":"How the body was organized, what examples were used.","suggestions":"One specific improvement for the body."},"transitions":{"score":0,"feedback":"How smoothly ideas connected.","suggestions":"One specific improvement for transitions."},"conclusion":{"score":0,"feedback":"How the presentation ended.","suggestions":"One specific improvement for the conclusion."}},"ai_feedback":"Direct 2-4 sentence coaching feedback naming specific weaknesses.","recommendations":[{"title":"Specific rec 1","description":"Practical advice 1"},{"title":"Specific rec 2","description":"Practical advice 2"},{"title":"Specific rec 3","description":"Practical advice 3"}]}`;

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
        temperature: 0.4,
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

    // Enforce score ceilings programmatically for interview mode
    if (mode === 'interview') {
      const p = parsed as Record<string, unknown>;
      const diag = p.per_question_diagnosis;
      if (Array.isArray(diag) && diag.length > 0) {
        let totalCeiling = 0;
        for (const item of diag) {
          const d = (item as Record<string, unknown>)?.diagnosis as Record<string, Record<string, string>> | undefined;
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
        if (typeof p.answer_quality === 'number') {
          p.answer_quality = Math.min(p.answer_quality, avgCeiling);
        }
      }
    }

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
