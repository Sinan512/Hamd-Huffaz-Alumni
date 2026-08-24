var express = require('express');
var router  = express.Router();
var mongoose = require('mongoose');

var multer = require('multer');

var MemberDetails = require('../models/MemberDetails');
var EventDetails  = require('../models/EventDetails');
var Gallery       = require('../models/Gallery');
var PaymentSetup  = require('../models/PaymentSetup');
var PaymentStatus = require('../models/PaymentStatus');
const connectDB   = require('../config/db');

var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed for payment screenshot.'));
    }
    cb(null, true);
  }
});

/* ================================================================== */
/* HELPERS                                                             */
/* ================================================================== */

var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatContributionDate(value) {
  if (!value) return '';
  var date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function getMemberContributionMonths(member) {
  var now = new Date();
  var currentYear = now.getFullYear();
  var currentMonth = now.getMonth() + 1; // 1 to 12

  var startYear, startMonth;
  if (member && member.createdAt) {
    var created = new Date(member.createdAt);
    if (!isNaN(created.getTime())) {
      startYear = created.getFullYear();
      startMonth = created.getMonth() + 1;
    }
  }

  // Fallback if createdAt missing: current year starting January
  if (!startYear || !startMonth) {
    startYear = currentYear;
    startMonth = 1;
  }

  var paymentStatusDoc = await PaymentStatus.findOne({ memberId: member._id }).lean();
  var submissions = (paymentStatusDoc && paymentStatusDoc.membersPayments) ? paymentStatusDoc.membersPayments : [];

  var statusMap = {};
  function addSubmissionStatus(key, sub, subStatus) {
    var entry = {
      status: subStatus,
      rejectionReason: sub.rejectionReason || '',
      approvedBy: sub.approvedBy || '',
      approvedAt: sub.approvedAt || null,
      submittedAt: sub.submittedAt || null,
      paymentId: sub._id ? String(sub._id) : '',
      amount: Number(sub.amount) || 30
    };
    var existing = statusMap[key];

    /* Approved is final. A pending resubmission supersedes an old rejection. */
    if (!existing || subStatus === 'Approved' ||
        (subStatus === 'Pending' && existing.status !== 'Approved') ||
        (subStatus === 'Rejected' && existing.status === 'Rejected')) {
      statusMap[key] = entry;
    }
  }

  submissions.forEach(function (sub) {
    var subStatus = sub.status || 'Pending';
    if (typeof sub.month === 'number' && typeof sub.year === 'number') {
      var key = sub.year + '-' + sub.month;
      addSubmissionStatus(key, sub, subStatus);
    }
    if (Array.isArray(sub.months)) {
      sub.months.forEach(function (m) {
        var key = m.year + '-' + m.month;
        addSubmissionStatus(key, sub, subStatus);
      });
    }
  });

  var monthsList = [];
  var y = startYear;
  var m = startMonth;

  while (y < currentYear || (y === currentYear && m <= currentMonth)) {
    var key = y + '-' + m;
    var statusEntry = statusMap[key] || { status: 'UN PAID' };
    var rawStatus = statusEntry.status;

    var displayStatus = 'UN PAID';
    var badgeColor = 'bg-danger';
    var isSelectable = true;

    if (rawStatus === 'Approved') {
      displayStatus = 'APPROVED';
      badgeColor = 'bg-success';
      isSelectable = false;
    } else if (rawStatus === 'Pending') {
      displayStatus = 'PENDING';
      badgeColor = 'bg-warning text-dark';
      isSelectable = false;
    } else if (rawStatus === 'Rejected') {
      displayStatus = 'REJECTED';
      badgeColor = 'bg-danger';
      isSelectable = false;
    } else {
      displayStatus = 'UN PAID';
      badgeColor = 'bg-danger';
      isSelectable = true;
    }

    monthsList.push({
      year: y,
      month: m,
      key: key,
      monthName: MONTH_NAMES[m - 1],
      label: MONTH_NAMES[m - 1] + ' ' + y,
      amount: statusEntry.amount || 30,
      status: displayStatus,
      isApproved: rawStatus === 'Approved',
      badgeColor: badgeColor,
      isSelectable: isSelectable,
      rejectionReason: statusEntry.rejectionReason || '',
      approvedBy: statusEntry.approvedBy || '',
      approvedAt: formatContributionDate(statusEntry.approvedAt),
      submittedAt: formatContributionDate(statusEntry.submittedAt),
      paymentId: statusEntry.paymentId || ''
    });

    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  var unpaidList = monthsList.filter(function (item) {
    return item.status === 'UN PAID' || item.status === 'REJECTED';
  });

  return {
    months: monthsList,
    hasUnpaidMonths: unpaidList.length > 0,
    unpaidCount: unpaidList.length,
    unpaidListLabels: unpaidList.map(function (item) { return item.label; }).join(', ')
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function categoryBadge(cat) {
  var map = {
    'Reunion':    'bg-primary',
    'Official':   'bg-info',
    'Seminar':    'bg-warning text-dark',
    'Networking': 'bg-success',
    'General':    'bg-secondary'
  };
  return map[cat] || 'bg-secondary';
}

/* Fetch all gallery images (metadata only) */
async function getGalleryImages() {
  try {
    var docs = await Gallery
      .find({}, { description: 1, createdAt: 1, 'image.contentType': 1, 'image.data': 1 })
      .sort({ createdAt: -1 })
      .lean();

    return docs.map(function (doc) {
      return {
        _id:         String(doc._id),
        description: doc.description || '',
        hasImage:    !!(doc.image && doc.image.contentType && doc.image.data)
      };
    });
  } catch (err) {
    console.error('Gallery fetch failed:', err.message);
    return [];
  }
}

/* Fetch all events: upcoming sorted by date asc first, ended events at the bottom */
async function getAllEvents() {
  try {
    var docs = await EventDetails
      .find({}, {
        title: 1, date: 1, category: 1, location: 1,
        description: 1, registration: 1, 'image.contentType': 1
      })
      .lean();

    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN',
                  'JUL','AUG','SEP','OCT','NOV','DEC'];

    var upcoming = [];
    var ended = [];

    docs.forEach(function (doc) {
      var d = new Date(doc.date);
      var mon = MONTHS[d.getUTCMonth()] || '';
      var day = String(d.getUTCDate()).padStart(2, '0');
      var isEnded = isNaN(d.getTime()) ? false : (d < todayStart);

      var item = {
        id:           String(doc._id),
        title:        doc.title        || '',
        rawDate:      d,
        month:        mon,
        day:          day,
        location:     doc.location     || '',
        category:     doc.category     || 'General',
        description:  doc.description  || '',
        registration: !!doc.registration,
        badgeColor:   categoryBadge(doc.category),
        hasImage:     !!(doc.image && doc.image.contentType),
        isEnded:      isEnded
      };

      if (isEnded) {
        ended.push(item);
      } else {
        upcoming.push(item);
      }
    });

    upcoming.sort(function (a, b) { return a.rawDate - b.rawDate; });
    ended.sort(function (a, b) { return b.rawDate - a.rawDate; });

    return upcoming.concat(ended);
  } catch (err) {
    console.error('Events fetch failed:', err.message);
    return [];
  }
}

/* Build the user context object expected by users.hbs.
   Boolean flags like currentStatus_job let Handlebars {{#if}} work. */
function buildUserContext(doc) {
  var status    = doc.currentStatus || '';
  var higherEdu = doc.higherEdu     || '';
  var hasDep    = doc.hasDependents || '';
  var parDec    = doc.parentsDeceased || '';
  var chronic   = doc.chronicIll    || '';
  var ownHouse  = doc.ownHouse      || '';
  var married   = doc.married       || '';

  return {
    /* ── core (set by admin) ── */
    name:            doc.name            || '',
    admissionNumber: doc.admissionNumber || '',
    batch:           doc.batch           || '',

    /* ── personal ── */
    email:           doc.email           || '',
    place:           doc.place           || '',
    address:         doc.address         || '',
    phone:           doc.phone           || '',
    whatsapp:        doc.whatsapp        || '',

    /* ── education ── */
    admYear:         doc.admYear         || '',
    leaveYear:       doc.leaveYear       || '',
    eduQual:         doc.eduQual         || '',
    religiousDegree: doc.religiousDegree || '',
    higherEdu_yes:   higherEdu === 'yes',
    higherEdu_no:    higherEdu === 'no',

    /* ── job/study ── */
    currentStatus:       status,
    currentStatus_job:   status === 'Job',
    currentStatus_study: status === 'Study',
    currentStatus_both:  status === 'Job & Study',
    currentStatus_other: status === 'Other',
    workLocation:    doc.workLocation    || '',
    jobRole:         doc.jobRole         || '',
    college:         doc.college         || '',
    course:          doc.course          || '',

    /* ── other ── */
    skills:          doc.skills          || '',
    languages:       doc.languages       || '',
    orgRoles:        doc.orgRoles        || '',
    supportNeeded:            doc.supportNeeded || '',
    supportNeeded_degree:     doc.supportNeeded === 'Degree completion',
    supportNeeded_higher:     doc.supportNeeded === 'Higher education',
    supportNeeded_research:   doc.supportNeeded === 'Research',
    supportNeeded_exams:      doc.supportNeeded === 'Competitive Exams',
    supportNeeded_abroad:     doc.supportNeeded === 'Study Abroad opportunities',
    supportNeeded_language:   doc.supportNeeded === 'English or Arabic language',
    supportNeeded_computer:   doc.supportNeeded === 'Computer skills',
    supportNeeded_online:     doc.supportNeeded === 'Online earning opportunities',
    supportNeeded_other:      doc.supportNeeded === 'Other',


    /* ── family ── */
    familyCount:     doc.familyCount     != null ? doc.familyCount  : '',
    earningMembers:  doc.earningMembers  || '',
    hasDependents_yes:   hasDep === 'yes',
    hasDependents_no:    hasDep === 'no',
    dependentsWho:   doc.dependentsWho   || '',
    parentsDeceased_yes: parDec === 'yes',
    parentsDeceased_no:  parDec === 'no',
    chronicIll_yes:  chronic === 'yes',
    chronicIll_no:   chronic === 'no',
    chronicIllDetails: doc.chronicIllDetails || '',

    /* ── parents ── */
    fatherName:      doc.fatherName      || '',
    motherName:      doc.motherName      || '',

    /* ── misc ── */
    ownHouse_yes:    ownHouse === 'yes',
    ownHouse_no:     ownHouse === 'no',
    married_yes:     married  === 'yes',
    married_no:      married  === 'no',
    childrenCount:   doc.childrenCount   != null ? doc.childrenCount : ''
  };
}

/* ================================================================== */
/* AUTH GUARD                                                           */
/* ================================================================== */

var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/* Session is valid only while the SESSIONS document exists (7 day TTL)
   and it carries a memberId. */
function isLoggedIn(req) {
  return !!(req.session && req.session.memberId);
}

function requireAuth(req, res, next) {
  if (isLoggedIn(req)) return next();
  return res.status(401).json({ success: false, message: 'Please log in first.' });
}

/* Fully clear the session document in MongoDB + the browser cookie */
function clearSession(req, res, done) {
  if (!req.session) {
    res.clearCookie('hamd.sid', { path: '/' });
    return done();
  }
  req.session.destroy(function (err) {
    if (err) console.error('Session destroy failed:', err.message);
    res.clearCookie('hamd.sid', { path: '/' });
    return done();
  });
}

/* ================================================================== */
/* GET /  –  Dashboard (logged-in) or Login page                      */
/* ================================================================== */

router.get('/', async function (req, res, next) {
  await connectDB();

  /* Not logged in (no valid SESSIONS document) → show login view */
  if (!isLoggedIn(req)) {
    return res.render('users', {
      layout: false,
      title:  'Alumni Member Portal',
      user:   null,
      error:  null
    });
  }

  try {
    var member = await MemberDetails.findById(req.session.memberId).lean();

    /* Session has a stale id (member deleted) */
    if (!member) {
      return clearSession(req, res, function () {
        return res.redirect('/users');
      });
    }

    /* Keep the session fresh: every visit extends validity to 7 more days */
    req.session.lastSeenAt = new Date();
    req.session.cookie.maxAge = SEVEN_DAYS_MS;

    var galleryImages = await getGalleryImages();
    var events = await getAllEvents();

    events.forEach(function (event) {
      event.isRegistered = (member.registeredEvents || []).some(function (id) {
        return id.toString() === event.id;
      });
    });

    var paymentSetupDoc = await PaymentSetup.findOne({ singleton: true }).lean();
    var paymentSetup = null;
    if (paymentSetupDoc) {
      paymentSetup = {
        upiId: paymentSetupDoc.upiId || '',
        gpayNumber: paymentSetupDoc.gpayNumber || '',
        hasQrCode: !!(paymentSetupDoc.qrCode && paymentSetupDoc.qrCode.contentType)
      };
    }

    var contribution = await getMemberContributionMonths(member);

    return res.render('users', {
      layout: false,
      title: 'Alumni Member Portal',
      user: buildUserContext(member),
      galleryImages: galleryImages,
      events: events,
      paymentSetup: paymentSetup,
      contribution: contribution
    });
  } catch (err) {
    console.error('Dashboard load failed:', err.message);
    return next(err);
  }
});

/* ================================================================== */
/* POST /login                                                          */
/* ================================================================== */

router.post('/login', async function (req, res, next) {
  await connectDB();

  var name     = (req.body.name     || '').trim();
  var password = (req.body.password || '').trim();

  function loginError(msg) {
    return res.render('users', {
      layout: false,
      title:  'Alumni Member Portal',
      user:   null,
      error:  msg
    });
  }

  if (!name || !password) {
    return loginError('Please enter both your name and password.');
  }

  try {
    /* Case-insensitive exact name match.
       Several members can share the same name, so fetch ALL of them and
       resolve the account by password instead of taking the first hit. */
    var members = await MemberDetails
      .find({ name: new RegExp('^' + escapeRegex(name) + '$', 'i') })
      .lean();

    if (!members || members.length === 0) {
      return loginError('No account found with that name. Please check and try again.');
    }

    /* Password logic:
       – If member.password is set, check against it.
       – Otherwise fall back to admissionNumber as the default/initial password.
       This means members with no custom password can log in using their
       admission number until they change it from the dashboard. */
    var matches = members.filter(function (m) {
      var storedPassword = m.password ? m.password : m.admissionNumber;
      return storedPassword && password === String(storedPassword).trim();
    });

    if (matches.length === 0) {
      return loginError('Incorrect password. Please try again.');
    }

    if (matches.length > 1) {
      return loginError(
        'Multiple members share this name and password. Please contact the admin to update your password.'
      );
    }

    var member = matches[0];

    /* Regenerate the session id first (prevents session fixation), then
       write the session details into the MongoDB "SESSIONS" collection. */
    return req.session.regenerate(function (regenErr) {
      if (regenErr) {
        console.error('Session regenerate failed:', regenErr.message);
        return next(regenErr);
      }

      var now = new Date();

      req.session.memberId        = String(member._id);
      req.session.memberName      = member.name;
      req.session.admissionNumber = member.admissionNumber || '';
      req.session.batch           = member.batch || '';
      req.session.loginAt         = now;
      req.session.lastSeenAt      = now;
      req.session.expiresAt       = new Date(now.getTime() + SEVEN_DAYS_MS);

      /* 7 day validity for both the cookie and the stored session */
      req.session.cookie.maxAge = SEVEN_DAYS_MS;

      /* Persist before redirecting so the SESSIONS document exists
         by the time the browser makes the next request. */
      return req.session.save(function (saveErr) {
        if (saveErr) {
          console.error('Session save failed:', saveErr.message);
          return next(saveErr);
        }
        return res.redirect('/users');
      });
    });
  } catch (err) {
    console.error('Login failed:', err.message);
    return next(err);
  }
});

/* ================================================================== */
/* GET /logout                                                          */
/* ================================================================== */

router.get('/logout', function (req, res) {
  /* Removes the document from the SESSIONS collection and clears the cookie */
  return clearSession(req, res, function () {
    return res.redirect('/users');
  });
});

/* POST /logout – same behaviour for form/fetch based logout */
router.post('/logout', function (req, res) {
  return clearSession(req, res, function () {
    if (req.xhr || (req.headers.accept || '').indexOf('json') !== -1) {
      return res.json({ success: true, message: 'Logged out.' });
    }
    return res.redirect('/users');
  });
});

/* ================================================================== */
/* POST /user/profile  –  Save extended profile data                  */
/* ================================================================== */

router.post('/user/profile', requireAuth, async function (req, res) {
  await connectDB();
  try {
    /* Only fields the member is allowed to update */
    var ALLOWED = [
      'place', 'address', 'email', 'phone', 'whatsapp',
      'admYear', 'leaveYear', 'eduQual', 'religiousDegree', 'higherEdu',
      'currentStatus', 'workLocation', 'jobRole', 'college', 'course',
      'skills', 'languages', 'orgRoles', 'supportNeeded',
      'familyCount', 'earningMembers', 'hasDependents', 'dependentsWho',
      'parentsDeceased', 'chronicIll', 'chronicIllDetails',
      'fatherName', 'motherName',
      'ownHouse', 'married', 'childrenCount'
    ];

    var update = {};
    ALLOWED.forEach(function (key) {
      /* Accept the field whether it's filled or blank (blank = clear it) */
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        update[key] = req.body[key];
      }
    });

    await MemberDetails.findByIdAndUpdate(
      req.session.memberId,
      { $set: update },
      { new: true }
    );

    return res.json({ success: true, message: 'Profile saved successfully.' });
  } catch (err) {
    console.error('Save profile failed:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Could not save profile. Please try again.'
    });
  }
});

/* ================================================================== */
/* POST /user/change-password                                          */
/* ================================================================== */

router.post('/user/change-password', requireAuth, async function (req, res) {
  await connectDB();
  try {
    var currentPassword = (req.body.currentPassword || '').trim();
    var newPassword     = (req.body.newPassword     || '').trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Both current and new password are required.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long.'
      });
    }

    var member = await MemberDetails.findById(req.session.memberId).lean();
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member account not found.' });
    }

    /* Same fallback logic as login */
    var storedPassword = member.password ? member.password : member.admissionNumber;

    if (currentPassword !== storedPassword) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect.'
      });
    }

    await MemberDetails.findByIdAndUpdate(
      req.session.memberId,
      { $set: { password: newPassword } }
    );

    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Change password failed:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Could not update password. Please try again.'
    });
  }
});

