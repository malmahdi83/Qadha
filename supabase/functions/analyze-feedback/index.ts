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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Verify admin role
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (!profile || profile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const feedbackText = typeof body.feedback === 'string' ? body.feedback.slice(0, 12000) : '';
    const count = typeof body.count === 'number' ? body.count : 0;

    if (!feedbackText || count === 0) {
      return new Response(JSON.stringify({ summary: 'No feedback data to analyse.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = `You are a senior Product Manager analysing beta user feedback for Qadha, an AI-powered interview and presentation coaching app. Write a structured, executive-level product analysis report.

Your report must include these sections:
1. Overall User Satisfaction
2. Most Appreciated Features
3. Most Requested Improvements
4. Most Reported Issues
5. Positive Trends
6. Negative Trends
7. Suggested Development Priorities (ranked)

Be specific. Reference actual feedback patterns. Use a professional PM tone. Keep the report under 600 words.`;

    const userPrompt = `Analyse the following ${count} beta feedback submissions and generate a PM report:\n\n${feedbackText}`;

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
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content ?? 'No summary generated.';

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('analyze-feedback error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
