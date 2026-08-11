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

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
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
  if (!auth.startsWith('Bearer ')) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// DETERMINISTIC SCORE AGGREGATION ENGINE
// ══════════════════════════════════════════════════════════════════════════════

// Maps LLM diagnosis status → numeric score (0–100)
function statusToScore(status: string): number | null {
  const map: Record<string, number> = {
    'Excellent':          93,
    'Very Good':          84,
    'Good':               74,
    'Acceptable':         62,
    'Partially Complete': 50,
    'Needs Improvement':  42,
    'Weak':               30,
    'Very Weak':          15,
    'Incomplete':         28,
    'Off-topic':           8,
    'Incorrect':          15,
    'Contradictory':      12,
    'Unclear':            35,
    'Missing':             3,
    'Not Applicable':   null,  // excluded from weighting
  };
  return status in map ? map[status] : null;
}

// Base dimension weights (must sum to 1.0)
const BASE_WEIGHTS: Record<string, number> = {
  relevance:            0.20,
  accuracy:             0.20,
  completeness:         0.15,
  logic_coherence:      0.15,
  specificity:          0.10,
  supporting_example:   0.10,
  communication_clarity: 0.05,
  star_structure:       0.05,
};

interface ScoreAdjustment { label: string; value: number }

interface ScoreBreakdown {
  question_scores: number[];
  average: number;
  adjustments: ScoreAdjustment[];
  final_score: number;
}

// Calculates a single question's score from its 8-dimension diagnosis.
// Handles STAR weight redistribution and score ceilings internally.
function calculateQuestionScore(
  diagnosis: Record<string, Record<string, string>>
): number {
  const weights = { ...BASE_WEIGHTS };

  // If STAR is Not Applicable, remove it — remaining weights normalise via totalWeight division
  const starStatus = diagnosis.star_structure?.status;
  if (!starStatus || starStatus === 'Not Applicable') {
    delete weights.star_structure;
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dim, weight] of Object.entries(weights)) {
    const dimData = diagnosis[dim];
    if (!dimData) continue;
    const score = statusToScore(dimData.status);
    if (score === null) continue; // Not Applicable — skip, letting others absorb its weight
    weightedSum += score * weight;
    totalWeight += weight;
  }

  let questionScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  // ── Score ceilings (hard limits for severe failures) ──────────────────────
  if (diagnosis.relevance?.status === 'Off-topic')             questionScore = Math.min(questionScore, 15);
  if (diagnosis.accuracy?.status === 'Incorrect')              questionScore = Math.min(questionScore, 30);
  if (diagnosis.logic_coherence?.status === 'Contradictory')   questionScore = Math.min(questionScore, 25);
  if (diagnosis.completeness?.status === 'Missing')            questionScore = Math.min(questionScore, 10);
  if (
    (diagnosis.completeness?.status === 'Incomplete' || diagnosis.completeness?.status === 'Partially Complete')
    && diagnosis.completeness?.severity === 'high'
  ) questionScore = Math.min(questionScore, 45);
  if (diagnosis.specificity?.status === 'Weak' && diagnosis.supporting_example?.status === 'Weak') {
    questionScore = Math.min(questionScore, 55);
  }

  return Math.max(0, Math.min(100, questionScore));
}

// Aggregates all question scores into the final interview score.
// Returns full breakdown for transparency / debugging.
function calculateInterviewScore(
  diagItems: Array<Record<string, unknown>>
): ScoreBreakdown {
  const questionScores: number[] = [];

  for (const item of diagItems) {
    const diagnosis = (item as Record<string, unknown>).diagnosis as
      Record<string, Record<string, string>> | undefined;
    if (!diagnosis) { questionScores.push(0); continue; }
    questionScores.push(calculateQuestionScore(diagnosis));
  }

  const n = questionScores.length;
  const average = n > 0
    ? Math.round(questionScores.reduce((a, b) => a + b, 0) / n)
    : 0;

  const adjustments: ScoreAdjustment[] = [];

  // ── Consistency (standard deviation) ──────────────────────────────────────
  if (n > 1) {
    const variance = questionScores.reduce((sum, s) => sum + Math.pow(s - average, 2), 0) / n;
    const stddev = Math.sqrt(variance);
    if (stddev < 10) adjustments.push({ label: 'Consistent performance across answers', value: 3 });
    else if (stddev > 30) adjustments.push({ label: 'Large score inconsistency', value: -3 });
  }

  // ── Multiple off-topic answers ─────────────────────────────────────────────
  const offTopicCount = diagItems.filter(item => {
    const d = (item as Record<string, unknown>).diagnosis as Record<string, Record<string, string>> | undefined;
    return d?.relevance?.status === 'Off-topic';
  }).length;
  if (offTopicCount >= 2) adjustments.push({ label: 'Multiple off-topic answers', value: -5 });

  // ── Repeated technical inaccuracies ───────────────────────────────────────
  const incorrectCount = diagItems.filter(item => {
    const d = (item as Record<string, unknown>).diagnosis as Record<string, Record<string, string>> | undefined;
    return d?.accuracy?.status === 'Incorrect';
  }).length;
  if (incorrectCount >= 2) adjustments.push({ label: 'Repeated technical inaccuracies', value: -5 });

  // ── Excellent communication throughout ────────────────────────────────────
  if (n >= 3) {
    const allGoodComm = diagItems.every(item => {
      const d = (item as Record<string, unknown>).diagnosis as Record<string, Record<string, string>> | undefined;
      const s = d?.communication_clarity?.status;
      return s === 'Excellent' || s === 'Very Good' || s === 'Good';
    });
    if (allGoodComm) adjustments.push({ label: 'Consistently clear communication', value: 2 });
  }

  // ── Strong supporting examples in majority of answers ─────────────────────
  const strongExampleCount = diagItems.filter(item => {
    const d = (item as Record<string, unknown>).diagnosis as Record<string, Record<string, string>> | undefined;
    const s = d?.supporting_example?.status;
    return s === 'Excellent' || s === 'Very Good';
  }).length;
  if (strongExampleCount >= Math.ceil(n * 0.6)) {
    adjustments.push({ label: 'Strong supporting examples throughout', value: 2 });
  }

  // Cap total adjustment at ±10
  const rawAdj = adjustments.reduce((sum, a) => sum + a.value, 0);
  const clampedAdj = Math.max(-10, Math.min(10, rawAdj));

  // If adjustments were clamped, annotate
  if (rawAdj !== clampedAdj) {
    adjustments.push({ label: 'Adjustment capped at ±10', value: clampedAdj - rawAdj });
  }

  const finalScore = Math.max(0, Math.min(100, average + clampedAdj));

  return { question_scores: questionScores, average, adjustments, final_score: finalScore };
}

