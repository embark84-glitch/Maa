/*
 * Payment rules shared by the server and the web client, so both always
 * show and enforce the same amounts. Amounts are in minor units (1 LYD = 100).
 *
 *   full     the pharmacy pays the whole order before it is dispatched
 *   partial  a deposit (company's % of the total) before dispatch, the rest on delivery
 *   credit   nothing up front; the whole amount is due N days after delivery,
 *            within the credit limit the company gives each pharmacy
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MaaPayment = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TERMS = ['full', 'partial', 'credit'];

  function depositFor(total, percent) {
    return Math.round((total * percent) / 100);
  }

  /** Amount that must be paid before the company can dispatch the order. */
  function upfrontFor(terms, total, percent) {
    if (terms === 'full') return total;
    if (terms === 'partial') return depositFor(total, percent);
    return 0;
  }

  /**
   * The payment choices a company offers for an order of `total`.
   * `creditOutstanding` = unpaid balance of the pharmacy's open credit orders with this company.
   */
  function paymentOptions(policy, total, creditOutstanding = 0) {
    const out = [];
    if (policy.allow_full) out.push({ terms: 'full', upfront: total, later: 0, available: true });
    if (policy.allow_partial) {
      const upfront = depositFor(total, policy.deposit_percent);
      out.push({ terms: 'partial', percent: policy.deposit_percent, upfront, later: total - upfront, available: true });
    }
    if (policy.allow_credit) {
      const remaining = Math.max(0, policy.credit_limit - creditOutstanding);
      out.push({
        terms: 'credit', upfront: 0, later: total, days: policy.credit_days, limit: policy.credit_limit,
        outstanding: creditOutstanding, remaining, available: total <= remaining,
        reason: total <= remaining ? null : 'credit_limit',
      });
    }
    return out;
  }

  /** Cash the driver collects at the door (only the remainder of a partial payment). */
  function collectOnDelivery(order) {
    return order.payment_terms === 'partial' ? Math.max(0, order.total - order.paid_amount) : 0;
  }

  return { TERMS, depositFor, upfrontFor, paymentOptions, collectOnDelivery };
});
