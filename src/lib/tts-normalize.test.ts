import { describe, it, expect } from 'vitest';
import { normalizeArabicForTTS } from './tts-normalize';

// ---------------------------------------------------------------------------
// Helper: assert input === output (nothing changed)
// ---------------------------------------------------------------------------
function unchanged(input: string) {
  expect(normalizeArabicForTTS(input)).toBe(input);
}

// ---------------------------------------------------------------------------
// 1. Pass-through: text with no numbers or unsupported patterns
// ---------------------------------------------------------------------------
describe('pass-through', () => {
  it('leaves plain Arabic text unchanged', () => {
    unchanged('حدثنا عن نفسك ولماذا تهتم بهذه الوظيفة');
  });

  it('leaves English text unchanged', () => {
    unchanged('Tell me about a challenge you overcame.');
  });

  it('leaves already-expanded Arabic number words unchanged', () => {
    unchanged('خمسون ألف دينار كويتي');
  });

  it('leaves already-expanded percentage unchanged', () => {
    unchanged('ثلاثون بالمئة');
  });
});

// ---------------------------------------------------------------------------
// 2. KWD three-decimal (Rule 1)
// ---------------------------------------------------------------------------
describe('KWD three-decimal amounts', () => {
  it('1.250 KWD → one dinar 250 fils', () => {
    expect(normalizeArabicForTTS('1.250 KWD')).toBe('دينار كويتي واحد ومئتين وخمسين فلساً');
  });

  it('1.000 KWD → one dinar, zero fils omitted', () => {
    expect(normalizeArabicForTTS('1.000 KWD')).toBe('دينار كويتي واحد');
  });

  it('50.250 دينار كويتي → fifty dinars 250 fils', () => {
    expect(normalizeArabicForTTS('50.250 دينار كويتي')).toBe('خمسين دينار كويتي ومئتين وخمسين فلساً');
  });

  it('1,250.500 KWD → 1250 dinars 500 fils', () => {
    expect(normalizeArabicForTTS('1,250.500 KWD'))
      .toBe('ألف ومئتين وخمسين دينار كويتي وخمسمئة فلساً');
  });

  it('handles د.ك abbreviation', () => {
    expect(normalizeArabicForTTS('10.500 د.ك')).toBe('عشرة دنانير كويتية وخمسمئة فلساً');
  });
});

// ---------------------------------------------------------------------------
// 3. Comma-thousands + currency (Rule 2)
// ---------------------------------------------------------------------------
describe('comma-thousands + currency', () => {
  it('50,000 دينار كويتي', () => {
    expect(normalizeArabicForTTS('50,000 دينار كويتي')).toBe('خمسين ألف دينار كويتي');
  });

  it('1,250 KWD', () => {
    expect(normalizeArabicForTTS('1,250 KWD')).toBe('ألف ومئتين وخمسين دينار كويتي');
  });

  it('100,000 دينار كويتي', () => {
    expect(normalizeArabicForTTS('100,000 دينار كويتي')).toBe('مئة ألف دينار كويتي');
  });

  it('1,000,000 دينار كويتي', () => {
    expect(normalizeArabicForTTS('1,000,000 دينار كويتي')).toBe('مليون دينار كويتي');
  });
});

// ---------------------------------------------------------------------------
// 4. Plain integer + currency (Rule 3)
// ---------------------------------------------------------------------------
describe('plain integer + currency', () => {
  it('500 دينار كويتي', () => {
    expect(normalizeArabicForTTS('500 دينار كويتي')).toBe('خمسمئة دينار كويتي');
  });

  it('5 KWD', () => {
    expect(normalizeArabicForTTS('5 KWD')).toBe('خمسة دنانير كويتية');
  });

  it('0 KWD', () => {
    expect(normalizeArabicForTTS('0 KWD')).toBe('صفر دينار كويتي');
  });
});

// ---------------------------------------------------------------------------
// 5. Percentages (Rule 4)
// ---------------------------------------------------------------------------
describe('percentages', () => {
  it('30% → ثلاثين بالمئة', () => {
    expect(normalizeArabicForTTS('30%')).toBe('ثلاثين بالمئة');
  });

  it('100% → مئة بالمئة', () => {
    expect(normalizeArabicForTTS('100%')).toBe('مئة بالمئة');
  });

  it('0% → صفر بالمئة', () => {
    expect(normalizeArabicForTTS('0%')).toBe('صفر بالمئة');
  });

  it('2.5% → اثنين ونصف بالمئة', () => {
    expect(normalizeArabicForTTS('2.5%')).toBe('اثنين ونصف بالمئة');
  });

  it('12.75% → اثني عشر وثلاثة أرباع بالمئة', () => {
    expect(normalizeArabicForTTS('12.75%')).toBe('اثني عشر وثلاثة أرباع بالمئة');
  });

  it('percentage in sentence context', () => {
    expect(normalizeArabicForTTS('حققت الشركة نمواً بنسبة 25% خلال العام الماضي'))
      .toBe('حققت الشركة نمواً بنسبة خمسة وعشرين بالمئة خلال العام الماضي');
  });
});

