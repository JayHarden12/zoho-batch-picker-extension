/**
 * batch-plan.js — Zoho Batch Auto-Assign
 *
 * The batch-choosing rules, shared by content.js and service-worker.js.
 * No DOM or Chrome calls live here, so test/batch-plan.test.js can run it.
 *
 * A batch is { id, label, expiry, available }:
 *   expiry    — UTC midnight in ms, or null if there is none or it can't be read
 *   available — number, or null if it can't be read
 */
'use strict';

(function (root) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** Avoid float residue such as 0.30000000000000004 in quantities. */
  function roundQty(n) {
    return Math.round(n * 1e6) / 1e6;
  }

  /** Today's local calendar date as UTC midnight, comparable with expiry. */
  function todayUtc(now = new Date()) {
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /** "2027-01-12" → UTC midnight in ms, or null. */
  function parseIsoDate(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function formatDate(ms) {
    if (ms === null || ms === undefined) return '—';
    const d = new Date(ms);
    return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  /**
   * Choose batches for one line, soonest expiry first.
   * Expired batches and batches with unreadable stock are never used.
   * Batches with no expiry date go last.
   *
   * `reserved` is { batchId: qty } for the same item on earlier invoice
   * lines; it is updated so two lines can't both spend the same stock.
   */
  function planItem(needed, batches, today, reserved = {}) {
    const result = { lines: [], shortage: 0, expired: [], unknownStock: [], noExpiry: [] };
    const usable = [];

    for (const b of batches) {
      if (b.expiry !== null && b.expiry < today) {
        result.expired.push(b.label);
      } else if (b.available === null) {
        result.unknownStock.push(b.label);
      } else {
        const left = roundQty(b.available - (reserved[b.id] || 0));
        if (left > 0) usable.push({ ...b, left });
      }
    }

    usable.sort((a, b) => {
      if (a.expiry === null) return b.expiry === null ? 0 : 1;
      if (b.expiry === null) return -1;
      return a.expiry - b.expiry;
    });

    let remaining = needed;
    for (const b of usable) {
      if (remaining <= 0) break;
      const qty = roundQty(Math.min(b.left, remaining));
      result.lines.push({ id: b.id, label: b.label, expiry: b.expiry, qty });
      reserved[b.id] = roundQty((reserved[b.id] || 0) + qty);
      remaining = roundQty(remaining - qty);
      if (b.expiry === null) result.noExpiry.push(b.label);
    }

    result.shortage = Math.max(0, remaining);
    return result;
  }

  /** Plain-English warnings for one planned item. */
  function notesFor(item) {
    const notes = [];
    if (item.error) notes.push(item.error);
    if (item.shortage > 0) {
      notes.push(item.lines.length ? `Short by ${item.shortage}` : `No usable stock (needs ${item.shortage})`);
    }
    for (const label of item.expired) notes.push(`Skipped expired batch ${label}`);
    for (const label of item.unknownStock) notes.push(`Skipped ${label}: stock not readable, pick it by hand if needed`);
    for (const label of item.noExpiry) notes.push(`${label} has no readable expiry date, so it was used last`);
    return notes;
  }

  root.BatchPlan = { roundQty, todayUtc, parseIsoDate, formatDate, planItem, notesFor };
})(globalThis);
