import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENROUTER_API_KEY = Deno.env.get('whisper-large-v3') ?? '';
const MODEL = 'openai/gpt-4o-mini';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface AnalysisResult {
  overall_score: number;
  communication: number;
  confidence: number;
  answer_quality: number;
  pace_wpm: number;
  filler_words: { word: string; count: number }[];
  long_pauses: number;
  strengths: string[];
  improvements: string[];
  ai_feedback: string;
  recommendations: { title: string; description: string }[];
}

interface PresentationResult {
  overall_score: number;
  confidence: number;
  pace_wpm: number;
  structure: number;
  communication_effectiveness: number;
  ai_feedback: string;
  recommendations: { title: string; description: string }[];
}

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

      systemPrompt = 'You are an expert interview performance analyst. Return valid JSON only, no markdown, no extra text.';

      userPrompt = isArabic
        ? `قيّم أداء المرشح في مقابلة وظيفة ${role} (تعليم: ${education}, خبرة: ${experience}).\nالإجابات:\n${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. ${q.question}\nإجابة: ${q.answer || '(لم تُقدّم إجابة)'}`).join('\n')}\n\nأعد JSON فقط:\n{"overall_score":75,"communication":70,"confidence":72,"answer_quality":74,"pace_wpm":130,"filler_words":[{"word":"يعني","count":2}],"long_pauses":1,"strengths":["نقطة1","نقطة2","نقطة3"],"improvements":["تحسين1","تحسين2","تحسين3"],"ai_feedback":"تقييم شامل","recommendations":[{"title":"عنوان","description":"وصف"},{"title":"عنوان","description":"وصف"},{"title":"عنوان","description":"وصف"}]}`
        : `Evaluate this candidate for a ${role} role (Education: ${education}, Experience: ${experience}).\nAnswers:\n${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. Q: ${q.question}\n   A: ${q.answer || '(no answer)'}`).join('\n')}\n\nReturn ONLY valid JSON with real evaluated values:\n{"overall_score":75,"communication":70,"confidence":72,"answer_quality":74,"pace_wpm":130,"filler_words":[{"word":"um","count":2},{"word":"like","count":3}],"long_pauses":2,"strengths":["strength1","strength2","strength3"],"improvements":["improvement1","improvement2","improvement3"],"ai_feedback":"Your personalized 2-3 sentence feedback here.","recommendations":[{"title":"Title1","description":"Description1"},{"title":"Title2","description":"Description2"},{"title":"Title3","description":"Description3"}]}`;

    } else if (mode === 'presentation') {
      const { topic } = body;

      systemPrompt = 'You are a presentation performance analyst. Return valid JSON only, no markdown, no extra text.';

      userPrompt = isArabic
        ? `قيّم عرضاً تقديمياً حول: "${topic}"\nأعد JSON فقط:\n{"overall_score":75,"confidence":70,"pace_wpm":130,"structure":72,"communication_effectiveness":74,"ai_feedback":"تقييم شامل","recommendations":[{"title":"عنوان","description":"وصف"},{"title":"عنوان","description":"وصف"},{"title":"عنوان","description":"وصف"}]}`
        : `Evaluate a presentation on: "${topic}"\nReturn ONLY valid JSON with real evaluated values:\n{"overall_score":75,"confidence":70,"pace_wpm":130,"structure":72,"communication_effectiveness":74,"ai_feedback":"Your personalized 2-3 sentence feedback here.","recommendations":[{"title":"Title1","description":"Description1"},{"title":"Title2","description":"Description2"},{"title":"Title3","description":"Description3"}]}`;

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
        max_tokens: 2048,
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

    let parsed: AnalysisResult | PresentationResult;
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
