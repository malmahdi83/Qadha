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

قيّم بناءً على المحتوى الفعلي، واكتب إجابة مثالية لكل سؤال بالعربية تناسب مستوى ${experience} في ${role} وتستخدم منهج STAR عند الاقتضاء.

أعد JSON فقط:
{"overall_score":0,"communication":0,"confidence":0,"answer_quality":0,"pace_wpm":0,"filler_words":[{"word":"كلمة","count":0}],"long_pauses":0,"strengths":["نقطة1","نقطة2","نقطة3"],"improvements":["تحسين1","تحسين2","تحسين3"],"ai_feedback":"تقييم شامل مخصص.","recommendations":[{"title":"عنوان1","description":"وصف1"},{"title":"عنوان2","description":"وصف2"},{"title":"عنوان3","description":"وصف3"}],"ideal_answers":[{"question":"السؤال الأول","ideal_answer":"الإجابة المثالية باستخدام STAR"},{"question":"السؤال الثاني","ideal_answer":"الإجابة المثالية"},{"question":"السؤال الثالث","ideal_answer":"الإجابة المثالية"},{"question":"السؤال الرابع","ideal_answer":"الإجابة المثالية"},{"question":"السؤال الخامس","ideal_answer":"الإجابة المثالية"}]}`
        : `Evaluate this candidate's ACTUAL performance for a ${role} role (Education: ${education}, Experience: ${experience}).

Carefully analyze the real content of each answer:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. Q: ${q.question}\n   A: ${q.answer || '(no answer given)'}`).join('\n\n')}

Score based on ACTUAL content. Count real filler words. Assess STAR methodology usage, relevance, and depth. Also write a professional ideal answer for each question in English, tailored to a ${experience}-level ${role} candidate, using STAR method where appropriate.

Return ONLY valid JSON:
{"overall_score":0,"communication":0,"confidence":0,"answer_quality":0,"pace_wpm":0,"filler_words":[{"word":"um","count":0}],"long_pauses":0,"strengths":["real strength 1","real strength 2","real strength 3"],"improvements":["real area 1","real area 2","real area 3"],"ai_feedback":"Personalized 2-3 sentence feedback based on the actual answers.","recommendations":[{"title":"Title1","description":"Description1"},{"title":"Title2","description":"Description2"},{"title":"Title3","description":"Description3"}],"ideal_answers":[{"question":"Question 1 text","ideal_answer":"Ideal answer using STAR where appropriate"},{"question":"Question 2 text","ideal_answer":"Ideal answer"},{"question":"Question 3 text","ideal_answer":"Ideal answer"},{"question":"Question 4 text","ideal_answer":"Ideal answer"},{"question":"Question 5 text","ideal_answer":"Ideal answer"}]}`;

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
