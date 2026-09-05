var express = require('express');
var router  = express.Router();
var multer  = require('multer');
var crypto  = require('crypto');
var fs      = require('fs');
var path    = require('path');
var mongoose = require('mongoose');

var PaymentSetup  = require('../models/PaymentSetup');
var PaymentStatus = require('../models/PaymentStatus');
var MemberDetails = require('../models/MemberDetails');
var connectDB     = require('../config/db');

var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/* Multer: store uploaded files in memory as Buffer */
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  }
});

/* Ensure FINANCE_ID is initialized in process.env and .env file */
function getFinanceId() {
  var envId = (process.env.FINANCE_ID || '').trim();
  if (envId) return envId;

  var defaultId = 'HAMD-FIN-2024';
  process.env.FINANCE_ID = defaultId;

  try {
    var envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      var content = fs.readFileSync(envPath, 'utf8');
      if (!/FINANCE_ID\s*=/.test(content)) {
        fs.appendFileSync(envPath, '\nFINANCE_ID=' + defaultId + '\n', 'utf8');
        console.log('Appended default FINANCE_ID to .env');
      }
    }
  } catch (e) {
    console.warn('Could not write FINANCE_ID to .env:', e.message);
  }

  return defaultId;
}

function safeEqual(a, b) {
  var strA = String(a || '').trim();
  var strB = String(b || '').trim();
  if (!strA || !strB) return false;
  var bufA = Buffer.from(strA);
  var bufB = Buffer.from(strB);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function wantsJson(req) {
  if (req.xhr) return true;
  var accept = req.headers.accept || '';
  return accept.indexOf('application/json') !== -1 || req.method !== 'GET';
}

/* Guard middleware for finance endpoints */
function requireFinance(req, res, next) {
  if (req.session && req.session.financeId) {
    if (req.session.cookie) req.session.cookie.maxAge = SEVEN_DAYS_MS;
    return next();
  }

  if (wantsJson(req)) {
    return res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
  }
  return res.redirect('/finance');
}

/* ================================================================== */
/* HELPER: fetch all member contributions and calculate unpaid list   */
/* ================================================================== */
var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function getAllContributionsData() {
  try {
    var members = await MemberDetails.find({}, { name: 1, admissionNumber: 1, batch: 1, createdAt: 1 }).lean();
    var memberMap = {};
    members.forEach(function (m) { memberMap[String(m._id)] = m; });

    var paymentDocs = await PaymentStatus.find({}).lean();

    var submittedList = [];
    var paidMonthSet = {};

    paymentDocs.forEach(function (doc) {
      var memberIdStr = String(doc.memberId);
      var member = memberMap[memberIdStr] || { name: 'Unknown Member', admissionNumber: '', batch: '' };

      var memberGroups = [];

      (doc.membersPayments || []).forEach(function (item) {
        var monthItems = [];
        if (typeof item.month === 'number' && typeof item.year === 'number') {
          monthItems.push({ month: item.month, year: item.year });
        } else if (Array.isArray(item.months)) {
          monthItems = item.months;
        }

        monthItems.forEach(function (mItem) {
          var mKey = memberIdStr + '-' + mItem.year + '-' + mItem.month;
          var itemStatus = item.status || 'Pending';

          if (itemStatus === 'Approved') {
            paidMonthSet[mKey] = 'Approved';
          } else if (itemStatus === 'Pending' && paidMonthSet[mKey] !== 'Approved') {
            paidMonthSet[mKey] = 'Pending';
          }
        });

        var itemBuf = null;
        if (item.screenShot && item.screenShot.data) {
          if (Buffer.isBuffer(item.screenShot.data)) {
            itemBuf = item.screenShot.data;
          } else if (item.screenShot.data.buffer) {
            itemBuf = Buffer.from(item.screenShot.data.buffer);
          } else {
            itemBuf = Buffer.from(item.screenShot.data);
          }
        }

        var matchedGroup = null;
        if (itemBuf && itemBuf.length > 0) {
          matchedGroup = memberGroups.find(function (grp) {
            return grp.status === (item.status || 'Pending') &&
                   grp.screenShotBuffer &&
                   Buffer.compare(itemBuf, grp.screenShotBuffer) === 0;
          });
        }

        if (matchedGroup) {
          matchedGroup.paymentIds.push(String(item._id));
          monthItems.forEach(function (mItem) {
            matchedGroup.months.push({
              month: mItem.month,
              year: mItem.year,
              label: (MONTH_NAMES[mItem.month - 1] || '') + ' ' + mItem.year
            });
            if (mItem.year > matchedGroup.maxYear || (mItem.year === matchedGroup.maxYear && mItem.month > matchedGroup.maxMonth)) {
              matchedGroup.maxYear = mItem.year;
              matchedGroup.maxMonth = mItem.month;
            }
          });
          matchedGroup.amount += (item.amount || 30);
        } else {
          var dSub = item.submittedAt ? new Date(item.submittedAt) : null;
          var dApp = item.approvedAt ? new Date(item.approvedAt) : null;
          var initMonths = monthItems.map(function (mItem) {
            return {
              month: mItem.month,
              year: mItem.year,
              label: (MONTH_NAMES[mItem.month - 1] || '') + ' ' + mItem.year
            };
          });

          var maxYear = initMonths.length > 0 ? initMonths[0].year : 0;
          var maxMonth = initMonths.length > 0 ? initMonths[0].month : 0;
          initMonths.forEach(function (im) {
            if (im.year > maxYear || (im.year === maxYear && im.month > maxMonth)) {
              maxYear = im.year;
              maxMonth = im.month;
            }
          });

          var itemStatus = item.status || 'Pending';
          var newGrp = {
            paymentIds: [String(item._id)],
            paymentId: String(item._id),
            memberId: memberIdStr,
            memberName: member.name || 'Unnamed',
            admissionNumber: member.admissionNumber || '',
            batch: member.batch || '',
            months: initMonths,
            amount: item.amount || 30,
            unitAmount: item.amount || 30,
            status: itemStatus,
            badgeColor: itemStatus === 'Approved' ? 'bg-success' : (itemStatus === 'Pending' ? 'bg-warning text-dark' : 'bg-danger'),
            hasScreenshot: !!(item.screenShot && item.screenShot.contentType && itemBuf),
            screenShotBuffer: itemBuf,
            approvedBy: item.approvedBy || '',
            approvedAtFormatted: dApp ? dApp.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
            rejectionReason: item.rejectionReason || '',
            submittedAtFormatted: dSub ? dSub.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
            submittedAtTime: dSub ? dSub.getTime() : 0,
            maxYear: maxYear,
            maxMonth: maxMonth
          };
          memberGroups.push(newGrp);
        }
      });

      memberGroups.forEach(function (grp) {
        delete grp.screenShotBuffer;
        grp.months.sort(function (a, b) {
          return a.year - b.year || a.month - b.month;
        });
        grp.monthCount = grp.months.length;
        grp.monthLabel = grp.months.map(function (m) { return m.label; }).join(', ');
        grp.year = grp.maxYear;
        grp.month = grp.maxMonth;
        submittedList.push(grp);
      });
    });

    submittedList.sort(function (a, b) {
      return (b.year - a.year) || (b.month - a.month) || (b.submittedAtTime - a.submittedAtTime);
    });

    var now = new Date();
    var currentYear = now.getFullYear();
    var currentMonth = now.getMonth() + 1;
    var unpaidList = [];

    members.forEach(function (member) {
      var memberIdStr = String(member._id);
      var startYear, startMonth;

      if (member.createdAt) {
        var created = new Date(member.createdAt);
        if (!isNaN(created.getTime())) {
          startYear = created.getFullYear();
          startMonth = created.getMonth() + 1;
        }
      }
      if (!startYear || !startMonth) {
        startYear = currentYear;
        startMonth = 1;
      }

      var y = startYear;
      var m = startMonth;

      while (y < currentYear || (y === currentYear && m <= currentMonth)) {
        var mKey = memberIdStr + '-' + y + '-' + m;
        var status = paidMonthSet[mKey];

        if (!status || status === 'Rejected') {
          unpaidList.push({
            memberId: memberIdStr,
            memberName: member.name || 'Unnamed',
            admissionNumber: member.admissionNumber || '',
            batch: member.batch || '',
            month: m,
            year: y,
            monthLabel: (MONTH_NAMES[m - 1] || '') + ' ' + y,
            amount: 30,
            status: 'UN PAID',
            badgeColor: 'bg-danger'
          });
        }

        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }
    });

    unpaidList.sort(function (a, b) {
      if (b.year !== a.year) return b.year - a.year;
      if (b.month !== a.month) return b.month - a.month;
      return a.memberName.localeCompare(b.memberName);
    });

    return {
      submitted: submittedList,
      unpaid: unpaidList,
      counts: {
        total: submittedList.length,
        pending: submittedList.filter(function (i) { return i.status === 'Pending'; }).length,
        approved: submittedList.filter(function (i) { return i.status === 'Approved'; }).length,
        rejected: submittedList.filter(function (i) { return i.status === 'Rejected'; }).length,
        unpaid: unpaidList.length
      }
    };
  } catch (err) {
    console.error('Finance fetch all contributions failed:', err.message);
    return { submitted: [], unpaid: [], counts: { total: 0, pending: 0, approved: 0, rejected: 0, unpaid: 0 } };
  }
}

/* ================================================================== */
/* GET /finance – Main Finance Portal page (Login or Dashboard)       */
/* ================================================================== */
router.get('/', async function (req, res) {
  await connectDB();
  var configuredFinanceId = getFinanceId();

  var isAuthenticated = !!(req.session && req.session.financeId);

  if (!isAuthenticated) {
    return res.render('finance', {
      layout: false,
      title: 'Finance Portal - HAMD Alumni',
      authenticated: false,
      financeUser: null,
      paymentSetup: { upiId: '', gpayNumber: '', hasQrCode: false },
      contributions: { submitted: [], unpaid: [], counts: { total: 0, pending: 0, approved: 0, rejected: 0, unpaid: 0 } },
      contributionsJson: JSON.stringify({ submitted: [], unpaid: [], counts: { total: 0, pending: 0, approved: 0, rejected: 0, unpaid: 0 } })
    });
  }

  // If authenticated, load payment setup & contributions
  var paymentSetup = { upiId: '', gpayNumber: '', hasQrCode: false };
  var contributions = { submitted: [], unpaid: [], counts: { total: 0, pending: 0, approved: 0, rejected: 0, unpaid: 0 } };

  try {
    var paymentDoc = await PaymentSetup.findOne({ singleton: true }).lean();
    if (paymentDoc) {
      paymentSetup = {
        upiId: paymentDoc.upiId || '',
        gpayNumber: paymentDoc.gpayNumber || '',
        hasQrCode: !!(paymentDoc.qrCode && paymentDoc.qrCode.contentType)
      };
    }
    contributions = await getAllContributionsData();
  } catch (err) {
    console.error('Error loading finance data:', err.message);
  }

  return res.render('finance', {
    layout: false,
    title: 'Finance Portal - HAMD Alumni',
    authenticated: true,
    financeUser: req.session.financeUser || 'Finance Officer',
    paymentSetup: paymentSetup,
    contributions: contributions,
    contributionsJson: JSON.stringify(contributions)
  });
});

/* ================================================================== */
/* POST /finance/login – Authenticate with FINANCE_ID                 */
/* ================================================================== */
router.post('/login', async function (req, res) {
  var inputId = (req.body.financeId || req.body.username || req.body.id || '').trim();
  var configuredFinanceId = getFinanceId();

  if (!inputId) {
    if (wantsJson(req)) {
      return res.status(400).json({ success: false, message: 'Please enter your Finance ID.' });
    }
    return res.redirect('/finance?error=missing_id');
  }

  if (!safeEqual(inputId, configuredFinanceId)) {
    if (wantsJson(req)) {
      return res.status(401).json({ success: false, message: 'Invalid Finance ID. Please check and try again.' });
    }
    return res.redirect('/finance?error=invalid_id');
  }

  // Session regeneration prevents session fixation
  return req.session.regenerate(function (regenErr) {
    if (regenErr) {
      console.error('Finance session regenerate error:', regenErr.message);
      if (wantsJson(req)) {
        return res.status(500).json({ success: false, message: 'Could not create session. Please try again.' });
      }
      return res.redirect('/finance?error=session_error');
    }

    req.session.financeId   = configuredFinanceId;
    req.session.financeUser = 'Finance Officer';
    req.session.loginAt     = new Date();
    req.session.cookie.maxAge = SEVEN_DAYS_MS;

    return req.session.save(function (saveErr) {
      if (saveErr) {
        console.error('Finance session save error:', saveErr.message);
        if (wantsJson(req)) {
          return res.status(500).json({ success: false, message: 'Could not save session. Please try again.' });
        }
        return res.redirect('/finance?error=session_error');
      }

      if (wantsJson(req)) {
        return res.json({ success: true, message: 'Logged in successfully.', redirect: '/finance' });
      }
      return res.redirect('/finance');
    });
  });
});

/* ================================================================== */
/* GET /finance/session – Check live session status                   */
/* ================================================================== */
router.get('/session', function (req, res) {
  if (req.session && req.session.financeId) {
    req.session.cookie.maxAge = SEVEN_DAYS_MS;
    return res.json({
      success: true,
      authenticated: true,
      user: req.session.financeUser || 'Finance Officer'
    });
  }
  return res.json({ success: false, authenticated: false });
});

/* ================================================================== */
/* POST|GET /finance/logout – Destroy session                          */
/* ================================================================== */
function handleLogout(req, res) {
  if (!req.session) {
    if (wantsJson(req)) return res.json({ success: true });
    return res.redirect('/finance');
  }

  req.session.destroy(function (err) {
    if (err) console.error('Finance logout error:', err.message);
    res.clearCookie('hamd.sid', { path: '/' });
    if (wantsJson(req)) return res.json({ success: true, redirect: '/finance' });
    return res.redirect('/finance');
  });
}

router.get('/logout', handleLogout);
router.post('/logout', handleLogout);

/* ================================================================== */
/* GET /finance/payment-setup/qr-code – Serve payment QR image        */
/* ================================================================== */
router.get('/payment-setup/qr-code', async function (req, res) {
  await connectDB();
  try {
    var doc = await PaymentSetup.findOne({ singleton: true }, { 'qrCode.data': 1, 'qrCode.contentType': 1 }).lean();
    if (!doc || !doc.qrCode || !doc.qrCode.data) {
      return res.status(404).end();
    }
    res.set('Content-Type', doc.qrCode.contentType || 'image/png');
    res.set('Cache-Control', 'no-store');
    return res.send(doc.qrCode.data.buffer || doc.qrCode.data);
  } catch (error) {
    console.error('Finance serve QR code error:', error.message);
    return res.status(500).end();
  }
});

/* ================================================================== */
/* POST /finance/payment-setup – Save Payment Setup details           */
/* ================================================================== */
router.post('/payment-setup', requireFinance, upload.single('qrCode'), async function (req, res) {
  await connectDB();
  try {
    var upiId = (req.body.upiId || '').trim();
    var gpayNumber = (req.body.gpayNumber || '').trim();

    if (req.file) {
      var maxBytes = 2 * 1024 * 1024; // 2 MB limit
      if (req.file.size > maxBytes || (req.file.buffer && req.file.buffer.length > maxBytes)) {
        return res.status(400).json({ success: false, message: 'QR Code image must be less than 2MB.' });
      }
    }

    var update = {
      upiId: upiId,
      gpayNumber: gpayNumber
    };

    if (req.file && req.file.buffer) {
      update.qrCode = {
        data: req.file.buffer,
        contentType: req.file.mimetype
      };
    } else if (req.body.removeQrCode === '1' || req.body.removeQrCode === 'true') {
      update.qrCode = { data: null, contentType: null };
    }

    var doc = await PaymentSetup.findOneAndUpdate(
      { singleton: true },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({
      success: true,
      message: 'Payment details saved successfully.',
      paymentSetup: {
        upiId: doc.upiId || '',
        gpayNumber: doc.gpayNumber || '',
        hasQrCode: !!(doc.qrCode && doc.qrCode.contentType)
      }
    });
  } catch (error) {
    console.error('Finance save payment setup error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save payment details. Please try again.' });
  }
});

/* ================================================================== */
/* GET /finance/contributions – JSON list of all contributions        */
/* ================================================================== */
router.get('/contributions', requireFinance, async function (req, res) {
  await connectDB();
  try {
    var data = await getAllContributionsData();
    return res.json({ success: true, submitted: data.submitted, unpaid: data.unpaid, counts: data.counts });
  } catch (error) {
    console.error('Finance list contributions error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load contributions data.' });
  }
});

