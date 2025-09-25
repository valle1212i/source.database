// /services/stripeService.js
// Hybrid: idag "directKey" (tenantens egen secret), imorgon "connect" (plattform + stripeAccount).

const Stripe = require('stripe');

// ———————————————————————————————————————————————
// 1) MODELAGER
//    Vi bestämmer per tenant om vi ska köra directKey eller connect.
//    Idag: directKey (vi letar STRIPE_SECRET__{TENANT} eller global STRIPE_SECRET).
//    Imorgon: connect (vi använder plattformens STRIPE_PLATFORM_SECRET + stripeAccount: acct_...)
// ———————————————————————————————————————————————

async function getTenantStripeMode(tenant) {
  // TODO: Lägg gärna i DB (Settings) när ni börjar köra Connect.
  // Exempel: const s = await Settings.findOne({ tenant }); return s?.stripeMode || 'directKey';
  // Idag: auto-detektera. Finns connected acct i env? → 'connect'. Annars 'directKey'.
  const TEN = String(tenant).toUpperCase();

  const haveConnectAcct =
    process.env[`STRIPE_CONNECTED_ACCT__${TEN}`] // t.ex. acct_1ABC...
    || process.env[`STRIPE_ACCOUNT__${TEN}`];

  if (haveConnectAcct) return 'connect';

  // Standard nu: directKey
  return 'directKey';
}

// Hämtar connected account-id för tenant (på sikt från DB)
async function getConnectedAccountIdForTenant(tenant) {
  const TEN = String(tenant).toUpperCase();
  const acct =
    process.env[`STRIPE_CONNECTED_ACCT__${TEN}`]
    || process.env[`STRIPE_ACCOUNT__${TEN}`];
  if (!acct) throw new Error(`Saknar mapping tenant→connected account för ${tenant}`);
  return acct;
}

// ———————————————————————————————————————————————
// 2) KLIENTUPPSLAG
// ———————————————————————————————————————————————

function getDirectKeyForTenant(tenant) {
  const TEN = String(tenant).toUpperCase();
  const candidates = [
    `STRIPE_SECRET__${TEN}`,
    `STRIPE_API_KEY__${TEN}`,
    `STRIPE_PRIVATE_KEY__${TEN}`,
    'STRIPE_SECRET',
    'STRIPE_API_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_PRIVATE_KEY',
  ];
  for (const k of candidates) {
    const v = process.env[k];
    if (v) return v;
  }
  throw new Error(
    `Stripe key saknas för tenant=${tenant}. Ange någon av: ${candidates.join(', ')}`
  );
}

let platformStripe = null;
function getPlatformClient() {
  if (platformStripe) return platformStripe;
  const key =
    process.env.STRIPE_PLATFORM_SECRET ||
    process.env.STRIPE_SECRET || // tillåt global om du vill återanvända samma nyckel
    process.env.STRIPE_API_KEY;
  if (!key) {
    throw new Error(`Plattformsnyckel saknas (för Connect). Sätt STRIPE_PLATFORM_SECRET eller STRIPE_SECRET.`);
  }
  platformStripe = new Stripe(key, { apiVersion: '2024-06-20' });
  return platformStripe;
}

// Returnerar { stripe, stripeAccount } där stripeAccount är null i directKey-läge
async function getStripeContext(tenant) {
  if (!tenant) throw new Error('Tenant saknas (X-Tenant-header).');

  const mode = await getTenantStripeMode(tenant);

  if (mode === 'directKey') {
    const key = getDirectKeyForTenant(tenant);
    const client = new Stripe(key, { apiVersion: '2024-06-20' });
    return { stripe: client, stripeAccount: null, mode };
  }

  if (mode === 'connect') {
    const client = getPlatformClient();
    const acct = await getConnectedAccountIdForTenant(tenant);
    return { stripe: client, stripeAccount: acct, mode };
  }

  throw new Error(`Okänt Stripe-läge för ${tenant}: ${mode}`);
}

// ———————————————————————————————————————————————
// 3) API-FUNKTIONER (samma signatur oavsett läge)
// ———————————————————————————————————————————————

async function listPayouts(tenant, { starting_after, limit = 30 } = {}) {
  const { stripe, stripeAccount } = await getStripeContext(tenant);
  const params = { limit, ...(starting_after ? { starting_after } : {}) };
  return stripe.payouts.list(params, stripeAccount ? { stripeAccount } : undefined);
}

async function retrievePayout(tenant, payoutId) {
  const { stripe, stripeAccount } = await getStripeContext(tenant);
  return stripe.payouts.retrieve(payoutId, stripeAccount ? { stripeAccount } : undefined);
}

async function listBalanceTransactionsForPayout(tenant, payoutId, { limit = 100, starting_after } = {}) {
  const { stripe, stripeAccount } = await getStripeContext(tenant);
  const params = { payout: payoutId, limit, ...(starting_after ? { starting_after } : {}) };
  return stripe.balanceTransactions.list(params, stripeAccount ? { stripeAccount } : undefined);
}

async function listBalanceTransactionsByDate(tenant, { from, to, limit = 100, starting_after } = {}) {
  if (typeof from !== 'number' || typeof to !== 'number') {
    throw new Error('from/to måste vara Unix-sekunder (Number).');
  }
  const { stripe, stripeAccount } = await getStripeContext(tenant);
  const params = { created: { gte: from, lte: to }, limit, ...(starting_after ? { starting_after } : {}) };
  return stripe.balanceTransactions.list(params, stripeAccount ? { stripeAccount } : undefined);
}

// ———————————————————————————————————————————————
// 4) Hjälpmetoder
// ———————————————————————————————————————————————

function summarizeTransactions(txns = []) {
  let gross = 0, fees = 0, net = 0;
  const counts = { charges: 0, refunds: 0, adjustments: 0, transfers: 0, other: 0 };
  for (const t of txns) {
    gross += t.amount || 0;
    fees  += t.fee || 0;
    net   += t.net || 0;
    const rc = t.reporting_category || t.type || 'other';
    if (rc.includes('charge')) counts.charges++;
    else if (rc.includes('refund')) counts.refunds++;
    else if (rc.includes('adjustment')) counts.adjustments++;
    else if (rc.includes('transfer')) counts.transfers++;
    else counts.other++;
  }
  return { gross, fees, net, counts };
}

function toUnixSeconds(v) {
  if (typeof v === 'number') return Math.floor(v);
  const ts = new Date(v).getTime();
  if (Number.isNaN(ts)) throw new Error('Ogiltigt datumvärde.');
  return Math.floor(ts / 1000);
}

module.exports = {
  listPayouts,
  retrievePayout,
  listBalanceTransactionsForPayout,
  listBalanceTransactionsByDate,
  summarizeTransactions,
  toUnixSeconds,

  // ev. användbara att exportera om ni bygger UI för läge/mappning:
  getTenantStripeMode,
  getConnectedAccountIdForTenant,
};
