/**
 * Exact Monetary and Currency Calculations
 * All calculations use integer minor units (Cents) to completely avoid IEEE-754 floating-point inaccuracies.
 */

export function dollarsToCents(dollars: number | string): bigint {
  const num = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  if (isNaN(num)) return BigInt(0);
  return BigInt(Math.round(num * 100));
}

export function centsToDollars(cents: bigint | number): number {
  return Number(cents) / 100;
}

export function formatCents(cents: bigint | number, currency = 'USD'): string {
  const dollars = centsToDollars(cents);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

export interface LineItemCalculation {
  quantity: number;
  unitPriceCents: bigint;
  discountPercent: number; // e.g. 10 for 10%
  taxPercent: number;      // e.g. 5 for 5%
  subtotalCents: bigint;
  discountCents: bigint;
  taxCents: bigint;
  totalCents: bigint;
}

export function calculateLineItem(
  quantity: number,
  unitPriceCents: bigint | number,
  discountPercent = 0,
  taxPercent = 0
): LineItemCalculation {
  const qty = Math.max(1, Math.floor(quantity));
  const price = BigInt(unitPriceCents);
  const subtotalCents = price * BigInt(qty);

  // Discount calculation
  const discPercent = Math.max(0, Math.min(100, Number(discountPercent)));
  const discountCents = BigInt(Math.round(Number(subtotalCents) * (discPercent / 100)));

  // Taxable amount
  const taxableCents = subtotalCents - discountCents;

  // Tax calculation
  const taxPct = Math.max(0, Math.min(100, Number(taxPercent)));
  const taxCents = BigInt(Math.round(Number(taxableCents) * (taxPct / 100)));

  // Total
  const totalCents = taxableCents + taxCents;

  return {
    quantity: qty,
    unitPriceCents: price,
    discountPercent: discPercent,
    taxPercent: taxPct,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents,
  };
}
