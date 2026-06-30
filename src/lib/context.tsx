'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Lang } from './i18n';

export interface InterviewResults {
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

export interface PresentationResults {
  overall_score: number;
  confidence: number;
  pace_wpm: number;
  structure: number;
  communication_effectiveness: number;
  ai_feedback: string;
  recommendations: { title: string; description: string }[];
}

interface AppState {
  lang: Lang;
  theme: 'light' | 'dark';
  setLang: (l: Lang) => void;
  toggleTheme: () => void;
  // Interview setup
  role: string;
  education: string;
  experience: string;
  intLang: Lang;
  setRole: (v: string) => void;
  setEducation: (v: string) => void;
  setExperience: (v: string) => void;
  setIntLang: (v: Lang) => void;
  // AI-generated questions & answers
  questions: string[];
  setQuestions: (q: string[]) => void;
  answers: string[];
  setAnswer: (index: number, answer: string) => void;
  // Results
  interviewResults: InterviewResults | null;
  setInterviewResults: (r: InterviewResults | null) => void;
  presResults: PresentationResults | null;
  setPresResults: (r: PresentationResults | null) => void;
  // Presentation
  topic: string;
  setTopic: (v: string) => void;
  presTranscript: string;
  setPresTranscript: (v: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [role, setRole] = useState('dev');
  const [education, setEducation] = useState('bachelor');
  const [experience, setExperience] = useState('junior');
  const [intLang, setIntLang] = useState<Lang>('en');
  const [topic, setTopic] = useState('');
  const [presTranscript, setPresTranscript] = useState('');
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswersState] = useState<string[]>(['', '', '', '', '']);
  const [interviewResults, setInterviewResults] = useState<InterviewResults | null>(null);
  const [presResults, setPresResults] = useState<PresentationResults | null>(null);

  useEffect(() => {
    const savedLang = localStorage.getItem('qadha-lang') as Lang | null;
    const savedTheme = localStorage.getItem('qadha-theme') as 'light' | 'dark' | null;
    if (savedLang) setLangState(savedLang);
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    localStorage.setItem('qadha-lang', lang);
  }, [lang]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('qadha-theme', theme);
  }, [theme]);

  const setLang = (l: Lang) => setLangState(l);
  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  const setAnswer = (index: number, answer: string) => {
    setAnswersState(prev => { const n = [...prev]; n[index] = answer; return n; });
  };

  return (
    <AppContext.Provider value={{
      lang, theme, setLang, toggleTheme,
      role, education, experience, intLang,
      setRole, setEducation, setExperience, setIntLang,
      topic, setTopic,
      presTranscript, setPresTranscript,
      questions, setQuestions,
      answers, setAnswer,
      interviewResults, setInterviewResults,
      presResults, setPresResults,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
