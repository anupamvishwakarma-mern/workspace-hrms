const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

/** Integer minor units (paise/cents) -> "₹44,000.00". Indian digit grouping for INR, international otherwise. */
export function formatMoney(minor: number, currency: string): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  let s = String(whole);
  if (currency === 'INR' && s.length > 3) {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    s = `${rest},${last3}`;
  } else s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${SYMBOL[currency] ?? `${currency} `}${s}.${cents}`;
}

/** The full-month amount of a structure component (FIXED, or a percent of BASIC). */
export function componentAmountMinor(
  c: { code: string; calc: 'FIXED' | 'PERCENT_OF_BASIC'; value: number },
  basicMinor: number,
): number {
  return c.calc === 'FIXED' ? c.value : Math.floor((2 * basicMinor * c.value + 10000) / 20000);
}
