import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });

const sessions = [
  { label: 'PP row #1 ($19 parcel, post-oak)', id: 'cs_live_a1hmCO5XrF1DkTWN7aesN1KYclaiYOaW1gqn6jAg4eB4kDnt5hqMLsG2be' },
  { label: 'PP row #2 ($19 parcel, boone)', id: 'cs_live_a1ybvmuEzek3BsNSrK1VLWKmFcTKyMrBJZZqCAxgmM9Fmrp9ZHzaBqTgYW' },
  { label: 'Order hunt_report (from /map)', id: 'cs_live_a1XGb4VZ9jDB2olpcp7x1gKSvYpGY4NBZvkQmAyjjLU0EwcEENmzPQcWRN' },
];

for (const s of sessions) {
  try {
    const sess = await stripe.checkout.sessions.retrieve(s.id, { expand: ['line_items', 'line_items.data.price'] });
    console.log('\n=== ' + s.label + ' ===');
    console.log('  id:', sess.id);
    console.log('  status:', sess.status, '| payment_status:', sess.payment_status);
    console.log('  amount_total:', sess.amount_total, '(', (sess.amount_total/100).toFixed(2), sess.currency + ')');
    console.log('  mode:', sess.mode);
    console.log('  customer_email:', sess.customer_email);
    console.log('  created:', new Date(sess.created*1000).toISOString());
    for (const li of sess.line_items?.data || []) {
      console.log('  line_item:', li.description, '| qty=', li.quantity, '| amount_total=', li.amount_total);
      if (li.price) {
        console.log('    price.id:', li.price.id);
        console.log('    price.unit_amount:', li.price.unit_amount);
        console.log('    price.product:', li.price.product);
      }
    }
  } catch (e) {
    console.log('\n=== ' + s.label + ' ===\n  ERROR:', e.message);
  }
}