/* ================================================================== */
/* GET /finance/contributions/image/:memberId/:paymentId – Screenshot */
/* ================================================================== */
router.get('/contributions/image/:memberId/:paymentId', requireFinance, async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId) || !mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      return res.status(400).end();
    }
    var doc = await PaymentStatus.findOne({ memberId: req.params.memberId }, { membersPayments: 1 }).lean();
    if (!doc || !doc.membersPayments) {
      return res.status(404).end();
    }
    var targetId = String(req.params.paymentId);
    var item = doc.membersPayments.find(function (p) { return String(p._id) === targetId; });
    if (!item || !item.screenShot || !item.screenShot.data) {
      return res.status(404).end();
    }

    res.set('Content-Type', item.screenShot.contentType || 'image/png');
    res.set('Cache-Control', 'private, max-age=86400');
    return res.send(item.screenShot.data.buffer || item.screenShot.data);
  } catch (error) {
    console.error('Finance serve contribution screenshot error:', error.message);
    return res.status(500).end();
  }
});

/* ================================================================== */
/* POST /finance/contributions/:memberId/:paymentId/approve           */
/* ================================================================== */
router.post('/contributions/:memberId/:paymentId/approve', requireFinance, async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId)) {
      return res.status(400).json({ success: false, message: 'Invalid member ID.' });
    }

    var doc = await PaymentStatus.findOne({ memberId: req.params.memberId });
    if (!doc || !doc.membersPayments) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    var paymentIds = [];
    if (Array.isArray(req.body.paymentIds) && req.body.paymentIds.length > 0) {
      paymentIds = req.body.paymentIds.map(String);
    } else if (req.params.paymentId && mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      paymentIds = [String(req.params.paymentId)];
    }

    var updatedCount = 0;
    var now = new Date();

    doc.membersPayments.forEach(function (item) {
      if (paymentIds.includes(String(item._id))) {
        item.status = 'Approved';
        item.approvedBy = req.session.financeUser || 'Finance Officer';
        item.approvedAt = now;
        item.rejectionReason = '';
        updatedCount++;
      }
    });

    if (updatedCount === 0) {
      return res.status(404).json({ success: false, message: 'Payment submission item(s) not found.' });
    }

    await doc.save();

    return res.json({ success: true, message: 'Payment approved successfully (' + updatedCount + ' month' + (updatedCount > 1 ? 's' : '') + ').' });
  } catch (error) {
    console.error('Finance approve payment error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not approve payment.' });
  }
});

