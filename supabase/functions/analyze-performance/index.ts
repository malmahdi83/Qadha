import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENROUTER_API_KEY = Deno.env.get('whisper-large-v3') ?? '';
const MODEL = 'anthropic/claude-opus-4';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const ALLOWED_ORIGINS = [
  'https://qadha-gules.vercel.app',
  'http://localhost:3000',
];

// Rate limit: 5 analyses per user per hour
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

function extractUserId(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const userId = extractUserId(req);
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
              answer: sanitize(item.answer, 1000),
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
9. Return valid JSON only, no markdown, no extra text.`;

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

أعد JSON فقط، جميع القيم يجب أن تعكس الإجابات الفعلية:
{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"strengths":["نقطة قوة حقيقية مدعومة بالإجابات أو الجملة الثابتة إذا لم توجد"],"improvements":["تحسين محدد مبني على ضعف فعلي في الإجابة 1","تحسين محدد 2","تحسين محدد 3"],"ai_feedback":"تغذية راجعة صريحة وصادقة كمدرب مقابلات حقيقي، تشير إلى الإجابات الضعيفة بالتحديد.","recommendations":[{"title":"توصية محددة 1","description":"نصيحة عملية 1"},{"title":"توصية محددة 2","description":"نصيحة عملية 2"},{"title":"توصية محددة 3","description":"نصيحة عملية 3"}],"ideal_answers":[{"question":"نص السؤال 1","ideal_answer":"إجابة مثالية بمنهج STAR"},{"question":"نص السؤال 2","ideal_answer":"إجابة مثالية"},{"question":"نص السؤال 3","ideal_answer":"إجابة مثالية"},{"question":"نص السؤال 4","ideal_answer":"إجابة مثالية"},{"question":"نص السؤال 5","ideal_answer":"إجابة مثالية"}]}`
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
{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"strengths":["Genuine strength from answers, or the fixed message if none"],"improvements":["Specific improvement tied to weak answer 1","Specific improvement 2","Specific improvement 3"],"ai_feedback":"Direct, honest coaching feedback naming which answers were weak and why.","recommendations":[{"title":"Specific recommendation 1","description":"Practical advice 1"},{"title":"Specific recommendation 2","description":"Practical advice 2"},{"title":"Specific recommendation 3","description":"Practical advice 3"}],"ideal_answers":[{"question":"Actual Q1 text","ideal_answer":"STAR ideal answer for Q1"},{"question":"Actual Q2 text","ideal_answer":"Ideal answer for Q2"},{"question":"Actual Q3 text","ideal_answer":"Ideal answer for Q3"},{"question":"Actual Q4 text","ideal_answer":"Ideal answer for Q4"},{"question":"Actual Q5 text","ideal_answer":"Ideal answer for Q5"}]}`;

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
        max_tokens: 4096,
      }),
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
      const match = content.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
