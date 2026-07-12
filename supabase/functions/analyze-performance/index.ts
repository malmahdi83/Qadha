import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENROUTER_API_KEY = Deno.env.get('whisper-large-v3') ?? '';
const MODEL = 'openai/gpt-4o-mini';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const ALLOWED_ORIGINS = [
  'https://qadha-gules.vercel.app',
  'http://localhost:3000',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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

    // Sanitize a string: strip backticks/backslashes, truncate
    const sanitize = (s: unknown, maxLen = 500) =>
      typeof s === 'string' ? s.trim().slice(0, maxLen).replace(/[`\\]/g, '') : '';

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
7. ai_feedback: be honest and direct, like a real coach. Point out weak answers specifically. Do NOT say "great effort" if the answers were poor.
8. Return valid JSON only, no markdown, no extra text.`;



      userPrompt = isArabic
        ? `أنت محلّل مقابلات صارم وواقعي. قيّم أداء هذا المرشح لوظيفة ${role} (تعليم: ${education}, خبرة: ${experience}).

إجاباته الفعلية:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. السؤال: ${q.question}\nالإجابة: "${q.answer || '(لم يُقدِّم إجابة)'}"`).join('\n\n')}

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
5. احسب كلمات الحشو الفعلية فقط من نص الإجابات (يعني، اممم، آه، طيب، صراحة).
6. اكتب إجابة مثالية لكل سؤال بالعربية بمنهج STAR مناسبة لمستوى ${experience} في ${role}.

أعد JSON فقط، جميع القيم يجب أن تعكس الإجابات الفعلية:
{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"pace_wpm":110,"filler_words":[{"word":"يعني","count":4}],"long_pauses":3,"strengths":["نقطة قوة حقيقية مدعومة بالإجابات أو الجملة الثابتة إذا لم توجد"],"improvements":["تحسين محدد مبني على ضعف فعلي في الإجابة 1","تحسين محدد 2","تحسين محدد 3"],"ai_feedback":"تغذية راجعة صريحة وصادقة كمدرب مقابلات حقيقي، تشير إلى الإجابات الضعيفة بالتحديد.","recommendations":[{"title":"توصية محددة 1","description":"نصيحة عملية 1"},{"title":"توصية محددة 2","description":"نصيحة عملية 2"},{"title":"توصية محددة 3","description":"نصيحة عملية 3"}],"ideal_answers":[{"question":"نص السؤال 1","ideal_answer":"إجابة مثالية بمنهج STAR"},{"question":"نص السؤال 2","ideal_answer":"إجابة مثالية"},{"question":"نص السؤال 3","ideal_answer":"إجابة مثالية"},{"question":"نص السؤال 4","ideal_answer":"إجابة مثالية"},{"question":"نص السؤال 5","ideal_answer":"إجابة مثالية"}]}`
        : `You are a strict, realistic interview coach evaluating a candidate for a ${role} role (Education: ${education}, Experience: ${experience}).

Candidate's actual answers:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. Q: ${q.question}\n   A: "${q.answer || '(no answer given)'}"`).join('\n\n')}

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
5. Count REAL filler words from text. Do NOT copy example counts.
6. Write a professional ideal answer for each question using STAR, tailored to ${experience}-level ${role}.
7. ai_feedback: be direct and honest like a real coach. Name the weak answers specifically. Do NOT pad with generic praise.

Return ONLY valid JSON, all values must reflect actual answer quality:
{"overall_score":35,"communication":30,"confidence":25,"answer_quality":20,"pace_wpm":120,"filler_words":[{"word":"um","count":3}],"long_pauses":2,"strengths":["Genuine strength from answers, or the fixed message if none"],"improvements":["Specific improvement tied to weak answer 1","Specific improvement 2","Specific improvement 3"],"ai_feedback":"Direct, honest coaching feedback naming which answers were weak and why.","recommendations":[{"title":"Specific recommendation 1","description":"Practical advice 1"},{"title":"Specific recommendation 2","description":"Practical advice 2"},{"title":"Specific recommendation 3","description":"Practical advice 3"}],"ideal_answers":[{"question":"Actual Q1 text","ideal_answer":"STAR ideal answer for Q1"},{"question":"Actual Q2 text","ideal_answer":"Ideal answer for Q2"},{"question":"Actual Q3 text","ideal_answer":"Ideal answer for Q3"},{"question":"Actual Q4 text","ideal_answer":"Ideal answer for Q4"},{"question":"Actual Q5 text","ideal_answer":"Ideal answer for Q5"}]}`;

    } else if (mode === 'presentation') {
      const topic = sanitize(body.topic, 200);
      const transcript = sanitize(body.transcript, 8000);

      if (!transcript || transcript.trim().length < 10) {
        return new Response(
          JSON.stringify({ error: 'No presentation content to analyze. Please record your presentation first.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      systemPrompt = 'You are an expert presentation coach and analyst. Analyze the speaker\'s actual transcript carefully and return valid JSON only, no markdown, no extra text. Base ALL scores on the real content of what was said.';

      userPrompt = isArabic
        ? `قيّم هذا العرض التقديمي الفعلي حول: "${topic}"

النص الكامل للعرض:
"${transcript}"

حلّل المحتوى الفعلي: البنية، الوضوح، الثقة، وتيرة الكلام، كلمات الحشو، الفاعلية.
أعد JSON فقط:
{"overall_score":0,"confidence":0,"pace_wpm":0,"structure":0,"communication_effectiveness":0,"ai_feedback":"تقييم مخصص.","recommendations":[{"title":"عنوان1","description":"وصف1"},{"title":"عنوان2","description":"وصف2"},{"title":"عنوان3","description":"وصف3"}]}`
        : `Evaluate this ACTUAL presentation on: "${topic}"

Full transcript:
"${transcript}"

Analyze real content: structure, clarity, confidence, speaking pace (estimate WPM), filler words, communication effectiveness.
Return ONLY valid JSON:
{"overall_score":0,"confidence":0,"pace_wpm":0,"structure":0,"communication_effectiveness":0,"ai_feedback":"Personalized 2-3 sentence feedback based on the actual transcript.","recommendations":[{"title":"Title1","description":"Description1"},{"title":"Title2","description":"Description2"},{"title":"Title3","description":"Description3"}]}`;

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
