/**
 * normalizeArabicForTTS
 *
 * Deterministic, pure transformation of Arabic interview questions into a
 * spoken-text form suitable for ElevenLabs TTS.  The original displayed
 * question is never mutated; only the spoken copy is transformed.
 *
 * Rules applied (in priority order, non-overlapping left-to-right scan):
 *   1. KWD three-decimal  – 1.250 KWD / 1,000.500 دينار كويتي
 *   2. Currency + comma-thousands – 50,000 دينار كويتي / 1,250 KWD
 *   3. Currency + plain integer   – 500 دينار كويتي / 5 KWD
 *   4. Percentage                  – 30% / 2.5%
 *   5. Year with explicit context  – في عام 2024 / عام 1990
 *
 * Anything not matched by the five rules is left verbatim.
 * Idempotent: Arabic-word output contains no digits so rules never re-fire.
 */

// ---------------------------------------------------------------------------
// Eastern-Arabic digit normalisation (٠–٩ → 0–9)
// ---------------------------------------------------------------------------
function toWesternDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٬/g, ','); // U+066C ARABIC THOUSANDS SEPARATOR → ASCII comma
}

// ---------------------------------------------------------------------------
// Integer → Arabic words
// Covers 0 – 999,999,999.  Uses accusative/oblique forms for case-variable
// words (duals and decade words), which is appropriate for currency amounts
// and percentages that appear in object/complement position in sentences.
// Gender agreement for 3-10 (reversed polarity in Arabic) is intentionally
// omitted to avoid incorrectly modifying currency noun plurals.
// ---------------------------------------------------------------------------

// Oblique (accusative/genitive) forms are used consistently for all
// case-variable words.  Decade words use '-ين' (عشرين، ثلاثين…) and duals
// use '-ين' in standalone position, or the construct form '-ي' (مئتي، ألفي،
// مليوني) when the dual is the sole element placed directly before a currency
// noun or the thousands multiplier placed directly before ألف.  This avoids
// sentence-level case analysis while producing natural, understandable MSA in
// the currency, percentage, and year contexts where numbers appear in Qadha.
const ONES  = ['', 'واحد', 'اثنين', 'ثلاثة', 'أربعة', 'خمسة',
               'ستة', 'سبعة', 'ثمانية', 'تسعة'] as const;
const TEENS = ['عشرة', 'أحد عشر', 'اثني عشر', 'ثلاثة عشر',
               'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر',
               'ثمانية عشر', 'تسعة عشر'] as const;
const TENS  = ['', 'عشرة', 'عشرين', 'ثلاثين', 'أربعين', 'خمسين',
               'ستين', 'سبعين', 'ثمانين', 'تسعين'] as const;
const HUNDREDS = ['', 'مئة', 'مئتين', 'ثلاثمئة', 'أربعمئة', 'خمسمئة',
                  'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'] as const;

function intToArabicWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  if (n === 0) return 'صفر';

  const parts: string[] = [];

  if (n >= 1_000_000) {
    const m = Math.floor(n / 1_000_000);
    n %= 1_000_000;
    if (m === 1)       parts.push('مليون');
    else if (m === 2)  parts.push('مليونين');
    else if (m <= 10)  parts.push(intToArabicWords(m) + ' ملايين');
    else               parts.push(intToArabicWords(m) + ' مليون');
  }

  if (n >= 1_000) {
    const k = Math.floor(n / 1_000);
    const r = n % 1_000;
    n = r;
    if (k === 1)       parts.push('ألف');
    else if (k === 2)  parts.push('ألفين');
    else if (k <= 10)  parts.push(intToArabicWords(k) + ' آلاف');
    // ألفاً (with tanwin) only when a remainder follows: ألف is then NOT in
    // direct construct (idafa) with the following noun, so tanwin is correct.
    // When r=0, ألف is directly before the currency noun → no tanwin.
    // Construct state: مئتين ألف → مئتي ألف (dual multiplier, ن drops in idafa).
    else {
      const kWords = intToArabicWords(k);
      const kConstruct = (r === 0 && kWords === 'مئتين') ? 'مئتي' : kWords;
      parts.push(kConstruct + (r > 0 ? ' ألفاً' : ' ألف'));
    }
  }

  if (n >= 100) {
    const h = Math.floor(n / 100);
    n %= 100;
    parts.push(HUNDREDS[h]);
  }

  if (n >= 20) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    parts.push(o === 0 ? TENS[t] : ONES[o] + ' و' + TENS[t]);
  } else if (n >= 10) {
    parts.push(TEENS[n - 10]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }

  return parts.join(' و');
}

