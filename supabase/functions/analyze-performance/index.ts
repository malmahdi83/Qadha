import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENROUTER_API_KEY = Deno.env.get('whisper-large-v3') ?? '';
const MODEL = 'openai/gpt-4o-mini';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { mode, lang } = body;

    if (!mode || !lang) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: mode, lang' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isArabic = lang === 'ar';
    let systemPrompt: string;
    let userPrompt: string;

    if (mode === 'interview') {
      const { questions, role, education, experience } = body;

      systemPrompt = `You are an expert interview performance analyst and coach. Analyze the candidate's actual answers carefully and return valid JSON only, no markdown, no extra text. Base ALL scores on the real content of the answers provided. Also generate a professional ideal answer for each question tailored to the candidate's role, education, and experience level — using the STAR method where appropriate.`;

      userPrompt = isArabic
        ? `قيّم أداء المرشح بدقة في مقابلة وظيفة ${role} (تعليم: ${education}, خبرة: ${experience}).

حلّل إجاباته الفعلية بعناية:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. السؤال: ${q.question}\nالإجابة: ${q.answer || '(لم تُقدّم إجابة)'}`).join('\n\n')}

تعليمات التقييم:
- احسب كلمات الحشو الفعلية من نص الإجابات (مثل: يعني، اممم، آه، طيب، صراحة، في الحقيقة). ضع العدد الحقيقي الذي وجدته في النص، وليس أرقامًا عشوائية.
- قيّم الدرجات بناءً على المحتوى الفعلي فقط.
- اكتب إجابة مثالية لكل سؤال بالعربية تناسب مستوى ${experience} في ${role} وتستخدم منهج STAR عند الاقتضاء.

أعد JSON فقط بهذا الشكل (استبدل كل القيم بالبيانات الحقيقية):
{"overall_score":85,"communication":80,"confidence":75,"answer_quality":82,"pace_wpm":120,"filler_words":[{"word":"يعني","count":5},{"word":"اممم","count":8}],"long_pauses":2,"strengths":["نقطة قوة حقيقية 1","نقطة قوة حقيقية 2","نقطة قوة حقيقية 3"],"improvements":["مجال تحسين حقيقي 1","مجال تحسين حقيقي 2","مجال تحسين حقيقي 3"],"ai_feedback":"تغذية راجعة مخصصة بناءً على الإجابات الفعلية.","recommendations":[{"title":"عنوان توصية 1","description":"وصف التوصية 1"},{"title":"عنوان توصية 2","description":"وصف التوصية 2"},{"title":"عنوان توصية 3","description":"وصف التوصية 3"}],"ideal_answers":[{"question":"نص السؤال الأول","ideal_answer":"الإجابة المثالية باستخدام STAR"},{"question":"نص السؤال الثاني","ideal_answer":"الإجابة المثالية"},{"question":"نص السؤال الثالث","ideal_answer":"الإجابة المثالية"},{"question":"نص السؤال الرابع","ideal_answer":"الإجابة المثالية"},{"question":"نص السؤال الخامس","ideal_answer":"الإجابة المثالية"}]}`
        : `Evaluate this candidate's ACTUAL performance for a ${role} role (Education: ${education}, Experience: ${experience}).

Carefully analyze the real content of each answer:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. Q: ${q.question}\n   A: ${q.answer || '(no answer given)'}`).join('\n\n')}

Instructions:
- Count REAL filler words from the actual answer text (um, uh, like, you know, basically, actually, so, right). Put the REAL count you found — do NOT copy example numbers.
- Score based on ACTUAL content only.
- Write a professional ideal answer for each question tailored to a ${experience}-level ${role} candidate using STAR method where appropriate.

Return ONLY valid JSON, replacing ALL values with real data:
{"overall_score":85,"communication":80,"confidence":75,"answer_quality":82,"pace_wpm":130,"filler_words":[{"word":"um","count":6},{"word":"like","count":4}],"long_pauses":2,"strengths":["Real strength 1","Real strength 2","Real strength 3"],"improvements":["Real improvement area 1","Real improvement area 2","Real improvement area 3"],"ai_feedback":"Personalized feedback based on actual answers.","recommendations":[{"title":"Real recommendation 1","description":"Specific advice 1"},{"title":"Real recommendation 2","description":"Specific advice 2"},{"title":"Real recommendation 3","description":"Specific advice 3"}],"ideal_answers":[{"question":"Actual question 1 text","ideal_answer":"Ideal STAR answer for question 1"},{"question":"Actual question 2 text","ideal_answer":"Ideal answer for question 2"},{"question":"Actual question 3 text","ideal_answer":"Ideal answer for question 3"},{"question":"Actual question 4 text","ideal_answer":"Ideal answer for question 4"},{"question":"Actual question 5 text","ideal_answer":"Ideal answer for question 5"}]}`;

    } else if (mode === 'presentation') {
      const { topic, transcript } = body;

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
        JSON.stringify({ error: 'AI service error', detail: err }),
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
