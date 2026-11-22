'use strict';
/* A supplier's terms of sale, and how much open credit a pharmacy already has with it. */

const POLICY_COLS = 'allow_full, allow_partial, deposit_percent, allow_credit, credit_days, credit_limit, min_order_value, bank_details';

function shapePolicy(o) {
  return {
    allow_full: !!o.allow_full, allow_partial: !!o.allow_partial, deposit_percent: o.deposit_percent,
    allow_credit: !!o.allow_credit, credit_days: o.credit_days, credit_limit: o.credit_limit,
    min_order_value: o.min_order_value, bank_details: o.bank_details || null,
  };
}

function getPolicy(db, supplierId) {
  const o = db.prepare(`SELECT ${POLICY_COLS} FROM organizations WHERE id = ? AND type = 'supplier'`).get(supplierId);
  return o ? shapePolicy(o) : null;
}

/** Unpaid balance of the pharmacy's live credit orders with this supplier. */
function creditOutstanding(db, pharmacyId, supplierId) {
  return db.prepare(`
    SELECT COALESCE(SUM(total - paid_amount), 0) AS n FROM orders
     WHERE pharmacy_id = ? AND supplier_id = ? AND payment_terms = 'credit'
       AND status NOT IN ('rejected', 'cancelled') AND paid_amount < total`).get(pharmacyId, supplierId).n;
}

module.exports = { POLICY_COLS, shapePolicy, getPolicy, creditOutstanding };