// ---------------------------------------------------------------------------
// Currency-noun helpers
// ---------------------------------------------------------------------------

// Canonical spoken label for whichever KWD abbreviation the AI chose.
// The currency noun is kept as-is when written in Arabic so that the
// surrounding sentence grammar is preserved.
function normalizeCurrencyLabel(raw: string): string {
  const t = raw.trim();
  if (/^KWD$/i.test(t) || /^د\.ك$/.test(t)) return 'دينار كويتي';
  return t; // e.g. "دينار كويتي" already correct
}

// ---------------------------------------------------------------------------
// Currency-amount spoken forms
// ---------------------------------------------------------------------------

// Maps the decimal part of a percentage string to its Arabic fraction word.
// Only exact common fractions are listed; other decimals keep the numeral.
const FRACTION_MAP: Readonly<Record<string, string>> = {
  '5':  'نصف',
  '25': 'ربع',
  '75': 'ثلاثة أرباع',
};

// Applies construct state to a pure-dual number word placed directly before a
// currency noun: the ن in '-ين' drops.  Only matches exact standalone duals;
// compound strings like 'ألف ومئتين وخمسين' are returned unchanged.
function applyConstructState(w: string): string {
  if (w === 'مئتين')   return 'مئتي';
  if (w === 'ألفين')   return 'ألفي';
  // Diacritics on مِلْيُونَي guide Yasser away from "مالِيوني" mispronunciation.
  if (w === 'مليونين') return 'مِلْيُونَي';
  return w;
}

// Returns the correct Arabic spoken form for a dinar count n, applying the
// Arabic grammar rules for singular (1), dual (2), broken plural 3-10, and
// singular-after-11+.
function formatDinarAmount(n: number, currencyLabel: string): string {
  const isKWD = currencyLabel === 'دينار كويتي';
  if (n === 0) return `صفر ${currencyLabel}`;
  if (n === 1) return `${currencyLabel} واحد`;
  if (n === 2) return isKWD ? 'دينارين كويتيين' : 'دينارين';
  if (n >= 3 && n <= 10)
    return `${intToArabicWords(n)} ${isKWD ? 'دنانير كويتية' : 'دنانير'}`;
  return `${applyConstructState(intToArabicWords(n))} ${currencyLabel}`;
}

