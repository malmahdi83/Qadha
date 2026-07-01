import { createClient } from './supabase';

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL + '/functions/v1';

async function callEdge<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const res = await fetch(`${BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Edge function ${name} failed: ${err}`);
  }
  return res.json() as Promise<T>;
}

async function getAuthToken(): Promise<string> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
}

export interface GenerateQuestionsParams {
  role: string;
  education: string;
  experience: string;
  lang: string;
}

export async function generateQuestions(params: GenerateQuestionsParams): Promise<string[]> {
  const data = await callEdge<{ questions: string[] }>('generate-questions', params as unknown as Record<string, unknown>);
  return data.questions;
}

export interface AnalyzeInterviewParams {
  mode: 'interview';
  lang: string;
  role: string;
  education: string;
  experience: string;
  questions: { question: string; answer: string }[];
}

export interface AnalyzePresentationParams {
  mode: 'presentation';
  lang: string;
  topic: string;
  transcript: string;
}

export async function analyzePerformance<T>(
  params: AnalyzeInterviewParams | AnalyzePresentationParams
): Promise<T> {
  return callEdge<T>('analyze-performance', params as unknown as Record<string, unknown>);
}

export interface SessionRow {
  id?: string;
  mode: 'interview' | 'presentation';
  lang: string;
  role?: string;
  topic?: string;
  education?: string;
  experience?: string;
  questions?: unknown;
  answers?: unknown;
  transcript?: string;
  score_overall?: number;
  score_communication?: number;
  score_confidence?: number;
  score_quality?: number;
  score_structure?: number;
  score_comm_effectiveness?: number;
  pace_wpm?: number;
  filler_words?: unknown;
  long_pauses?: number;
  ai_feedback?: string;
  strengths?: unknown;
  improvements?: unknown;
  recommendations?: unknown;
  ideal_answers?: unknown;
  created_at?: string;
}

export async function saveSession(row: SessionRow): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('sessions').insert(row).select('id').single();
  if (error) { console.error('saveSession error:', error); return null; }
  return data?.id ?? null;
}

export async function getSessions(): Promise<SessionRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('getSessions error:', error); return []; }
  return (data ?? []) as SessionRow[];
}

export async function fetchTTSAudio(text: string): Promise<Blob> {
  const token = await getAuthToken();
  const res = await fetch(`${BASE}/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`TTS failed: ${await res.text()}`);
  }
  return res.blob();
}

export async function transcribeAudio(blob: Blob, lang: string): Promise<string> {
  const token = await getAuthToken();
  const form = new FormData();
  form.append('audio', blob, 'recording.webm');
  form.append('lang', lang);

  const res = await fetch(`${BASE}/transcribe-audio`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transcription failed: ${err}`);
  }
  const data = await res.json() as { transcript: string };
  return data.transcript ?? '';
}
