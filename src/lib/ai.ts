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