// Returns the correct Arabic spoken form for a fils count n (1–999).
// Caller omits the phrase when n === 0.
function formatFils(n: number): string {
  // Diacritics on فِلْس guide Yasser away from "فلز" mispronunciation of the final س.
  if (n === 1) return 'فِلْس واحد';
  if (n === 2) return 'فلسين';
  if (n >= 3 && n <= 10) return `${intToArabicWords(n)} فلوس`;
  return `${intToArabicWords(n)} فلساً`;
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

// Currency unit patterns (Arabic + abbreviations)
const CURRENCY_UNITS =
  '(?:KWD|د\\.ك|دينار(?:\\s+كويتي)?)';

// Comma-formatted integer: e.g. "50,000" or "1,250"
const COMMA_INT = '\\d{1,3}(?:,\\d{3})+';

// Plain integer (no commas, no dot): e.g. "500"
const PLAIN_INT = '\\d+';

/**
 * Rule 1 – KWD three-decimal amount: 1.250 KWD / 50,000.750 دينار كويتي
 * Matches ONLY when the decimal part has exactly 3 digits (KWD fils notation).
 * Without a currency unit the pattern is intentionally NOT matched.
 */
const RE_KWD_DECIMAL = new RegExp(
  `(?<![.\\w])(${COMMA_INT}|${PLAIN_INT})\\.([0-9]{3})` +
  `\\s*(${CURRENCY_UNITS})`,
  'g'
);

/**
 * Rule 2 – Comma-thousands integer + currency:  50,000 دينار كويتي
 */
const RE_COMMA_CURRENCY = new RegExp(
  `(?<![.\\w])(${COMMA_INT})\\s*(${CURRENCY_UNITS})`,
  'g'
);

/**
 * Rule 3 – Plain integer + currency:  500 دينار كويتي / 5 KWD
 */
const RE_PLAIN_CURRENCY = new RegExp(
  `(?<![.\\w])(${PLAIN_INT})\\s*(${CURRENCY_UNITS})`,
  'g'
);

/**
 * Rule 4 – Percentage: 30%  /  2.5%
 * Whole-number percentages are expanded to Arabic words.
 * Decimal percentages keep the numeral and just gain " بالمئة".
 */
const RE_PERCENT = /(?<![.\w])(\d+(?:\.\d+)?)\s*%/g;

/**
 * Rule 5 – Year with explicit context:
 *   في عام 2024  /  عام 1990  /  سنة 2010
 * Four-digit numbers NOT preceded by these words are left unchanged.
 */
const RE_YEAR = /((?:في\s+)?(?:عام|سنة)\s+)(19\d{2}|20\d{2})/g;

// ---------------------------------------------------------------------------
// Replace helper – applies a single RegExp rule to `text`, returning the
// modified string and recording which character ranges were already replaced
// so later rules skip them.
// ---------------------------------------------------------------------------
type Replacement = { start: number; end: number; value: string };

function applyRule(
  text: string,
  re: RegExp,
  replacer: (...args: string[]) => string | null,
  occupied: Replacement[]
): string {
  const result: Replacement[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    // Skip if this span overlaps with a previously applied rule.
    const overlaps = occupied.some((r) => start < r.end && end > r.start);
    if (overlaps) continue;

    const replacement = replacer(...match);
    if (replacement === null) continue;

    result.push({ start, end, value: replacement });
    occupied.push({ start, end, value: replacement });
  }

  if (result.length === 0) return text;

  // Apply replacements right-to-left so indices stay valid.
  result.sort((a, b) => b.start - a.start);
  let out = text;
  for (const r of result) {
    out = out.slice(0, r.start) + r.value + out.slice(r.end);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * normalizeArabicForTTS
 *
 * @param text  The original Arabic question text (never mutated).
 * @returns     A spoken-form string safe to send to ElevenLabs TTS.
 *              If no rules match, the input is returned unchanged.
 */
export function normalizeArabicForTTS(text: string): string {
  // Normalise Eastern Arabic digits first so all rules see Western digits.
  let out = toWesternDigits(text);
  const occupied: Replacement[] = [];

  // Rule 1 – KWD three-decimal
  out = applyRule(out, RE_KWD_DECIMAL, (_full, intPart, filsPart, currencyRaw) => {
    const dinars = parseInt(intPart.replace(/,/g, ''), 10);
    const fils   = parseInt(filsPart, 10);
    const currency = normalizeCurrencyLabel(currencyRaw);

    if (!Number.isFinite(dinars) || !Number.isFinite(fils)) return null;

    if (fils === 0) {
      return formatDinarAmount(dinars, currency);
    }
    // When dinars = 0, omit the "صفر دينار" prefix: 0.250 KWD → "مئتين وخمسين فلساً"
    if (dinars === 0) return formatFils(fils);
    return `${formatDinarAmount(dinars, currency)} و${formatFils(fils)}`;
  }, occupied);

  // Rule 2 – Comma-thousands + currency
  out = applyRule(out, RE_COMMA_CURRENCY, (_full, intPart, currencyRaw) => {
    const n = parseInt(intPart.replace(/,/g, ''), 10);
    if (!Number.isFinite(n)) return null;
    const currency = normalizeCurrencyLabel(currencyRaw);
    return formatDinarAmount(n, currency);
  }, occupied);

  // Rule 3 – Plain integer + currency
  out = applyRule(out, RE_PLAIN_CURRENCY, (_full, intPart, currencyRaw) => {
    const n = parseInt(intPart, 10);
    if (!Number.isFinite(n)) return null;
    const currency = normalizeCurrencyLabel(currencyRaw);
    return formatDinarAmount(n, currency);
  }, occupied);

  // Rule 4 – Percentage
  out = applyRule(out, RE_PERCENT, (_full, numStr) => {
    if (!numStr.includes('.')) {
      const n = parseInt(numStr, 10);
      if (!Number.isFinite(n)) return null;
      return `${intToArabicWords(n)} بالمئة`;
    }
    // Decimal percentage: expand exact common fractions; keep numeral otherwise.
    const [intStr, decStr] = numStr.split('.');
    const fraction = FRACTION_MAP[decStr];
    if (!fraction) return `${numStr} بالمئة`;
    const intPart = parseInt(intStr, 10);
    if (intPart === 0) return `${fraction} بالمئة`;
    return `${intToArabicWords(intPart)} و${fraction} بالمئة`;
  }, occupied);

  // Rule 5 – Year with explicit context
  out = applyRule(out, RE_YEAR, (_full, prefix, yearStr) => {
    const y = parseInt(yearStr, 10);
    if (!Number.isFinite(y)) return null;
    return `${prefix}${intToArabicWords(y)}`;
  }, occupied);

  return out;
}
