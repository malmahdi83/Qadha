import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam — free tier, eleven_multilingual_v2
const MODEL_ID = 'eleven_multilingual_v2';

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
    // Fail fast with a clear message if the secret is missing
    if (!ELEVENLABS_API_KEY) {
      console.error('ELEVENLABS_API_KEY secret is not set');
      return new Response(
        JSON.stringify({ error: 'ELEVENLABS_API_KEY secret is not configured in Supabase Edge Function secrets' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { text } = await req.json();

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing or empty text' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error(`ElevenLabs ${response.status} (key_len=${ELEVENLABS_API_KEY.length}):`, err);
      return new Response(
        JSON.stringify({ error: 'ElevenLabs API error', status: response.status, key_len: ELEVENLABS_API_KEY.length, detail: err }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });

  } catch (err) {
    console.error('TTS unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
