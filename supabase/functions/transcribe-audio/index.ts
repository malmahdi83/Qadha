import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

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
    if (!GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GROQ_API_KEY secret is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const form = await req.formData();
    const audio = form.get('audio') as File | null;
    const lang = (form.get('lang') as string) ?? 'en';

    if (!audio) {
      return new Response(
        JSON.stringify({ error: 'Missing audio file' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate MIME type — only accept audio formats Groq supports
    const ALLOWED_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/x-m4a'];
    const mimeBase = (audio.type || '').split(';')[0].trim().toLowerCase();
    if (mimeBase && !ALLOWED_MIME.some(m => mimeBase.startsWith(m.split('/')[0]) && mimeBase.includes('audio'))) {
      return new Response(
        JSON.stringify({ error: 'Invalid file type. Only audio files are accepted.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Groq Whisper limit is 25 MB; reject early with a clear message
    const MAX_BYTES = 25 * 1024 * 1024;
    if (audio.size > MAX_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Audio file too large. Maximum recording size is 25 MB.' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const outForm = new FormData();
    outForm.append('file', audio, audio.name || 'recording.webm');
    outForm.append('model', 'whisper-large-v3');
    outForm.append('language', lang === 'ar' ? 'ar' : 'en');
    outForm.append('response_format', 'json');

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: outForm,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Groq Whisper error:', err);
      return new Response(
        JSON.stringify({ error: 'Transcription service temporarily unavailable. Please try again.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const transcript = data.text ?? '';

    return new Response(
      JSON.stringify({ transcript }),
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
