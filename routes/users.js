var express = require('express');
var router  = express.Router();
var mongoose = require('mongoose');

var MemberDetails = require('../models/MemberDetails');
var EventDetails  = require('../models/EventDetails');
var Gallery       = require('../models/Gallery');
const connectDB   = require('../config/db');

/* ================================================================== */
/* HELPERS                                                             */
/* ================================================================== */

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
      .find({}, { description: 1, createdAt: 1, 'image.contentType': 1 })
      .sort({ createdAt: -1 })
      .lean();

    return docs.map(function (doc) {
      return {
        _id:         String(doc._id),
        description: doc.description || '',
        hasImage:    !!(doc.image && doc.image.contentType)
      };
    });
  } catch (err) {
    console.error('Gallery fetch failed:', err.message);
    return [];
  }
}

/* Fetch all events sorted soonest first */
async function getAllEvents() {
  try {
    var docs = await EventDetails
      .find({}, {
        title: 1, date: 1, category: 1, location: 1,
        description: 1, registration: 1, 'image.contentType': 1
      })
      .sort({ date: 1 })
      .lean();

    var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN',
                  'JUL','AUG','SEP','OCT','NOV','DEC'];

    return docs.map(function (doc) {
      var d = new Date(doc.date);
      return {
        id:           String(doc._id),
        title:        doc.title        || '',
        month:        MONTHS[d.getUTCMonth()] || '',
        day:          String(d.getUTCDate()).padStart(2, '0'),
        location:     doc.location     || '',
        category:     doc.category     || 'General',
        description:  doc.description  || '',
        registration: !!doc.registration,
        badgeColor:   categoryBadge(doc.category),
        hasImage:     !!(doc.image && doc.image.contentType)
      };
    });
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

function requireAuth(req, res, next) {
  if (req.session && req.session.memberId) return next();
  return res.status(401).json({ success: false, message: 'Please log in first.' });
}

/* ================================================================== */
/* GET /  –  Dashboard (logged-in) or Login page                      */
/* ================================================================== */

router.get('/', async function (req, res, next) {
  await connectDB();

  /* Not logged in → show login view */
  if (!req.session || !req.session.memberId) {
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
      req.session.destroy(function () {});
      return res.redirect('/');
    }

    var results = await Promise.all([getGalleryImages(), getAllEvents()]);

    return res.render('users', {
      layout:        false,
      title:         'Alumni Member Portal',
      user:          buildUserContext(member),
      galleryImages: results[0],
      events:        results[1]
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
    /* Case-insensitive exact name match */
    var member = await MemberDetails
      .findOne({ name: new RegExp('^' + escapeRegex(name) + '$', 'i') })
      .lean();

    if (!member) {
      return loginError('No account found with that name. Please check and try again.');
    }

    /* Password logic:
       – If member.password is set, check against it.
       – Otherwise fall back to admissionNumber as the default/initial password.
       This means members with no custom password can log in using their
       admission number until they change it from the dashboard. */
    var storedPassword = member.password ? member.password : member.admissionNumber;

    if (password !== storedPassword) {
      return loginError('Incorrect password. Please try again.');
    }

    req.session.memberId   = String(member._id);
    req.session.memberName = member.name;

    return res.redirect('/');
  } catch (err) {
    console.error('Login failed:', err.message);
    return next(err);
  }
});

/* ================================================================== */
/* GET /logout                                                          */
/* ================================================================== */

router.get('/logout', function (req, res, next) {
  req.session.destroy(function (err) {
    if (err) console.error('Session destroy failed:', err.message);
    return res.redirect('/');
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
      'skills', 'languages', 'orgRoles',
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

module.exports = router;