// ---------------------------------------------------------------------------
// 6. Years with explicit context (Rule 5)
// ---------------------------------------------------------------------------
describe('years with explicit context', () => {
  it('في عام 2024', () => {
    expect(normalizeArabicForTTS('في عام 2024'))
      .toBe('في عام ألفين وأربعة وعشرين');
  });

  it('عام 1990', () => {
    expect(normalizeArabicForTTS('عام 1990'))
      .toBe('عام ألف وتسعمئة وتسعين');
  });

  it('سنة 2010', () => {
    expect(normalizeArabicForTTS('سنة 2010'))
      .toBe('سنة ألفين وعشرة');
  });

  it('bare four-digit number without context is left unchanged', () => {
    unchanged('رقم الموظف هو 2024');
  });

  it('bare four-digit number in sentence is left unchanged', () => {
    unchanged('كانت الميزانية 5000 دولار');
  });

  it('year in full sentence', () => {
    // 2019 = ألفين (2000, oblique) + تسعة عشر (19)
    expect(normalizeArabicForTTS('انضممت إلى الشركة في عام 2019'))
      .toBe('انضممت إلى الشركة في عام ألفين وتسعة عشر');
  });
});

// ---------------------------------------------------------------------------
// 7. Ambiguous / unsupported – must remain unchanged
// ---------------------------------------------------------------------------
describe('ambiguous formats left unchanged', () => {
  it('1.250 without currency unit', () => {
    unchanged('القيمة هي 1.250');
  });

  it('1,250 without currency unit', () => {
    unchanged('حصلت على 1,250 نقطة');
  });

  it('decimal with non-KWD unit count is left unchanged', () => {
    unchanged('1.5 مليون');
  });

  it('four-digit number without year context', () => {
    unchanged('كود المنتج هو 1990');
  });

  it('phone-like number is left unchanged', () => {
    unchanged('اتصل على 97250000');
  });
});

// ---------------------------------------------------------------------------
// 8. Eastern Arabic digits
// ---------------------------------------------------------------------------
describe('Eastern Arabic digits', () => {
  it('٥٠٬٠٠٠ — Eastern thousands separator converted to comma then expanded', () => {
    // ٬ (U+066C) is normalised to ASCII comma, then digits are converted,
    // so ٥٠٬٠٠٠ دينار كويتي behaves identically to 50,000 دينار كويتي.
    expect(normalizeArabicForTTS('٥٠٬٠٠٠ دينار كويتي')).toBe('خمسين ألف دينار كويتي');
  });

  it('Western digits in Arabic context: 50,000 دينار كويتي', () => {
    expect(normalizeArabicForTTS('50,000 دينار كويتي')).toBe('خمسين ألف دينار كويتي');
  });

  it('Eastern Arabic numeral in KWD pattern', () => {
    // ٥٠٠ → 500 after digit normalisation, then plain integer + currency fires
    expect(normalizeArabicForTTS('٥٠٠ دينار كويتي')).toBe('خمسمئة دينار كويتي');
  });

  it('Eastern Arabic percentage', () => {
    expect(normalizeArabicForTTS('٣٠%')).toBe('ثلاثين بالمئة');
  });
});

// ---------------------------------------------------------------------------
// 9. Idempotency
// ---------------------------------------------------------------------------
describe('idempotency', () => {
  const cases = [
    '50,000 دينار كويتي',
    '1.250 KWD',
    '30%',
    '2.5%',
    'في عام 2024',
    '1.250',
    'حدثنا عن نفسك',
  ];

  for (const input of cases) {
    it(`idempotent: "${input}"`, () => {
      const once  = normalizeArabicForTTS(input);
      const twice = normalizeArabicForTTS(once);
      expect(twice).toBe(once);
    });
  }
});

// ---------------------------------------------------------------------------
// 10. Mixed content (multiple patterns in one question)
// ---------------------------------------------------------------------------
describe('multiple patterns in one question', () => {
  it('question with both percentage and KWD amount', () => {
    const input  = 'إذا كانت ميزانيتك 50,000 دينار كويتي وأردت تخصيص 20% للتسويق';
    const output = normalizeArabicForTTS(input);
    expect(output).toContain('خمسين ألف دينار كويتي');
    expect(output).toContain('عشرين بالمئة');
    expect(output).not.toContain('50,000');
    expect(output).not.toContain('20%');
  });

  it('question with year and percentage', () => {
    const input  = 'حقق الفريق في عام 2022 نمواً بنسبة 15%';
    const output = normalizeArabicForTTS(input);
    expect(output).toContain('في عام ألفين واثنين وعشرين');
    expect(output).toContain('خمسة عشر بالمئة');
  });
});

