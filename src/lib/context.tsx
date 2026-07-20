'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Lang } from './i18n';
import type { QuestionMetrics } from './ai';

export type { QuestionMetrics };

export type InterviewExperienceMode = 'real' | 'assisted';

export interface InterviewResults {
  overall_score: number;
  communication: number;
  confidence: number;
  answer_quality: number;
  strengths: string[];
  improvements: string[];
  ai_feedback: string;
  recommendations: { title: string; description: string }[];
  ideal_answers?: { question: string; ideal_answer: string }[];
}

export interface PresentationResults {
  overall_score: number;
  confidence: number;
  structure: number;
  communication_effectiveness: number;
  ai_feedback: string;
  recommendations: { title: string; description: string }[];
  // NEW optional fields:
  strengths?: string[];
  improvements?: string[];
  score_reasons?: {
    confidence?: string;
    structure?: string;
    communication_effectiveness?: string;
  };
  structure_review?: {
    opening: { score: number; feedback: string; suggestions: string };
    body: { score: number; feedback: string; suggestions: string };
    transitions: { score: number; feedback: string; suggestions: string };
    conclusion: { score: number; feedback: string; suggestions: string };
  };
  content_only?: boolean;
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
  lastQuestions: string[];
  setQuestions: (q: string[]) => void;
  answers: string[];
  setAnswer: (index: number, answer: string) => void;
  // Per-question speech metrics (real data from recordings)
  answerMetrics: (QuestionMetrics | null)[];
  setAnswerMetrics: (index: number, metrics: QuestionMetrics) => void;
  // Content-only evaluation flags (true = language mismatch, user chose content-only)
  contentOnlyAnswers: boolean[];
  setContentOnly: (index: number, value: boolean) => void;
  // Results
  interviewResults: InterviewResults | null;
  setInterviewResults: (r: InterviewResults | null) => void;
  presResults: PresentationResults | null;
  setPresResults: (r: PresentationResults | null) => void;
  // Interview experience mode
  interviewMode: InterviewExperienceMode;
  setInterviewMode: (m: InterviewExperienceMode) => void;
  // Reset
  resetInterview: () => void;
  // Presentation
  topic: string;
  setTopic: (v: string) => void;
  presTranscript: string;
  setPresTranscript: (v: string) => void;
  presSpeechMetrics: QuestionMetrics | null;
  setPresSpeechMetrics: (m: QuestionMetrics | null) => void;
  presContentOnly: boolean;
  setPresContentOnly: (v: boolean) => void;
  presSessionId: string | null;
  setPresSessionId: (id: string | null) => void;
  resetPresentation: () => void;
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
  const [questions, setQuestionsState] = useState<string[]>([]);
  const [lastQuestions, setLastQuestionsState] = useState<string[]>([]);
  const [interviewMode, setInterviewMode] = useState<InterviewExperienceMode>('assisted');
  const [answers, setAnswersState] = useState<string[]>(['', '', '', '', '']);
  const [answerMetrics, setAnswerMetricsState] = useState<(QuestionMetrics | null)[]>([null, null, null, null, null]);
  const [contentOnlyAnswers, setContentOnlyAnswersState] = useState<boolean[]>([false, false, false, false, false]);
  const [interviewResults, setInterviewResults] = useState<InterviewResults | null>(null);
  const [presResults, setPresResults] = useState<PresentationResults | null>(null);
  const [presSpeechMetrics, setPresSpeechMetrics] = useState<QuestionMetrics | null>(null);
  const [presContentOnly, setPresContentOnly] = useState(false);
  const [presSessionId, setPresSessionId] = useState<string | null>(null);

  useEffect(() => {
    const savedLang = localStorage.getItem('qadha-lang') as Lang | null;
    const savedTheme = localStorage.getItem('qadha-theme') as 'light' | 'dark' | null;
    if (savedLang) setLangState(savedLang);
    if (savedTheme) setTheme(savedTheme);
    try {
      const saved = localStorage.getItem('qadha-last-questions');
      if (saved) setLastQuestionsState(JSON.parse(saved));
    } catch { /* ignore */ }
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

  const setAnswerMetrics = (index: number, metrics: QuestionMetrics) => {
    setAnswerMetricsState(prev => { const n = [...prev]; n[index] = metrics; return n; });
  };

  const setContentOnly = (index: number, value: boolean) => {
    setContentOnlyAnswersState(prev => { const n = [...prev]; n[index] = value; return n; });
  };

  const setQuestions = (q: string[]) => setQuestionsState(q);

  const resetPresentation = () => {
    setTopic('');
    setPresTranscript('');
    setPresResults(null);
    setPresSpeechMetrics(null);
    setPresContentOnly(false);
    setPresSessionId(null);
  };

  const resetInterview = () => {
    if (questions.length > 0) {
      setLastQuestionsState(questions);
      try { localStorage.setItem('qadha-last-questions', JSON.stringify(questions)); } catch { /* ignore */ }
    }
    setQuestionsState([]);
    setAnswersState(['', '', '', '', '']);
    setAnswerMetricsState([null, null, null, null, null]);
    setContentOnlyAnswersState([false, false, false, false, false]);
    setInterviewResults(null);
  };

  return (
    <AppContext.Provider value={{
      lang, theme, setLang, toggleTheme,
      role, education, experience, intLang,
      setRole, setEducation, setExperience, setIntLang,
      topic, setTopic,
      presTranscript, setPresTranscript,
      presSpeechMetrics, setPresSpeechMetrics,
      questions, lastQuestions, setQuestions,
      interviewMode, setInterviewMode,
      answers, setAnswer,
      answerMetrics, setAnswerMetrics,
      contentOnlyAnswers, setContentOnly,
      interviewResults, setInterviewResults,
      presResults, setPresResults,
      resetInterview,
      presContentOnly, setPresContentOnly,
      presSessionId, setPresSessionId,
      resetPresentation,
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