/* ================================================================== */
/* POST /finance/contributions/:memberId/:paymentId/reject            */
/* ================================================================== */
router.post('/contributions/:memberId/:paymentId/reject', requireFinance, async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId)) {
      return res.status(400).json({ success: false, message: 'Invalid member ID.' });
    }

    var option = (req.body.reasonOption || '').trim();
    var customReason = (req.body.customReason || '').trim();
    var finalReason = option === 'other' ? customReason : option;
    if (!finalReason) finalReason = 'Rejected by Finance Officer';

    var doc = await PaymentStatus.findOne({ memberId: req.params.memberId });
    if (!doc || !doc.membersPayments) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    var paymentIds = [];
    if (Array.isArray(req.body.paymentIds) && req.body.paymentIds.length > 0) {
      paymentIds = req.body.paymentIds.map(String);
    } else if (req.params.paymentId && mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      paymentIds = [String(req.params.paymentId)];
    }

    var updatedCount = 0;
    var now = new Date();

    doc.membersPayments.forEach(function (item) {
      if (paymentIds.includes(String(item._id))) {
        item.status = 'Rejected';
        item.rejectionReason = finalReason;
        item.approvedBy = req.session.financeUser || 'Finance Officer';
        item.approvedAt = now;
        updatedCount++;
      }
    });

    if (updatedCount === 0) {
      return res.status(404).json({ success: false, message: 'Payment submission item(s) not found.' });
    }

    await doc.save();

    return res.json({ success: true, message: 'Payment rejected (' + updatedCount + ' month' + (updatedCount > 1 ? 's' : '') + ').' });
  } catch (error) {
    console.error('Finance reject payment error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not reject payment.' });
  }
});

module.exports = router;
