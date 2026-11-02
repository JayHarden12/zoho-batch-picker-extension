// Run from the extension folder (macOS, no Node needed):
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/batch-plan.test.js
load('batch-plan.js');

const { planItem, notesFor, parseIsoDate, parseExpiry, formatDate, todayUtc, roundQty } = BatchPlan;
const today = Date.UTC(2026, 9, 31);
const day = 86400000;
const batch = (id, expiry, available) => ({ id, label: id, expiry, available });
let failed = 0;
let passed = 0;

function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  print(`FAIL ${name}\n  got      ${a}\n  expected ${e}`);
}

const ids = r => r.lines.map(l => [l.id, l.qty]);

eq(ids(planItem(3, [batch('late', today + 90 * day, 5), batch('soon', today + 9 * day, 5)], today)),
   [['soon', 3]], 'soonest expiry goes first');
eq(ids(planItem(7, [batch('late', today + 90 * day, 5), batch('soon', today + 9 * day, 5)], today)),
   [['soon', 5], ['late', 2]], 'spills into the next batch');

let r = planItem(2, [batch('old', today - day, 5), batch('good', today + day, 5)], today);
eq(ids(r), [['good', 2]], 'expired batch is skipped');
eq(r.expired, ['old'], 'expired batch is reported');
eq(ids(planItem(1, [batch('today', today, 5)], today)), [['today', 1]], 'expiring today is still usable');

r = planItem(2, [batch('old', today - day, 5)], today);
eq([r.lines.length, r.shortage], [0, 2], 'only expired stock means a shortage');
eq(notesFor({ ...r }), ['No usable stock (needs 2)', 'Skipped expired batch old'], 'notes for expired-only item');

r = planItem(4, [batch('none', null, 5), batch('dated', today + day, 2)], today);
eq(ids(r), [['dated', 2], ['none', 2]], 'no-expiry batch goes last');
eq(r.noExpiry, ['none'], 'no-expiry batch is reported');
eq(planItem(1, [batch('none', null, 5), batch('dated', today + day, 2)], today).noExpiry, [],
   'unused no-expiry batch is not reported');

r = planItem(2, [batch('unknown', today + day, null), batch('known', today + 9 * day, 5)], today);
eq(ids(r), [['known', 2]], 'unreadable stock is never used');
eq(r.unknownStock, ['unknown'], 'unreadable stock is reported');
r = planItem(2, [batch('unknown', today + day, null)], today);
eq([r.lines.length, r.shortage], [0, 2], 'all unreadable stock assigns nothing');

eq(planItem(5, [batch('a', today + day, 3)], today).shortage, 2, 'shortage is the amount missing');
eq(ids(planItem(1, [batch('empty', today + day, 0), batch('b', today + 2 * day, 1)], today)),
   [['b', 1]], 'empty batch is skipped');

const reserved = {};
const stock = [batch('a', today + day, 3), batch('b', today + 2 * day, 3)];
eq(ids(planItem(2, stock, today, reserved)), [['a', 2]], 'first line takes from a');
eq(ids(planItem(2, stock, today, reserved)), [['a', 1], ['b', 1]], 'second line sees what is left');
eq(reserved, { a: 3, b: 1 }, 'reservations are recorded');

eq(ids(planItem(0.3, [batch('a', today + day, 0.1), batch('b', today + 2 * day, 0.2)], today)),
   [['a', 0.1], ['b', 0.2]], 'decimal quantities stay clean');
eq(planItem(0.3, [batch('a', today + day, 0.1), batch('b', today + 2 * day, 0.2)], today).shortage, 0,
   'decimal quantities leave no shortage');
eq(roundQty(0.1 + 0.2), 0.3, 'roundQty');

eq(parseIsoDate('2027-01-12'), Date.UTC(2027, 0, 12), 'parseIsoDate');
eq([parseIsoDate(''), parseIsoDate(undefined)], [null, null], 'parseIsoDate with no date');
eq(parseExpiry('B-100 | Balance in batch: 224 Pack(s) | Manufactured date: 2026-02-01 | Expiry Date: 2029-02-28'),
   Date.UTC(2029, 1, 28), 'parseExpiry ignores the manufactured date (real Zoho text)');
eq(parseExpiry('B-200 Balance in batch: 80 Pack(s) Manufactured date: 2026-03-01 Expiry Date: 2029-03-01'),
   Date.UTC(2029, 2, 1), 'parseExpiry on one line');
eq(parseExpiry('X | Balance in batch: 5 | Manufactured date: 2026-03-01'), null, 'manufactured date alone is not an expiry');
eq(parseExpiry('X | 12/01/2029'), Date.UTC(2029, 0, 12), 'unlabelled day/month/year date');
eq(parseExpiry('X | Expires: Jan 12, 2029'), Date.UTC(2029, 0, 12), 'labelled named date');
eq(parseExpiry('X | Expiry Date: 2020-01-01'), Date.UTC(2020, 0, 1), 'a truly expired date is still read');
eq(parseExpiry('Plain batch'), null, 'no date');
eq(formatDate(Date.UTC(2027, 0, 5)), '05 Jan 2027', 'formatDate');
eq(formatDate(null), '—', 'formatDate with no date');
eq(todayUtc(new Date(2026, 9, 31, 23, 30)), Date.UTC(2026, 9, 31), 'todayUtc late in the day');

print(`${passed} passed, ${failed} failed`);
if (failed) quit(1);
