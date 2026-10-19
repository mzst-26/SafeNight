/**
 * Plan data for the /pricing page and the plan offers in structured data.
 *
 * Only fields confirmed in the repo are listed here. Sources are noted per
 * plan so a price change is easy to trace. Figures are in GBP. Any price text
 * on a page must be built from these values, not typed in.
 */

export interface PricingPlan {
  name: string;
  /** Price in GBP per period. Null when there is no price (Free). */
  priceGbp: number | null;
  /** Billing period for priceGbp. Null when there is no price (Free). */
  period: 'month' | null;
  description: string;
  /** Minimum number of people (including the owner) for group plans. */
  minMembers?: number;
  /** What the plan includes, rendered as a list on /pricing. */
  features: string[];
}

/** Family Pack price per user per month (GBP). Used to derive the saving. */
const FAMILY_PRICE_GBP = 3;

const FREE_PLAN: PricingPlan = {
  // README.md:704 (Free column), README.md:707 (1 km route limit),
  // backend/src/user/lib/subscriptionConfig.js:55 (free route_distance limit 1)
  name: 'Free',
  priceGbp: 0,
  period: null,
  description: 'Limited route searches, navigation and live location sharing to try SafeNight.',
  // README.md:704-709 says "Limited" for these, so no number is given for them.
  features: [
    'Limited route searches',
    'Routes up to 1 km',
    'Limited navigation sessions',
    'Limited emergency contacts',
    'Limited AI explanations',
    'Limited live location sharing',
  ],
};

export const GUARDED_PLAN: PricingPlan = {
  // README.md:704 (£4.99/mo), backend/src/subscription/lib/plans.js:13-17,
  // src/components/modals/SubscriptionModal.tsx:43-46
  name: 'Guarded',
  priceGbp: 4.99,
  period: 'month',
  description: 'Full safety suite for regular walkers.',
  // README.md:706-711, SubscriptionModal.tsx:49-54. Route cap 10 km: subscriptionConfig.js:53-56
  features: [
    'Unlimited route searches',
    'Routes up to 10 km (about 6 miles)',
    'Unlimited navigation sessions',
    '5 emergency contacts',
    '10 AI explanations a day',
    'Unlimited live location sharing',
  ],
};

export const FAMILY_PLAN: PricingPlan = {
  // README.md:91, README.md:704 (£3/user/mo), README.md:712 (minimum 3),
  // backend/src/subscription/lib/plans.js:19-23, backend/src/user/routes/family.js:25
  name: 'Family Pack',
  priceGbp: FAMILY_PRICE_GBP,
  period: 'month',
  description: 'Guarded for groups of three or more people.',
  minMembers: 3,
  features: [
    'Unlimited route searches',
    'Routes up to 10 km (about 6 miles)',
    'Unlimited navigation sessions',
    '5 emergency contacts',
    '10 AI explanations a day',
    'Unlimited live location sharing',
    `Saves £${((GUARDED_PLAN.priceGbp ?? 0) - FAMILY_PRICE_GBP).toFixed(2)} per person compared with an individual Guarded plan`,
  ],
};

export const PLANS: PricingPlan[] = [FREE_PLAN, GUARDED_PLAN, FAMILY_PLAN];
