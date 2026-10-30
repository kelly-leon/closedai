export interface PricePackage {
  priceKsh: number;
  tokens: number | null;
  premiumMonths: number;
}

// Keep these values synchronized with the seeded backend packages.
export const BILLING_PACKAGES: PricePackage[] = [
  { priceKsh: 50, tokens: 500, premiumMonths: 0 },
  { priceKsh: 100, tokens: 1200, premiumMonths: 0 },
  { priceKsh: 200, tokens: 2500, premiumMonths: 0 },
  { priceKsh: 300, tokens: 5600, premiumMonths: 0 },
  { priceKsh: 500, tokens: 10000, premiumMonths: 0 },
  { priceKsh: 1000, tokens: null, premiumMonths: 3 },
];
