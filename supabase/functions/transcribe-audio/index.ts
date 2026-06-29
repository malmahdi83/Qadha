import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENROUTER_API_KEY = Deno.env.get('whisper-large-v3') ?? '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';

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
    const form = await req.formData();
    const audio = form.get('audio') as File | null;
    const lang = (form.get('lang') as string) ?? 'en';

    if (!audio) {
      return new Response(
        JSON.stringify({ error: 'Missing audio file' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioBytes = new Uint8Array(await audio.arrayBuffer());
    const language = lang === 'ar' ? 'ar' : 'en';
    const filename = audio.name || 'recording.webm';
    const mimeType = audio.type || 'audio/webm';

    // Manually build multipart/form-data body for maximum compatibility
    const boundary = 'qadha' + Math.random().toString(36).slice(2);
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];

    const addField = (name: string, value: string) => {
      parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    };

    // model field
    addField('model', 'openai/whisper-large-v3');
    // language field
    addField('language', language);
    // file field
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
    parts.push(audioBytes);
    parts.push(enc.encode(`\r\n--${boundary}--\r\n`));

    const totalLen = parts.reduce((s, p) => s + p.length, 0);
    const body = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) { body.set(p, offset); offset += p.length; }

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Whisper error:', err);
      return new Response(
        JSON.stringify({ error: 'Transcription failed', detail: err }),
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