// ── Strengths validation (prevents hallucinated positives) ────────────────────

function enforceStrengths(parsed: Record<string, unknown>, calculatedAnswerQuality: number): void {
  const diag = parsed.per_question_diagnosis;
  if (!Array.isArray(diag)) return;

  const strengths = parsed.strengths;
  if (!Array.isArray(strengths)) return;

  let anyOffTopic = false;
  let anyIncorrect = false;
  let anyStarMissing = false;

  for (const item of diag) {
    const d = (item as Record<string, unknown>)?.diagnosis as Record<string, Record<string, string>> | undefined;
    if (!d) continue;
    if (d.relevance?.status === 'Off-topic') anyOffTopic = true;
    if (d.accuracy?.status === 'Incorrect') anyIncorrect = true;
    if (d.star_structure?.status === 'Missing' || d.star_structure?.status === 'Weak') anyStarMissing = true;
  }

  const forbiddenIfOffTopic  = /answered.{0,20}question|addressed.{0,20}question|relevant|on.?topic|clear.{0,15}answer/i;
  const forbiddenIfIncorrect = /technical.{0,20}knowl|accurate|correct.{0,20}knowl|strong.{0,20}know/i;
  const forbiddenIfStarMissing = /star.{0,10}struct|structured.{0,10}respon|well.?struct/i;
  const forbiddenIfLowScore  = /excellent.{0,15}comm|great.{0,15}comm|strong.{0,15}comm/i;

  const validated = (strengths as unknown[]).filter((s) => {
    if (typeof s !== 'string') return false;
    if (anyOffTopic    && forbiddenIfOffTopic.test(s))    return false;
    if (anyIncorrect   && forbiddenIfIncorrect.test(s))   return false;
    if (anyStarMissing && forbiddenIfStarMissing.test(s)) return false;
    if (calculatedAnswerQuality < 40 && forbiddenIfLowScore.test(s)) return false;
    return true;
  });

  parsed.strengths = validated.length > 0
    ? validated
    : ['No clear strengths could be identified from the answers provided.'];
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const origin = req.headers.get('origin') ?? '';
  if (req.method !== 'OPTIONS' && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
        JSON.stringify({ error: 'Too many requests. You can analyze up to 5 sessions per hour.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' } }
      );
    }

    const body = await req.json();

    const VALID_MODE = ['interview', 'presentation'];
    const VALID_LANG = ['en', 'ar'];
    const VALID_EDUCATION = ['high_school', 'bachelor', 'master', 'phd', 'other'];
    const VALID_EXPERIENCE = ['intern', 'junior', 'mid', 'senior', 'lead', 'other'];

    const mode = VALID_MODE.includes(body.mode) ? body.mode : '';
    const lang = VALID_LANG.includes(body.lang) ? body.lang : '';

    if (!mode || !lang) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sanitize = (s: unknown, maxLen = 500) =>
      typeof s === 'string' ? s.trim().slice(0, maxLen).replace(/[`\\]/g, '') : '';

    interface FillerEntry { word: string; count: number }
    interface SpeechMetricsRaw {
      avgWpm?: number; wpm?: number;
      fillerWords?: FillerEntry[];
      pauseCount?: number; avgPauseDuration?: number;
      longestPauseDuration?: number; durationSeconds?: number;
    }
    const sm: SpeechMetricsRaw = (body.speechMetrics && typeof body.speechMetrics === 'object')
      ? body.speechMetrics as SpeechMetricsRaw : {};

    const avgWpm: number | null = typeof sm.avgWpm === 'number' ? Math.round(sm.avgWpm)
      : typeof sm.wpm === 'number' ? Math.round(sm.wpm) : null;
    const pauseCount: number | null = typeof sm.pauseCount === 'number' ? sm.pauseCount : null;
    const avgPauseDuration: number | null = typeof sm.avgPauseDuration === 'number' ? sm.avgPauseDuration : null;
    const longestPauseDuration: number | null = typeof sm.longestPauseDuration === 'number' ? sm.longestPauseDuration : null;
    const fillerWords: FillerEntry[] = Array.isArray(sm.fillerWords) ? sm.fillerWords as FillerEntry[] : [];

    const wpmLine = avgWpm !== null
      ? `- Speaking pace: ${avgWpm} WPM (ideal interview range: 120–150 WPM)`
      : '- Speaking pace: not available';
    const pauseLine = pauseCount !== null
      ? `- Long pauses (>2 s): ${pauseCount}${pauseCount > 0 && avgPauseDuration !== null ? `, avg ${avgPauseDuration.toFixed(1)} s, longest ${(longestPauseDuration ?? 0).toFixed(1)} s` : ''}`
      : '- Long pauses: not available';
    const fillerLine = fillerWords.length > 0
      ? `- Filler words detected: ${fillerWords.map((f: FillerEntry) => `"${f.word}" ×${f.count}`).join(', ')}`
      : '- Filler words: none detected';

    const speechMetricsBlock = `MEASURED SPEECH DATA (from actual audio — do NOT re-estimate):
${wpmLine}
${pauseLine}
${fillerLine}`;

    const isArabic = lang === 'ar';
    let systemPrompt: string;
    let userPrompt: string;

    // Hoisted so the post-parse retry can access them outside the mode block
    let interviewQuestions: Array<{ question: string; answer: string }> = [];
    let interviewRole = '';
    let interviewEducation = '';
    let interviewExperience = '';

    if (mode === 'interview') {
      const role = sanitize(body.role, 60);
      const education = VALID_EDUCATION.includes(body.education) ? body.education : 'unspecified';
      const experience = VALID_EXPERIENCE.includes(body.experience) ? body.experience : 'unspecified';
      interviewRole = role;
      interviewEducation = education;
      interviewExperience = experience;
      const questions = Array.isArray(body.questions)
        ? body.questions.slice(0, 5).map((q: unknown) => {
            const item = q as Record<string, unknown>;
            return { question: sanitize(item.question, 300), answer: sanitize(item.answer, 2000) };
          })
        : [];
      interviewQuestions = questions;

      const contentOnlyMask: boolean[] = Array.isArray(body.contentOnlyMask)
        ? body.contentOnlyMask.slice(0, 5).map((v: unknown) => v === true)
        : Array(questions.length).fill(false);
      const hasContentOnly = contentOnlyMask.some(Boolean);

      systemPrompt = `You are a strict, realistic interview performance analyst — like a senior hiring manager who has seen thousands of interviews. Evaluate ACTUAL answer quality only.

SCORE RANGES — use these consistently for every answer and overall score:
  Excellent:           90–100  (comprehensive, specific, STAR if behavioural, professional)
  Very Good:           80–89   (strong with minor gaps)
  Good:                70–79   (clear, relevant, some depth)
  Acceptable:          55–69   (addresses question, but lacks detail or examples)
  Partially Complete:  40–54   (core idea present, important aspects missing)
  Weak:                20–39   (very vague, wrong direction, or barely relevant)
  Very Weak:            5–19   (almost no usable content)
  No Answer:            0–5    (empty, skip, "I don't know", nonsensical)

DIMENSION WEIGHTS for computing answer_quality (must sum to 100%):
  Relevance:           20%
  Accuracy:            20%
  Completeness:        15%
  Logic & Coherence:   15%
  Specificity:         10%
  Supporting Example:  10%
  Communication:        5%
  STAR Structure:       5%  (behavioural questions only)
  → If STAR = "Not Applicable": redistribute its 5% proportionally across the other 7 dimensions.
  → Compute a weighted score per dimension using the ranges above, then average for answer_quality.
  → overall_score = weighted average of all per-question answer_quality scores.

GLOBAL RULES:
1. per_question_diagnosis is MANDATORY. You MUST return exactly one item for every interview question — no exceptions. Never omit this array. Never return an empty array. Never return fewer items than there are questions. The server scoring engine reads ONLY this array to compute final scores: if it is absent or incomplete, all scores will be zero and no per-question feedback will appear to the candidate.
2. overall_score and answer_quality: set both to 0 as placeholders only — these two fields are recalculated server-side from your diagnosis statuses. This applies ONLY to these two fields. All other fields, especially per_question_diagnosis, must be fully and honestly populated.
3. confidence (0–100): use MEASURED SPEECH DATA only. Never invent.
4. ai_feedback: direct coaching. Name specific weaknesses. No "great effort" for poor answers.
5. Return valid JSON only.
6. Your diagnosis statuses ARE the score. Be precise: a "Good" where "Weak" is correct will produce a wrong final score.

COMPLETENESS — five levels, choose the most accurate one:
  "Excellent"/"Very Good"/"Good": All expected aspects covered — definition, mechanism, example, context.
  "Acceptable":         Core concept addressed; 1 minor expected element missing (e.g. a supporting example).
  "Partially Complete": Core idea present but one or more KEY aspects missing (HOW, specifics, outcome, terminology).
                        Use this when the skeleton of an answer exists but critical detail is absent.
  "Needs Improvement":  Main topic touched at a surface level only; most expected depth is missing.
  "Incomplete":         Only a fragment present; major aspects entirely absent; answer is very thin.
  "Missing":            No relevant content at all → 0–10.

  CALIBRATION RULES (do not collapse these levels):
  • "HR should follow company policies" for a question about employment law → Incomplete (no legislation named).
  • "I would use analytics to improve retention" → Partially Complete (idea present, HOW missing).
  • "I used Salesforce to track 3 KPIs and reduced churn 12%" → Acceptable or Good (clear, specific, but context thin).
  • Never use "Incomplete" when the candidate's core direction is correct but needs more depth — use "Partially Complete" or "Needs Improvement" instead.

DIMENSION CALIBRATION:

  Relevance:
    Off-topic:          Answer addresses a different topic entirely → ceiling 15
    Partially Relevant: Tangentially related but misses the core question → 35–54
    Relevant:           Addresses the actual question → 55–100 (no penalty)

  Accuracy — five levels, choose the most honest one:
    Correct (Excellent/Very Good): All key facts, terminology, and concepts are accurate.
    Mostly Correct (Good):         Core is right; one small imprecision or omitted nuance.
    Partially Correct (Acceptable): Main direction correct but missing essential knowledge,
                                    key terminology, or a required concept for the role.
                                    Example: "HR should follow company policies" when asked about
                                    employment legislation → Partially Correct/Acceptable.
                                    The direction (follow rules) is right; the substance (specific laws) is absent.
    Weak (Needs Improvement):      Vague or generic response that avoids the technical substance;
                                    repeats the question back; uses only common-sense phrases;
                                    demonstrates no domain knowledge.
    Incorrect:                     A factually wrong or contradictory technical statement.
                                    Ceiling 30. Do NOT use for answers that are merely vague or incomplete.
    RULE: "Vague but not wrong" → Acceptable or Needs Improvement, NOT Incorrect.
    RULE: "Missing domain knowledge" → Needs Improvement or Weak, NOT Incorrect (unless a false claim is made).

  Logic & Coherence — measures internal reasoning only:
    Clear reasoning:    Good–Excellent
    Weak reasoning:     Needs Improvement (35–50)
    Contradictory:      Internal self-contradiction → ceiling 25
    Nonsensical:        Incoherent or random → ceiling 15
    RULE: A technically shallow answer can still be logically coherent. Do not penalize logic for lack of depth.

  Specificity — five levels based on concrete evidence in the answer:
    Excellent/Very Good: Named tools, frameworks, technologies, metrics, numbers, timelines, business impact.
                         Example: "I used Jira and Confluence to coordinate 4-sprint delivery, reducing blockers 30%."
    Good:                Some concrete detail — a named tool OR a number, but not both consistently.
    Acceptable:          Partial specificity — describes an action but without names or numbers.
    Needs Improvement:   Generic claims only ("I am a hard worker", "I use best practices").
    Weak:                No concrete detail at all; pure abstraction or filler phrases.
    RULE: A single named technology or metric lifts the answer above "Weak". Do not over-penalize.

  Supporting Example — five levels:
    Excellent/Very Good (Strong):  Real, specific, measurable example with context and outcome.
                                    "I implemented an onboarding process for 40 employees and reduced time-to-productivity by 2 weeks."
    Good (Relevant):               Real example, meaningful and relevant, but missing outcome or full context.
    Acceptable (Basic):            A recognisable real-world reference but vague — no numbers, no outcome.
                                    "I worked on an HR project last year."
    Needs Improvement (Weak):      A very thin or hypothetical reference with little substance.
    Incomplete:                    Candidate started to give an example but didn't finish it.
    Missing:                       No example or reference at all.
    RULE: "I worked on HR" ≠ "I implemented onboarding for 40 employees." Never assign the same status to both.
    RULE: A hypothetical ("I would...") → Needs Improvement at best, not Good.

  Communication — evaluates ONLY delivery quality. COMPLETELY INDEPENDENT of technical correctness:
    Evaluates: sentence clarity, flow, grammar, professional wording, organisation, readability.
    Does NOT evaluate: technical accuracy, completeness, knowledge, domain correctness.
    HARD RULE: A technically wrong or incomplete answer CAN score Good or Excellent on communication.
    HARD RULE: A technically strong answer delivered in broken, disorganised sentences → Needs Improvement on communication.
    HARD RULE: Weak specificity or low accuracy MUST NOT reduce communication score. These are separate dimensions.
    Example: "HR should follow company policies and regulations to avoid any issues with the law."
             → Communication: Good (clear sentence, professional wording, logical flow — even though substance is weak).

  STAR Structure:
    Applies ONLY to behavioural questions ("tell me about a time...", "describe a situation...").
    Knowledge/factual/technical/definition questions → always "Not Applicable", zero penalty.

ANSWER CLASSIFICATION (primary_issue values):
"off_topic"|"incorrect"|"incomplete"|"vague"|"contradictory"|"nonsensical"|"no_answer"|"skipped"|"acceptable"|"strong"

ANSWER DIAGNOSIS (8 dimensions):
  - relevance:           Does it address the question?
  - accuracy:            Factually/technically correct for the role?
  - completeness:        Covers all expected aspects?
  - logic_coherence:     Internally consistent and logical?
  - specificity:         Concrete details, numbers, named examples?
  - supporting_example:  Real example from candidate's experience?
  - star_structure:      STAR framework? (behavioural only, otherwise Not Applicable)
  - communication_clarity: Clarity, flow, organisation, professional wording only.

Valid statuses: "Excellent"|"Very Good"|"Good"|"Acceptable"|"Partially Complete"|"Needs Improvement"|"Weak"|"Off-topic"|"Incorrect"|"Incomplete"|"Contradictory"|"Unclear"|"Not Applicable"|"Missing"
Valid severities: "none"|"low"|"medium"|"high"|"critical"

Diagnosis field rules:
  - evidence: brief quote or paraphrase. Empty string if not applicable.
  - reason: 1 sentence. Honest, evidence-based.
  - how_to_improve: 1 sentence. Empty only for "Excellent" or "Not Applicable".
  - Never accuse of lying. Use "Questionable credibility" for suspicious claims.

STAR SUB-DIAGNOSIS (star_sub_diagnosis):
  - Include only when star_structure IS applicable.
  - If not applicable: all 4 parts = "not_applicable".
  - Valid per part: "present"|"partial"|"missing"|"not_applicable"

SCORE CEILING RULES (also enforced server-side — your scores must respect these):
  - relevance = "Off-topic"                              → ceiling 15
  - accuracy = "Incorrect"                               → ceiling 30
  - logic_coherence = "Contradictory"                    → ceiling 25
  - completeness = "Missing"                             → ceiling 10
  - completeness = "Incomplete" + severity high          → ceiling 45
  - specificity = "Weak" AND supporting_example = "Weak" → ceiling 55

EMPTY / INVALID ANSWER HANDLING:
  - Empty/silence/skip/fillers only → primary_issue="no_answer"; completeness="Missing" (critical); all others="Not Applicable"; score 0–5.
  - "I don't know" → primary_issue="no_answer"; supportive coach_feedback; improved_answer gives direction.
  - Nonsensical/random → primary_issue="nonsensical"; relevance="Off-topic" (critical).

STRENGTHS — STRICT EVIDENCE RULES:
  - ONLY list a strength directly supported by actual words the candidate said.
  - FORBIDDEN contradictions:
    * accuracy="Incorrect" → NEVER claim "technical knowledge" or "accurate understanding"
    * relevance="Off-topic" → NEVER claim "answered the question clearly"
    * star_structure="Missing"/"Weak" → NEVER claim "STAR structure" or "well-structured"
    * answer_quality<40 → NEVER claim "excellent communication" or "great delivery"
  - Delivery strengths (pace, pronunciation) valid ONLY if speech data confirms them.
  - If no genuine strength: ["No clear strengths could be identified from the answers provided."]

COACHING FIELDS (KEEP SHORT to fit token budget):
  - what_interviewer_expected: 1 sentence only.
  - coach_feedback: 2 sentences — what went wrong and how to fix it.
  - improved_answer: 2–3 sentences. Role/level-appropriate model answer. Address the ACTUAL question.

SELF-CHECK (run internally before returning the final JSON):
  1. Is every dimension status chosen from the valid status list above?
  2. Does each status honestly reflect the candidate's words — not what you wished they said?
  3. If relevance="Off-topic" → no content-based strengths; improved_answer addresses the actual question.
  4. If accuracy="Incorrect" → feedback names the specific error; improved_answer corrects it.
  5. Is every evidence field a real quote/paraphrase from the answer, not invented?
  6. Are coach_feedback and improved_answer specific to this answer, not generic boilerplate?
  7. Set overall_score=0 and answer_quality=0 — the server recalculates these from your diagnosis statuses.
  8. VERIFY: does per_question_diagnosis contain exactly one item per interview question? If any question is missing, add it before returning. This is the most important check.

  INTERNAL CONSISTENCY CHECK (run for every question before finalising):
  A. Accuracy vs Completeness: If accuracy="Correct" or "Very Good", completeness must NOT say "Missing key concepts" — high accuracy and missing knowledge are contradictory.
  B. Communication independence: communication_clarity must be set SOLELY on delivery quality. If you find yourself giving a low communication score because the answer was vague or technically weak, stop and re-evaluate communication on sentence clarity alone.
  C. Specificity vs Communication: Weak specificity MUST NOT reduce communication_clarity. They measure different things.
  D. Supporting Example vs Logic: Missing or weak examples MUST NOT reduce logic_coherence unless the reasoning itself is broken.
  E. Accuracy calibration gate: Before assigning "Incorrect", confirm the answer contains a factually FALSE statement. Vague, generic, or policy-level answers without domain knowledge → "Needs Improvement" or "Weak", NOT "Incorrect".
  F. Specificity calibration gate: Before assigning "Weak" specificity, confirm there are zero named entities (tools, methods, frameworks, numbers, metrics). A single named item moves the answer above "Weak".
  G. Supporting Example calibration gate: An answer with a clear real-world reference (even brief) is NOT "Missing". A vague hypothetical is NOT "Good". Match the level to the actual quality of the example given.`;

      const diagExample = `{"relevance":{"status":"Off-topic","severity":"critical","reason":"The answer discusses personal hobbies instead of the accounting concept asked.","evidence":"I like football and travelling.","how_to_improve":"Start with a direct definition of what was asked."},"accuracy":{"status":"Not Applicable","severity":"none","reason":"Cannot assess — answer is entirely off-topic.","evidence":"","how_to_improve":""},"completeness":{"status":"Missing","severity":"critical","reason":"No relevant content was provided.","evidence":"","how_to_improve":"Cover the definition, comparison, and an example."},"logic_coherence":{"status":"Acceptable","severity":"low","reason":"The sentence is grammatically coherent, just unrelated.","evidence":"","how_to_improve":""},"specificity":{"status":"Not Applicable","severity":"none","reason":"No relevant content to assess.","evidence":"","how_to_improve":""},"supporting_example":{"status":"Not Applicable","severity":"none","reason":"No relevant content.","evidence":"","how_to_improve":""},"star_structure":{"status":"Not Applicable","severity":"none","reason":"Not a behavioral question.","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"The response is grammatically clear.","evidence":"","how_to_improve":""}}`;

      userPrompt = isArabic
        ? `قيّم أداء هذا المرشح لوظيفة ${role} (تعليم: ${education}، خبرة: ${experience}).

${speechMetricsBlock}
${hasContentOnly ? '\nملاحظة: إجابات محددة بـ [محتوى فقط] قُدِّمت بلغة مختلفة. قيّم المحتوى والأفكار فقط — تجاهل اللغة والتواصل اللفظي لها.\n' : ''}
الإجابات الفعلية:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. السؤال: ${q.question}\nالإجابة: "${q.answer || '(لم تُقدَّم إجابة)'}"${contentOnlyMask[i] ? ' [محتوى فقط]' : ''}`).join('\n\n')}

مطلوب: per_question_diagnosis يجب أن يحتوي على سؤال واحد لكل سؤال من الأسئلة أعلاه (${questions.length} إجمالاً). لا تحذف أي سؤال.
هيكل كل سؤال في per_question_diagnosis:
{"question":"...","answer_classification":{"primary_issue":"off_topic|incorrect|incomplete|vague|no_answer|acceptable|strong","secondary_issues":[]},"diagnosis":{...8 dimensions...},"star_sub_diagnosis":{"situation":"present|partial|missing|not_applicable","task":"...","action":"...","result":"..."},"what_interviewer_expected":"جملة واحدة.","coach_feedback":"جملتان فقط.","improved_answer":"جملتان أو ثلاث."}

أعد JSON فقط. overall_score وانswer_quality = 0 (يحسبهما الخادم). جميع الحقول الأخرى يجب أن تكون مكتملة:
{"overall_score":0,"communication":30,"confidence":25,"answer_quality":0,"strengths":["نقطة قوة حقيقية"],"improvements":["تحسين 1","تحسين 2","تحسين 3"],"ai_feedback":"تغذية راجعة صادقة.","recommendations":[{"title":"توصية 1","description":"نصيحة 1"},{"title":"توصية 2","description":"نصيحة 2"},{"title":"توصية 3","description":"نصيحة 3"}],"per_question_diagnosis":[{"question":"السؤال الفعلي 1","answer_classification":{"primary_issue":"off_topic","secondary_issues":[]},"diagnosis":${diagExample},"star_sub_diagnosis":{"situation":"not_applicable","task":"not_applicable","action":"not_applicable","result":"not_applicable"},"what_interviewer_expected":"تعريف الأصول والخصوم مع مثال مقارن.","coach_feedback":"الإجابة خارج الموضوع تماماً. ابدأ دائماً بالإجابة المباشرة على السؤال.","improved_answer":"الأصول موارد تمتلكها المنشأة كالنقد والمخزون. الخصوم التزامات مستحقة عليها كالقروض."},{"question":"السؤال الفعلي 2","answer_classification":{"primary_issue":"incomplete","secondary_issues":["vague"]},"diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"تتناول السؤال لكنها ناقصة.","evidence":"","how_to_improve":"أضف مثالاً محدداً ونتيجة."},"accuracy":{"status":"Acceptable","severity":"low","reason":"لا أخطاء واضحة.","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"تغطي الأساسيات لكن تفتقر لجوانب مهمة.","evidence":"","how_to_improve":"تناول الإجراءات والنتيجة."},"logic_coherence":{"status":"Good","severity":"none","reason":"منطقية ومتسقة.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"ادعاءات مبهمة بلا أرقام.","evidence":"أنا أعمل بجد.","how_to_improve":"استبدل بموقف محدد وقابل للقياس."},"supporting_example":{"status":"Incomplete","severity":"medium","reason":"مثال جزئي بلا نتيجة.","evidence":"","how_to_improve":"أكمل بالإجراء والنتيجة."},"star_structure":{"status":"Incomplete","severity":"medium","reason":"الموقف موجود لكن الإجراء والنتيجة غائبان.","evidence":"","how_to_improve":"أضف ما فعلته ونتيجة قابلة للقياس."},"communication_clarity":{"status":"Good","severity":"none","reason":"واضحة وسهلة الفهم.","evidence":"","how_to_improve":""}},"star_sub_diagnosis":{"situation":"present","task":"missing","action":"partial","result":"missing"},"what_interviewer_expected":"موقف محدد، دور، إجراءات، ونتيجة قابلة للقياس.","coach_feedback":"الإجابة ناقصة لأنها تفتقر للإجراء والنتيجة. استخدم منهج STAR بالكامل.","improved_answer":"في دوري السابق واجه الفريق تأخراً في مشروع حرج. أنشأت اجتماعات يومية وأعدت توزيع المهام، فتم التسليم في الموعد وجدد العميل العقد."}]}`
        : `You are evaluating a candidate for ${role} (Education: ${education}, Experience: ${experience}).

${speechMetricsBlock}
${hasContentOnly ? '\nNOTE: Answers marked [CONTENT ONLY] were in a different language. Evaluate ideas, structure, relevance only — do NOT penalize language or communication style.\n' : ''}
Candidate's actual answers:
${questions.map((q: {question:string;answer:string}, i: number) => `${i+1}. Q: ${q.question}\n   A: "${q.answer || '(no answer given)'}"${contentOnlyMask[i] ? ' [CONTENT ONLY]' : ''}`).join('\n\n')}

MANDATORY: per_question_diagnosis MUST contain exactly one item per question above (${questions.length} total). Never omit or shorten this array.
Per-question structure in per_question_diagnosis:
{"question":"...","answer_classification":{"primary_issue":"off_topic|incorrect|incomplete|vague|no_answer|acceptable|strong","secondary_issues":[]},"diagnosis":{...8 dimensions...},"star_sub_diagnosis":{"situation":"present|partial|missing|not_applicable","task":"...","action":"...","result":"..."},"what_interviewer_expected":"1 sentence.","coach_feedback":"2 sentences.","improved_answer":"2-3 sentences."}

Return ONLY valid JSON. overall_score and answer_quality = 0 (server calculates these). All other fields must be fully populated:
{"overall_score":0,"communication":30,"confidence":25,"answer_quality":0,"strengths":["Genuine strength or no-strengths message"],"improvements":["Specific improvement 1","Specific improvement 2","Specific improvement 3"],"ai_feedback":"Direct honest coaching.","recommendations":[{"title":"Rec 1","description":"Advice 1"},{"title":"Rec 2","description":"Advice 2"},{"title":"Rec 3","description":"Advice 3"}],"per_question_diagnosis":[{"question":"Actual Q1 text","answer_classification":{"primary_issue":"off_topic","secondary_issues":[]},"diagnosis":${diagExample},"star_sub_diagnosis":{"situation":"not_applicable","task":"not_applicable","action":"not_applicable","result":"not_applicable"},"what_interviewer_expected":"Define assets and liabilities with a brief comparison example.","coach_feedback":"The answer is entirely off-topic, which signals a knowledge gap to any interviewer. Always address the actual question directly first.","improved_answer":"Assets are economic resources a business owns (cash, inventory, equipment). Liabilities are obligations it owes (loans, payables). A company vehicle is an asset; the loan to buy it is a liability."},{"question":"Actual Q2 text","answer_classification":{"primary_issue":"incomplete","secondary_issues":["vague"]},"diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"Addresses the question but lacks depth.","evidence":"","how_to_improve":"Add a specific example with a measurable result."},"accuracy":{"status":"Acceptable","severity":"low","reason":"No factual errors detected.","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"Covers basics but misses action and result.","evidence":"","how_to_improve":"Include what you did and the outcome."},"logic_coherence":{"status":"Good","severity":"none","reason":"Coherent and logical.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"Vague claim with no detail.","evidence":"I always work hard.","how_to_improve":"Replace with a named situation and measurable outcome."},"supporting_example":{"status":"Incomplete","severity":"medium","reason":"Example lacks action and result.","evidence":"","how_to_improve":"Complete with STAR structure."},"star_structure":{"status":"Incomplete","severity":"medium","reason":"Situation present but action and result missing.","evidence":"","how_to_improve":"Add what you did and a quantifiable result."},"communication_clarity":{"status":"Good","severity":"none","reason":"Clear and easy to follow.","evidence":"","how_to_improve":""}},"star_sub_diagnosis":{"situation":"present","task":"missing","action":"partial","result":"missing"},"what_interviewer_expected":"A specific situation, your role, the actions you took, and a measurable result.","coach_feedback":"The answer is incomplete — no result means the interviewer cannot judge your impact. Finish the STAR loop with a concrete outcome.","improved_answer":"When my team was behind on a critical project, I identified blockers, set up daily 15-minute syncs, and reallocated tasks. We delivered on time and the client renewed the contract."}]}`;

    } else if (mode === 'presentation') {
      const topic = sanitize(body.topic, 200);
      const transcript = sanitize(body.transcript, 8000);
      const contentOnly = body.contentOnly === true;

      if (!transcript || transcript.trim().length < 10) {
        return new Response(
          JSON.stringify({ error: 'No presentation content to analyze. Please record your presentation first.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const transcriptWordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
      const durationSec: number | null = typeof sm.durationSeconds === 'number' ? sm.durationSeconds : null;

      const contentOnlyNote = contentOnly
        ? '\nIMPORTANT: This presentation was recorded in a different language. Evaluate CONTENT ONLY: structure, organization, clarity, message, relevance. Do NOT penalize language fluency or pronunciation.\n'
        : '';

      systemPrompt = `You are a strict, professional presentation coach. Evaluate recorded presentations honestly and directly.

SCORING RUBRIC:
0–15: Empty, no content, completely off-topic, or incoherent
16–35: Very weak — extremely short (<30 words), no structure, generic/irrelevant ideas
36–55: Basic — some relevant ideas, weak organization, limited examples, missing intro or conclusion
56–75: Good — clear topic, logical flow, reasonable supporting details, identifiable structure
76–90: Strong — well organized, clear intro/body/conclusion, good transitions, effective delivery
91–100: Excellent — professional structure, engaging, compelling examples, memorable conclusion

CRITICAL RULES:
1. Be brutally honest. Do NOT inflate scores.
2. Under 30 words → overall_score MUST be below 30. Under 80 words → below 45. Under 150 words → below 60.
3. Off-topic → communication_effectiveness MUST be below 30.
4. strengths: ONLY list if clearly supported by transcript or speech data. If weak: ["No clear strengths could be identified from this presentation."]
5. improvements: specific and actionable, tied to actual weaknesses.
6. score_reasons: 1–2 honest sentences per score referencing actual evidence.
7. structure_review: evaluate each section specifically, reference what was actually said.
8. ai_feedback: 2–4 direct coaching sentences. Name specific weaknesses. No generic praise.
9. Return valid JSON only.${contentOnlyNote}`;

      const metricsSummary = [
        durationSec !== null ? `Duration: ${Math.round(durationSec)} seconds` : null,
        `Word count: ${transcriptWordCount} words`,
        wpmLine, pauseLine, fillerLine,
      ].filter(Boolean).join('\n');

      userPrompt = isArabic
        ? `قيّم هذا العرض حول: "${topic}"\n\n${speechMetricsBlock}\nعدد الكلمات: ${transcriptWordCount}\n${contentOnlyNote}\nالنص: "${transcript}"\n\nأعد JSON فقط:\n{"overall_score":0,"confidence":0,"structure":0,"communication_effectiveness":0,"strengths":["نقطة قوة حقيقية"],"improvements":["تحسين 1","تحسين 2","تحسين 3"],"score_reasons":{"confidence":"سبب...","structure":"سبب...","communication_effectiveness":"سبب..."},"structure_review":{"opening":{"score":0,"feedback":"...","suggestions":"..."},"body":{"score":0,"feedback":"...","suggestions":"..."},"transitions":{"score":0,"feedback":"...","suggestions":"..."},"conclusion":{"score":0,"feedback":"...","suggestions":"..."}},"ai_feedback":"تغذية راجعة مباشرة.","recommendations":[{"title":"توصية 1","description":"نصيحة 1"},{"title":"توصية 2","description":"نصيحة 2"},{"title":"توصية 3","description":"نصيحة 3"}]}`
        : `Evaluate this presentation on: "${topic}"\n\n${speechMetricsBlock}\n${metricsSummary}\n${contentOnlyNote}\nFull transcript (${transcriptWordCount} words):\n"${transcript}"\n\nReturn ONLY valid JSON:\n{"overall_score":0,"confidence":0,"structure":0,"communication_effectiveness":0,"strengths":["Genuine strength from transcript/data, or the fixed no-strengths message"],"improvements":["Specific improvement 1","Specific improvement 2","Specific improvement 3"],"score_reasons":{"confidence":"Why this score...","structure":"Why this score...","communication_effectiveness":"Why this score..."},"structure_review":{"opening":{"score":0,"feedback":"What was said and how effective.","suggestions":"One specific improvement."},"body":{"score":0,"feedback":"How organized, what examples.","suggestions":"One specific improvement."},"transitions":{"score":0,"feedback":"How smoothly ideas connected.","suggestions":"One specific improvement."},"conclusion":{"score":0,"feedback":"How the presentation ended.","suggestions":"One specific improvement."}},"ai_feedback":"Direct 2-4 sentence coaching naming specific weaknesses.","recommendations":[{"title":"Rec 1","description":"Advice 1"},{"title":"Rec 2","description":"Advice 2"},{"title":"Rec 3","description":"Advice 3"}]}`;

    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid mode' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
        temperature: 0.3,
        max_tokens: 8192,
      }),
      signal: AbortSignal.timeout(140000),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenRouter error:', err);
      return new Response(
        JSON.stringify({ error: 'AI service temporarily unavailable. Please try again.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '{}';
    const finishReason = choice?.finish_reason ?? '';

    if (finishReason === 'length') {
      console.error('analyze-performance: AI response truncated (finish_reason=length)');
      return new Response(
        JSON.stringify({ error: 'AI response was cut off. Please try again.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      try {
        const match = content.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : {};
      } catch {
        parsed = {};
      }
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).overall_score !== 'number'
    ) {
      return new Response(
        JSON.stringify({ error: 'AI returned an unexpected response. Please try again.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const p = parsed as Record<string, unknown>;

    // ── per_question_diagnosis validation + targeted retry ────────────────────
    if (mode === 'interview' && interviewQuestions.length > 0) {
      const diag = p.per_question_diagnosis;
      const diagOk = Array.isArray(diag) && diag.length >= interviewQuestions.length;

      if (!diagOk) {
        console.warn(
          `analyze-performance: per_question_diagnosis incomplete — got ${Array.isArray(diag) ? diag.length : 0}, expected ${interviewQuestions.length}. Retrying diagnosis only.`
        );

        const retryDiagSchema = `{"question":"exact question text","answer_classification":{"primary_issue":"off_topic|incorrect|incomplete|vague|no_answer|acceptable|strong","secondary_issues":[]},"diagnosis":{"relevance":{"status":"Good","severity":"low","reason":"1 sentence.","evidence":"","how_to_improve":""},"accuracy":{"status":"Good","severity":"none","reason":"1 sentence.","evidence":"","how_to_improve":""},"completeness":{"status":"Needs Improvement","severity":"medium","reason":"1 sentence.","evidence":"","how_to_improve":"1 sentence."},"logic_coherence":{"status":"Good","severity":"none","reason":"1 sentence.","evidence":"","how_to_improve":""},"specificity":{"status":"Weak","severity":"medium","reason":"1 sentence.","evidence":"quote","how_to_improve":"1 sentence."},"supporting_example":{"status":"Weak","severity":"medium","reason":"1 sentence.","evidence":"","how_to_improve":"1 sentence."},"star_structure":{"status":"Not Applicable","severity":"none","reason":"Not a behavioural question.","evidence":"","how_to_improve":""},"communication_clarity":{"status":"Good","severity":"none","reason":"1 sentence.","evidence":"","how_to_improve":""}},"star_sub_diagnosis":{"situation":"not_applicable","task":"not_applicable","action":"not_applicable","result":"not_applicable"},"what_interviewer_expected":"1 sentence.","coach_feedback":"2 sentences.","improved_answer":"2-3 sentences."}`;

        const retrySystemPrompt = `You are an interview evaluator. Generate a per_question_diagnosis array for the given Q&A pairs. Return ONLY a valid JSON object with a single key: per_question_diagnosis. Include exactly one item per question, in order. Never omit a question.`;

        const retryLang = lang === 'ar';
        const retryUserPrompt = retryLang
          ? `وظيفة: ${interviewRole} (${interviewEducation}، ${interviewExperience})\n\n${interviewQuestions.map((q, i) => `${i+1}. السؤال: ${q.question}\nالإجابة: "${q.answer || '(لم تُقدَّم إجابة)'}"`).join('\n\n')}\n\nأعد JSON فقط:\n{"per_question_diagnosis":[${retryDiagSchema},...one per question]}`
          : `Role: ${interviewRole} (${interviewEducation}, ${interviewExperience})\n\n${interviewQuestions.map((q, i) => `${i+1}. Q: ${q.question}\n   A: "${q.answer || '(no answer given)'}"`).join('\n\n')}\n\nReturn ONLY valid JSON:\n{"per_question_diagnosis":[${retryDiagSchema},...one per question]}`;

        try {
          const retryResp = await fetch(OPENROUTER_URL, {
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
                { role: 'system', content: retrySystemPrompt },
                { role: 'user', content: retryUserPrompt },
              ],
              temperature: 0.3,
              max_tokens: 8192,
            }),
            signal: AbortSignal.timeout(120000),
          });

          if (retryResp.ok) {
            const retryData = await retryResp.json();
            const retryChoice = retryData.choices?.[0];
            if (retryChoice?.finish_reason !== 'length') {
              const retryContent: string = retryChoice?.message?.content ?? '{}';
              let retryParsed: unknown;
              try {
                retryParsed = JSON.parse(retryContent);
              } catch {
                const m = retryContent.match(/\{[\s\S]*\}/);
                retryParsed = m ? JSON.parse(m[0]) : {};
              }
              const retryDiag = (retryParsed as Record<string, unknown>)?.per_question_diagnosis;
              if (Array.isArray(retryDiag) && retryDiag.length >= interviewQuestions.length) {
                p.per_question_diagnosis = retryDiag;
                console.log(`analyze-performance: diagnosis retry succeeded (${retryDiag.length} items).`);
              } else {
                console.warn(`analyze-performance: diagnosis retry returned ${Array.isArray(retryDiag) ? retryDiag.length : 0} items — still incomplete.`);
              }
            } else {
              console.warn('analyze-performance: diagnosis retry truncated (finish_reason=length).');
            }
          } else {
            console.error('analyze-performance: diagnosis retry HTTP error', retryResp.status);
          }
        } catch (retryErr) {
          console.error('analyze-performance: diagnosis retry failed:', retryErr);
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (mode === 'interview') {
      const diag = p.per_question_diagnosis;
      if (Array.isArray(diag) && diag.length > 0) {
        // ── Deterministic score aggregation (overrides LLM numeric scores) ──
        const breakdown = calculateInterviewScore(diag as Array<Record<string, unknown>>);

        // Inject per-question scores back into each diagnosis item
        for (let i = 0; i < diag.length; i++) {
          (diag[i] as Record<string, unknown>).question_score = breakdown.question_scores[i] ?? 0;
        }

        // Override LLM-provided numeric scores with calculated values
        p.overall_score  = breakdown.final_score;
        p.answer_quality = breakdown.average; // average question score before adjustments
        p.score_breakdown = breakdown;        // full breakdown for debugging / transparency

        // Validate strengths against diagnosis (now uses calculated answer_quality)
        enforceStrengths(p, breakdown.average);
      }
    }

    return new Response(
      JSON.stringify(p),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      console.error('OpenRouter timeout:', err);
      return new Response(
        JSON.stringify({ error: 'Analysis timed out. Please try again.' }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.error('Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
