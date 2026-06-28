import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'user' | 'admin';
  lang: 'en' | 'ar';
  created_at: string;
};

export type Session = {
  id: string;
  user_id: string;
  mode: 'interview' | 'presentation';
  role: string | null;
  topic: string | null;
  score_overall: number | null;
  created_at: string;
};
