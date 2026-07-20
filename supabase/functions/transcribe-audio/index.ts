import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const ALLOWED_ORIGINS = [
  'https://qadha-gules.vercel.app',
  'http://localhost:3000',
];

// Rate limit: 20 transcriptions per user per 10 minutes
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
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

async function extractUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  console.log('[auth] header present:', !!auth, '| starts with Bearer:', auth.startsWith('Bearer '));
  if (!auth.startsWith('Bearer ')) return null;

  // Use Supabase auth.getUser() — reliable, no manual JWT decoding
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  console.log('[auth] getUser result — user:', user?.id ?? 'null', '| error:', error?.message ?? 'none');
  return user?.id ?? null;
}

// Minimum gap in seconds between transcript segments to count as a long pause
const PAUSE_THRESHOLD_SECS = 2.0;

interface Segment {
  start: number;
  end: number;
}

function computePauseMetrics(segments: Segment[]): {
  pauseCount: number;
  avgPauseDuration: number;
  longestPauseDuration: number;
} {
  const longPauses: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    const gap = segments[i].start - segments[i - 1].end;
    if (gap >= PAUSE_THRESHOLD_SECS) {
      longPauses.push(parseFloat(gap.toFixed(2)));
    }
  }
  const pauseCount = longPauses.length;
  const avgPauseDuration = pauseCount > 0
    ? parseFloat((longPauses.reduce((a, b) => a + b, 0) / pauseCount).toFixed(2))
    : 0;
  const longestPauseDuration = pauseCount > 0
    ? parseFloat(Math.max(...longPauses).toFixed(2))
    : 0;
  return { pauseCount, avgPauseDuration, longestPauseDuration };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const userId = await extractUserId(req);
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!checkRateLimit(userId)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please wait before transcribing again.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' } }
      );
    }

    if (!GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Transcription service is not configured.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const form = await req.formData();
    const audio = form.get('audio') as File | null;
    const rawLang = (form.get('lang') as string) ?? 'en';
    const lang = rawLang === 'ar' ? 'ar' : 'en';

    if (!audio) {
      return new Response(
        JSON.stringify({ error: 'Missing audio file' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ALLOWED_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/x-m4a'];
    const mimeBase = (audio.type || '').split(';')[0].trim().toLowerCase();
    if (mimeBase && !ALLOWED_MIME.some(m => mimeBase.startsWith(m.split('/')[0]) && mimeBase.includes('audio'))) {
      return new Response(
        JSON.stringify({ error: 'Invalid file type. Only audio files are accepted.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
    // Do NOT append 'language' — Whisper auto-detects the spoken language.
    // Forcing it to the interview language causes Whisper to translate instead of transcribe.
    outForm.append('response_format', 'verbose_json');

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: outForm,
      signal: AbortSignal.timeout(30000), // 30s — Groq is typically <5s; fail fast if hung
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
    const transcript = (data.text ?? '').trim();
    const segments: Segment[] = Array.isArray(data.segments) ? data.segments : [];

    // Groq verbose_json includes a top-level 'language' field with the ISO 639-1 code
    // that Whisper auto-detected from the audio (e.g. 'ar', 'en', 'fr').
    const groqLang = typeof data.language === 'string' ? data.language.toLowerCase().trim() : '';
    let detectedLanguage: 'ar' | 'en' | 'mixed' | 'unknown';
    if (groqLang === 'ar' || groqLang === 'arabic') detectedLanguage = 'ar';
    else if (groqLang === 'en' || groqLang === 'english') detectedLanguage = 'en';
    else if (groqLang) detectedLanguage = 'unknown'; // other language (not ar or en)
    else detectedLanguage = 'unknown';

    const { pauseCount, avgPauseDuration, longestPauseDuration } = computePauseMetrics(segments);

    return new Response(
      JSON.stringify({ transcript, detectedLanguage, pauseCount, avgPauseDuration, longestPauseDuration }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.error(isTimeout ? 'Groq timeout' : 'Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: isTimeout
        ? 'Transcription timed out. Please try again with a shorter recording.'
        : 'Internal server error' }),
      { status: isTimeout ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
