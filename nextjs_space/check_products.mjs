import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });

const ids = ['prod_UNPJ9QlYkXIx4Q', 'prod_UOWlzO2g6pDaGb'];
for (const id of ids) {
  const p = await stripe.products.retrieve(id);
  console.log(id, '→', p.name, '|', p.description);
}

// Also list all active Prices for Hunt products to confirm
const prices = await stripe.prices.list({ limit: 20, active: true });
console.log('\nActive prices on this Stripe account:');
prices.data.forEach(p => console.log(`  ${p.id} | $${(p.unit_amount||0)/100} ${p.currency} | product=${p.product} | nickname=${p.nickname||'(none)'}`));
