import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENROUTER_API_KEY = Deno.env.get('whisper-large-v3') ?? '';
const MODEL = 'anthropic/claude-opus-4';
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

    // Allowlist-validate enumerated fields; truncate free-text role to 60 chars
    const VALID_EDUCATION = ['high_school', 'bachelor', 'master', 'phd', 'other'];
    const VALID_EXPERIENCE = ['intern', 'junior', 'mid', 'senior', 'lead', 'other'];
    const VALID_LANG = ['en', 'ar'];

    const rawRole = typeof body.role === 'string' ? body.role.trim().slice(0, 60).replace(/[`"\\]/g, '') : '';
    const education = VALID_EDUCATION.includes(body.education) ? body.education : '';
    const experience = VALID_EXPERIENCE.includes(body.experience) ? body.experience : '';
    const lang = VALID_LANG.includes(body.lang) ? body.lang : '';
    const role = rawRole;

    if (!role || !education || !experience || !lang) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isArabic = lang === 'ar';

    const systemPrompt = 'You are an expert AI interview coach. Respond with valid JSON only, no markdown, no extra text.';

    const userPrompt = isArabic
      ? `أنشئ 5 أسئلة مقابلة باللغة العربية لمتقدم لوظيفة ${role} (تعليم: ${education}, خبرة: ${experience}).\nنوّع بين: تعريفي وسلوكي وموقفي وتقني ومهني.\nأجب بـ JSON فقط: {"questions":["q1","q2","q3","q4","q5"]}`
      : `Generate 5 tailored interview questions in English for a ${role} candidate (Education: ${education}, Experience: ${experience}).\nMix behavioral, situational, and technical questions. Calibrate difficulty to experience level.\nReply with ONLY this JSON: {"questions":["q1","q2","q3","q4","q5"]}`;

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
        temperature: 0.7,
        max_tokens: 1024,
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

    let parsed: { questions: string[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { questions: [] };
    }

    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return new Response(
        JSON.stringify({ error: 'AI returned no questions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ questions: parsed.questions.slice(0, 5) }),
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