// ---------------------------------------------------------------------------
// 11. Edge cases – large and boundary numbers
// ---------------------------------------------------------------------------
describe('boundary numbers', () => {
  it('intToArabicWords via 1,000,000 KWD', () => {
    expect(normalizeArabicForTTS('1,000,000 KWD')).toBe('مليون دينار كويتي');
  });

  it('intToArabicWords via 2,000,000 دينار كويتي — construct state مِلْيُونَي (diacritics for Yasser)', () => {
    expect(normalizeArabicForTTS('2,000,000 دينار كويتي')).toBe('مِلْيُونَي دينار كويتي');
  });

  it('200 دينار كويتي — construct state مئتي (ن drops before currency noun)', () => {
    expect(normalizeArabicForTTS('200 دينار كويتي')).toBe('مئتي دينار كويتي');
  });

  it('11 KWD', () => {
    expect(normalizeArabicForTTS('11 KWD')).toBe('أحد عشر دينار كويتي');
  });

  it('1000 دينار كويتي', () => {
    expect(normalizeArabicForTTS('1000 دينار كويتي')).toBe('ألف دينار كويتي');
  });

  it('2000 دينار كويتي — construct state ألفي (ن drops before currency noun)', () => {
    expect(normalizeArabicForTTS('2000 دينار كويتي')).toBe('ألفي دينار كويتي');
  });

  it('200,000 KWD — construct state مئتي ألف (ن drops before ألف)', () => {
    expect(normalizeArabicForTTS('200,000 KWD')).toBe('مئتي ألف دينار كويتي');
  });

  it('12,345 KWD — compound: ألفاً correct since remainder > 0', () => {
    expect(normalizeArabicForTTS('12,345 KWD'))
      .toBe('اثني عشر ألفاً وثلاثمئة وخمسة وأربعين دينار كويتي');
  });
});

// ---------------------------------------------------------------------------
// 12. Partial match prevention
// ---------------------------------------------------------------------------
describe('partial match prevention', () => {
  it('1.5 KWD — two decimals, not a KWD fils pattern', () => {
    unchanged('1.5 KWD');
  });

  it('1.50 KWD — two decimals with trailing zero', () => {
    unchanged('1.50 KWD');
  });

  it('ref1.250 KWD — alphanumeric prefix prevents match', () => {
    unchanged('ref1.250 KWD');
  });

  it('v2.500 KWD — letter prefix prevents match', () => {
    unchanged('v2.500 KWD');
  });
});

// ---------------------------------------------------------------------------
// 13. KWD grammar (singular / dual / broken plural 3-10 / singular 11+)
// ---------------------------------------------------------------------------
describe('KWD grammar forms', () => {
  it('1 KWD → دينار كويتي واحد', () => {
    expect(normalizeArabicForTTS('1 KWD')).toBe('دينار كويتي واحد');
  });

  it('2 KWD → دينارين كويتيين', () => {
    expect(normalizeArabicForTTS('2 KWD')).toBe('دينارين كويتيين');
  });

  it('3 KWD → ثلاثة دنانير كويتية', () => {
    expect(normalizeArabicForTTS('3 KWD')).toBe('ثلاثة دنانير كويتية');
  });

  it('10 KWD → عشرة دنانير كويتية', () => {
    expect(normalizeArabicForTTS('10 KWD')).toBe('عشرة دنانير كويتية');
  });

  it('11 KWD → أحد عشر دينار كويتي (singular after 11)', () => {
    expect(normalizeArabicForTTS('11 KWD')).toBe('أحد عشر دينار كويتي');
  });
});

// ---------------------------------------------------------------------------
// 14. Fils grammar (singular / dual / plural 3-10 / accusative 11+)
// ---------------------------------------------------------------------------
describe('fils grammar forms', () => {
  it('0.001 KWD → one fils with diacritics (zero dinar suppressed, Yasser fix)', () => {
    expect(normalizeArabicForTTS('0.001 KWD')).toBe('فِلْس واحد');
  });

  it('0.002 KWD → dual fils (zero dinar suppressed)', () => {
    expect(normalizeArabicForTTS('0.002 KWD')).toBe('فلسين');
  });

  it('0.003 KWD → plural fils (zero dinar suppressed)', () => {
    expect(normalizeArabicForTTS('0.003 KWD')).toBe('ثلاثة فلوس');
  });

  it('0.250 KWD → 250 fils with tamyiz (zero dinar suppressed)', () => {
    expect(normalizeArabicForTTS('0.250 KWD')).toBe('مئتين وخمسين فلساً');
  });
});