/* ================================================================== */
/* POST /user/register-event/:id                                       */
/* ================================================================== */

router.post('/user/register-event/:id', requireAuth, async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event id.' });
    }

    var event = await EventDetails
      .findById(req.params.id, { title: 1, registration: 1 })
      .lean();

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    if (!event.registration) {
      return res.status(400).json({
        success: false,
        message: 'Registration is not open for this event.'
      });
    }

    /* Add this event id to the member's registeredEvents array (no duplicates) */
    await MemberDetails.findByIdAndUpdate(
      req.session.memberId,
      { $addToSet: { registeredEvents: req.params.id } }
    );

    return res.json({
      success: true,
      message: 'Registered for "' + (event.title || 'event') + '" successfully.'
    });
  } catch (err) {
    console.error('Event registration failed:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Could not register for this event. Please try again.'
    });
  }
});

/* ================================================================== */
/* GET /users/payment-setup/qr-code  – serve payment QR image        */
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
    console.error('Serve QR code image failed:', error.message);
    return res.status(500).end();
  }
});

/* ================================================================== */
/* POST /users/submit-contribution-payment                             */
/* ================================================================== */
router.post('/submit-contribution-payment', requireAuth, upload.single('paymentScreenshot'), async function (req, res) {
  await connectDB();
  try {
    var rawMonths = req.body.months;
    if (typeof rawMonths === 'string') {
      try { rawMonths = JSON.parse(rawMonths); } catch (e) { rawMonths = [rawMonths]; }
    }
    if (!Array.isArray(rawMonths) || rawMonths.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one month to pay.' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Please upload a screenshot of your payment receipt.' });
    }

    var parsedMonths = [];
    rawMonths.forEach(function (str) {
      var parts = String(str).split('-');
      if (parts.length === 2) {
        var y = Number(parts[0]);
        var m = Number(parts[1]);
        if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
          parsedMonths.push({ year: y, month: m });
        }
      }
    });

    if (parsedMonths.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid month selection.' });
    }

    // Verify selected months are not already pending/approved.
    // Rejected months are intentionally allowed so they can be updated in place.
    var paymentStatusDoc = await PaymentStatus.findOne({ memberId: req.session.memberId });
    var existingSubmissions = (paymentStatusDoc && paymentStatusDoc.membersPayments) ? paymentStatusDoc.membersPayments : [];

    var alreadyPaid = false;
    existingSubmissions.forEach(function (sub) {
      if (sub.status === 'Approved' || sub.status === 'Pending') {
        if (typeof sub.month === 'number' && typeof sub.year === 'number') {
          parsedMonths.forEach(function (pM) {
            if (sub.year === pM.year && sub.month === pM.month) {
              alreadyPaid = true;
            }
          });
        }
        if (Array.isArray(sub.months)) {
          sub.months.forEach(function (exM) {
            parsedMonths.forEach(function (pM) {
              if (exM.year === pM.year && exM.month === pM.month) {
                alreadyPaid = true;
              }
            });
          });
        }
      }
    });

    if (alreadyPaid) {
      return res.status(400).json({ success: false, message: 'One or more selected months are already pending or paid.' });
    }

    var now = new Date();
    var screenshot = {
      data: req.file.buffer,
      contentType: req.file.mimetype
    };
    var paymentItems = [];

    parsedMonths.forEach(function (m) {
      var rejectedSubmission = existingSubmissions.find(function (sub) {
        return sub.status === 'Rejected' &&
          typeof sub.month === 'number' &&
          typeof sub.year === 'number' &&
          sub.month === m.month &&
          sub.year === m.year;
      });

      if (rejectedSubmission) {
        /* Resubmission replaces the rejected record instead of adding a duplicate. */
        rejectedSubmission.amount = 30;
        rejectedSubmission.screenShot = screenshot;
        rejectedSubmission.status = 'Pending';
        rejectedSubmission.approvedBy = '';
        rejectedSubmission.approvedAt = null;
        rejectedSubmission.rejectionReason = '';
        rejectedSubmission.submittedAt = now;
        return;
      }

      paymentItems.push({
        month: m.month,
        year: m.year,
        amount: 30,
        screenShot: screenshot,
        status: 'Pending',
        approvedBy: '',
        approvedAt: null,
        rejectionReason: '',
        submittedAt: now
      });
    });

    if (paymentStatusDoc) {
      if (paymentItems.length) {
        paymentStatusDoc.membersPayments.push.apply(paymentStatusDoc.membersPayments, paymentItems);
      }
      await paymentStatusDoc.save();
    } else {
      await PaymentStatus.create({
        memberId: req.session.memberId,
        membersPayments: paymentItems
      });
    }

    return res.json({
      success: true,
      message: 'Payment details submitted successfully! Status updated to Pending.'
    });
  } catch (error) {
    console.error('Submit contribution payment failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not submit payment. Please try again.' });
  }
});

module.exports = router;
