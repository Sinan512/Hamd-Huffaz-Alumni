var ContributionPayment = require('../models/ContributionPayment');

var FEE = 30;
var IST = 'Asia/Kolkata';

function istMonth(now) {
  var parts = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: 'numeric' }).formatToParts(now || new Date());
  var value = {};
  parts.forEach(function (p) { value[p.type] = p.value; });
  return { year: Number(value.year), month: Number(value.month) };
}

function key(year, month) { return Number(year) + '-' + Number(month); }
function validMonth(year, month) { return Number.isInteger(Number(year)) && Number(year) >= 2000 && Number(year) <= 2100 && Number.isInteger(Number(month)) && Number(month) >= 1 && Number(month) <= 12; }
function compare(a, b) { return a.year === b.year ? a.month - b.month : a.year - b.year; }
function next(value) { return value.month === 12 ? { year: value.year + 1, month: 1 } : { year: value.year, month: value.month + 1 }; }

function configuredStart(setup) {
  if (!setup || !validMonth(setup.contributionStartYear, setup.contributionStartMonth)) return null;
  return { year: Number(setup.contributionStartYear), month: Number(setup.contributionStartMonth) };
}

function memberStart(member, setup) {
  var start = configuredStart(setup);
  if (!start || !member || !member.contributionActive) return null;
  var created = member.createdAt ? istMonth(new Date(member.createdAt)) : start;
  var effective = member.contributionEffectiveAt ? istMonth(new Date(member.contributionEffectiveAt)) : created;
  if (compare(created, start) > 0) start = created;
  if (compare(effective, start) > 0) start = effective;
  return start;
}

async function ensureLedger(member, setup) {
  var start = memberStart(member, setup);
  if (!start) return null;
  var current = istMonth();
  if (compare(start, current) > 0) return await ContributionPayment.findOne({ memberId: member._id });
  var ledger = await ContributionPayment.findOne({ memberId: member._id });
  if (!ledger) ledger = new ContributionPayment({ memberId: member._id, paymentsStatus: [] });
  var existing = {};
  ledger.paymentsStatus.forEach(function (p) { existing[key(p.year, p.month)] = true; });
  var cursor = start;
  var changed = false;
  while (compare(cursor, current) <= 0) {
    if (!existing[key(cursor.year, cursor.month)]) {
      ledger.paymentsStatus.push({ month: cursor.month, year: cursor.year, amount: FEE, status: 'NOT_PAID' });
      changed = true;
    }
    cursor = next(cursor);
  }
  if (changed || ledger.isNew) await ledger.save();
  return ledger;
}

function purgeExpiredProofs(ledger) {
  if (!ledger) return false;
  var now = new Date(); var changed = false;
  ledger.paymentsStatus.forEach(function (p) {
    if (p.status === 'APPROVED' && p.proofPurgeAt && new Date(p.proofPurgeAt) <= now && p.screenShot) {
      p.screenShot = null; changed = true;
    }
  });
  return changed;
}

function serializeEntry(entry) {
  return {
    id: String(entry._id), month: entry.month, year: entry.year, amount: entry.amount,
    status: entry.status, submissionId: entry.submissionId || '', submittedAt: entry.submittedAt,
    verifiedAt: entry.verifiedAt, verifiedByName: entry.verifiedByName || '',
    rejectionReason: entry.rejectionReason || '', hasScreenShot: !!(entry.screenShot && entry.screenShot.data)
  };
}

module.exports = { FEE: FEE, istMonth: istMonth, key: key, validMonth: validMonth, compare: compare, configuredStart: configuredStart, ensureLedger: ensureLedger, purgeExpiredProofs: purgeExpiredProofs, serializeEntry: serializeEntry };