// ---------------------------------------------------------------------------
// 15. Decimal percentage expansion (exact fractions only)
// ---------------------------------------------------------------------------
describe('decimal percentage expansion', () => {
  it('0.5% → نصف بالمئة', () => {
    expect(normalizeArabicForTTS('0.5%')).toBe('نصف بالمئة');
  });

  it('0.25% → ربع بالمئة', () => {
    expect(normalizeArabicForTTS('0.25%')).toBe('ربع بالمئة');
  });

  it('2.5% → اثنين ونصف بالمئة', () => {
    expect(normalizeArabicForTTS('2.5%')).toBe('اثنين ونصف بالمئة');
  });

  it('12.75% → اثني عشر وثلاثة أرباع بالمئة', () => {
    expect(normalizeArabicForTTS('12.75%')).toBe('اثني عشر وثلاثة أرباع بالمئة');
  });

  it('1.33% — unsupported fraction keeps numeral', () => {
    expect(normalizeArabicForTTS('1.33%')).toBe('1.33 بالمئة');
  });

  it('33.3% — unsupported fraction keeps numeral', () => {
    expect(normalizeArabicForTTS('33.3%')).toBe('33.3 بالمئة');
  });
});

// ---------------------------------------------------------------------------
// 16. Grammar-form regression guard
// ---------------------------------------------------------------------------
describe('grammar form regression', () => {
  // ONES[2] / TEENS[2] stay accusative: near-always non-nominative in context
  it('2% uses accusative اثنين for the number 2', () => {
    expect(normalizeArabicForTTS('2%')).toBe('اثنين بالمئة');
  });

  it('12.75% uses accusative اثني عشر', () => {
    expect(normalizeArabicForTTS('12.75%')).toBe('اثني عشر وثلاثة أرباع بالمئة');
  });

  it('2 KWD uses dual دينارين كويتيين (accusative)', () => {
    expect(normalizeArabicForTTS('2 KWD')).toBe('دينارين كويتيين');
  });

  // TENS use oblique form throughout (natural for currency/percentage/year contexts)
  it('22% uses اثنين in ones place and oblique عشرين in tens', () => {
    expect(normalizeArabicForTTS('22%')).toBe('اثنين وعشرين بالمئة');
  });

  it('35% → خمسة وثلاثين بالمئة (oblique tens)', () => {
    expect(normalizeArabicForTTS('35%')).toBe('خمسة وثلاثين بالمئة');
  });

  it('20% → عشرين بالمئة (oblique tens)', () => {
    expect(normalizeArabicForTTS('20%')).toBe('عشرين بالمئة');
  });

  // Conditional ألفاً: tanwin only when remainder > 0
  it('round thousands: 50,000 uses ألف without tanwin (direct idafa)', () => {
    expect(normalizeArabicForTTS('50,000 دينار كويتي')).toBe('خمسين ألف دينار كويتي');
  });

  it('round thousands: 12,000 uses ألف without tanwin', () => {
    expect(normalizeArabicForTTS('12,000 KWD')).toBe('اثني عشر ألف دينار كويتي');
  });

  it('compound thousands: 12,345 uses ألفاً (remainder 345 breaks idafa)', () => {
    expect(normalizeArabicForTTS('12,345 KWD'))
      .toContain('اثني عشر ألفاً');
  });

  // Construct state: dual directly before currency noun — ن drops
  it('200 KWD → مئتي (construct, not مئتين)', () => {
    expect(normalizeArabicForTTS('200 KWD')).toBe('مئتي دينار كويتي');
  });

  it('2000 KWD → ألفي (construct, not ألفين)', () => {
    expect(normalizeArabicForTTS('2000 KWD')).toBe('ألفي دينار كويتي');
  });

  it('200,000 KWD → مئتي ألف (construct in thousands multiplier)', () => {
    expect(normalizeArabicForTTS('200,000 KWD')).toBe('مئتي ألف دينار كويتي');
  });

  // Zero-dinar suppression: 0.XXX KWD outputs only fils
  it('zero dinar suppression: 0.XXX KWD outputs only fils', () => {
    const cases: [string, string][] = [
      ['0.001 KWD', 'فِلْس واحد'],
      ['0.002 KWD', 'فلسين'],
      ['0.010 KWD', 'عشرة فلوس'],
      ['0.100 KWD', 'مئة فلساً'],
      ['0.250 KWD', 'مئتين وخمسين فلساً'],
      ['0.500 KWD', 'خمسمئة فلساً'],
      ['0.999 KWD', 'تسعمئة وتسعة وتسعين فلساً'],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeArabicForTTS(input)).toBe(expected);
    }
  });
});
