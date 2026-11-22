/*
 * Order by photo: the prompt sent to Claude with a photo, and the check of its
 * answer against the company's real catalogue. Shared by the Node server (Claude
 * API) and the browser demo (the viewer's Claude), so both behave the same.
 *
 * The photo can be packs on a shelf, a handwritten or printed shortage list, or
 * an old invoice. Claude may only pick product ids from the catalogue it is given;
 * anything else comes back as "not found" for the pharmacist to see. Nothing is
 * added to the order until the pharmacist confirms.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MaaRecognize = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_CATALOG = 600;
  const MAX_ITEMS = 60;

  /** JSON schema of the answer (used for structured output on the Claude API). */
  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['product_id', 'name_seen', 'quantity', 'confidence'],
          properties: {
            product_id: { type: ['integer', 'null'] },
            name_seen: { type: 'string' },
            quantity: { type: ['integer', 'null'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
    },
  };

  const line = (p) => [p.id, [p.name, p.strength, p.form, p.pack_size].filter(Boolean).join(' '), p.generic_name || ''].join(' | ');

  /** The instruction and catalogue, as one prompt. */
  function buildPrompt(products) {
    const list = products.slice(0, MAX_CATALOG).map(line).join('\n');
    return `A pharmacy's purchasing manager took this photo to reorder medicines from one supplier.
The photo may show medicine packs on a shelf, a handwritten or printed list of items to order, or an old invoice.

List each distinct medicine you can actually read in the photo and match it to the supplier's catalogue below by brand name, strength and form.
Rules:
- Use only product_id values from the catalogue. If a medicine is not in the catalogue, set product_id to null and write what you read in name_seen.
- If the photo shows a quantity to order for an item (a written number next to it), put it in quantity; otherwise quantity is null. Do not count boxes on a shelf as a quantity.
- confidence is "high" when the name and strength are clearly readable, "medium" when the name is clear but the strength or form is not, "low" otherwise.
- Do not list medicines you cannot read. Do not invent items.

Reply with only JSON in this shape:
{"items":[{"product_id":12,"name_seen":"Doliprane Vitamine C 500mg","quantity":null,"confidence":"high"}]}

Catalogue (id | product | generic name):
${list}`;
  }

  /**
   * Keep only what can be trusted: known product ids (one entry each), whole positive
   * quantities, and readable names for the items that are not in the catalogue.
   */
  function parseMatches(value, products) {
    const byId = new Map(products.map((p) => [p.id, p]));
    const items = Array.isArray(value?.items) ? value.items.slice(0, MAX_ITEMS) : [];
    const matched = new Map();
    const notFound = [];
    for (const it of items) {
      const seen = typeof it?.name_seen === 'string' ? it.name_seen.trim().slice(0, 120) : '';
      const id = Number(it?.product_id);
      const qty = Number.isInteger(it?.quantity) && it.quantity > 0 && it.quantity < 100000 ? it.quantity : null;
      const confidence = ['high', 'medium', 'low'].includes(it?.confidence) ? it.confidence : 'low';
      if (Number.isInteger(id) && byId.has(id)) {
        const prev = matched.get(id);
        if (!prev) matched.set(id, { product_id: id, name_seen: seen, quantity: qty, confidence });
        else if (qty && (!prev.quantity || qty > prev.quantity)) prev.quantity = qty;
      } else if (seen && !notFound.includes(seen)) {
        notFound.push(seen);
      }
    }
    return { matches: [...matched.values()], not_found: notFound };
  }

  return { SCHEMA, buildPrompt, parseMatches, MAX_CATALOG };
});
