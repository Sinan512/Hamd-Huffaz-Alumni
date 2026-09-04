var express = require('express');
var router = express.Router();
var multer  = require('multer');
var crypto  = require('crypto');

var mongoose    = require('mongoose');
var MemberDetails = require('../models/MemberDetails');
var BatchDetails  = require('../models/BatchDetails');
var BatchLeader   = require('../models/BatchLeader');
var EventDetails  = require('../models/EventDetails');
var Gallery       = require('../models/Gallery');
var Article       = require('../models/Article');
var AdminSecret   = require('../models/AdminSecret');
var PaymentSetup  = require('../models/PaymentSetup');
var PaymentStatus = require('../models/PaymentStatus');
const connectDB   = require('../config/db');

/* Multer: store uploaded files in memory as Buffer. */
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },          // 5 MB max
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    cb(null, true);
  }
});

/* ================================================================== */
/* ADMIN AUTHENTICATION                                                */
/* Credentials live in the "ADMIN_SECRETS" collection.                 */
/* Passwords are stored as sha256(salt + password) – never plain text. */
/* Sessions live in "SESSIONS" (see app.js) and are valid for 7 days.  */
/* ================================================================== */

var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function sha256(salt, password) {
  return crypto.createHash('sha256').update(String(salt) + String(password)).digest('hex');
}

function safeEqual(a, b) {
  var bufA = Buffer.from(String(a));
  var bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* Create the first admin from ADMIN_USERNAME / ADMIN_PASSWORD in .env
   the very first time the admin area is opened. */
async function ensureSeedAdmin() {
  var count = await AdminSecret.countDocuments();
  if (count > 0) return null;

  var username = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  var password = (process.env.ADMIN_PASSWORD || '').trim();
  if (!username || !password) {
    console.error('No admin account exists and ADMIN_USERNAME / ADMIN_PASSWORD are not set in the environment.');
    return null;
  }

  var salt = makeSalt();
  var admin = await AdminSecret.create({
    username:     username,
    salt:         salt,
    passwordHash: sha256(salt, password),
    displayName:  (process.env.ADMIN_NAME || 'Super Admin').trim(),
    email:        (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    batch:        (process.env.ADMIN_BATCH || '').trim()
  });
  console.log('Seeded initial admin account "' + username + '" into ADMIN_SECRETS.');
  return admin;
}

/* Serialise an admin document for the views. */
function serialiseAdmin(doc) {
  if (!doc) return null;
  return {
    id:          String(doc._id),
    username:    doc.username || '',
    displayName: doc.displayName || 'Super Admin',
    batch:       doc.batch || '',
    email:       doc.email || '',
    hasAvatar:   !!(doc.avatar && doc.avatar.contentType)
  };
}

function wantsJson(req) {
  if (req.xhr) return true;
  var accept = req.headers.accept || '';
  return accept.indexOf('application/json') !== -1 || req.method !== 'GET';
}

/* Gate for every admin page / API below this middleware. */
async function requireAdmin(req, res, next) {
  try {
    await connectDB();
    if (req.session && req.session.adminId) {
      var admin = await AdminSecret.findById(req.session.adminId);
      if (admin) {
        /* Keep the session fresh: every request extends it to 7 more days. */
        req.session.cookie.maxAge = SEVEN_DAYS_MS;
        req.admin = admin;
        res.locals.admin = serialiseAdmin(admin);
        return next();
      }
      /* Credential row was deleted – drop the stale session. */
      req.session.adminId = null;
    }
  } catch (error) {
    console.error('Admin auth check failed:', error.message);
  }

  if (wantsJson(req)) {
    return res.status(401).json({ success: false, message: 'Your session expired. Please sign in again.' });
  }
  return res.redirect('/admin/login');
}

/* ------------------------------------------------------------------ */
/* GET /admin/login                                                    */
/* ------------------------------------------------------------------ */
router.get('/login', async function (req, res) {
  await connectDB();
  try { await ensureSeedAdmin(); } catch (e) { console.error('Admin seed failed:', e.message); }

  if (req.session && req.session.adminId) {
    return res.redirect('/admin');
  }
  return res.render('admin-login', { layout: false, title: 'Admin Sign In', username: '' });
});

/* ------------------------------------------------------------------ */
/* POST /admin/login                                                   */
/* ------------------------------------------------------------------ */
router.post('/login', async function (req, res) {
  await connectDB();
  var username = (req.body.username || '').trim().toLowerCase();
  var password = (req.body.password || '').trim();

  function fail(message) {
    return res.status(401).render('admin-login', {
      layout: false, title: 'Admin Sign In', error: message, username: username
    });
  }

  if (!username || !password) {
    return fail('Please enter both username and password.');
  }

  try {
    await ensureSeedAdmin();
    var admin = await AdminSecret.findOne({ username: username });
    if (!admin) return fail('Incorrect username or password.');
    if (!safeEqual(sha256(admin.salt, password), admin.passwordHash)) {
      return fail('Incorrect username or password.');
    }

    admin.lastLoginAt = new Date();
    await admin.save();

    var adminId = String(admin._id);
    /* Regenerate the session id first (prevents session fixation). */
    return req.session.regenerate(function (regenErr) {
      if (regenErr) {
        console.error('Admin session regenerate failed:', regenErr.message);
        return fail('Could not start your session. Please try again.');
      }
      req.session.adminId       = adminId;
      req.session.adminUsername = username;
      req.session.loginAt       = new Date();
      req.session.cookie.maxAge = SEVEN_DAYS_MS;
      return req.session.save(function (saveErr) {
        if (saveErr) {
          console.error('Admin session save failed:', saveErr.message);
          return fail('Could not start your session. Please try again.');
        }
        return res.redirect('/admin');
      });
    });
  } catch (error) {
    console.error('Admin login failed:', error.message);
    return fail('Something went wrong. Please try again.');
  }
});

/* ------------------------------------------------------------------ */
/* POST|GET /admin/logout – destroy the SESSIONS document + cookie     */
/* ------------------------------------------------------------------ */
function doLogout(req, res) {
  if (!req.session) return res.redirect('/admin/login');
  return req.session.destroy(function (err) {
    if (err) console.error('Admin logout failed:', err.message);
    res.clearCookie('hamd.sid', { path: '/' });
    return res.redirect('/admin/login');
  });
}
router.post('/logout', doLogout);
router.get('/logout', doLogout);

/* Everything below requires a signed-in admin. */
router.use(requireAdmin);

/* ------------------------------------------------------------------ */
/* GET /admin/profile/avatar – admin picture                            */
/* ------------------------------------------------------------------ */
router.get('/profile/avatar', function (req, res) {
  var admin = req.admin;
  if (!admin || !admin.avatar || !admin.avatar.data) {
    return res.status(404).end();
  }
  res.set('Content-Type', admin.avatar.contentType || 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  return res.send(admin.avatar.data);
});

/* ------------------------------------------------------------------ */
/* POST /admin/profile – edit image / name / batch / email              */
/* ------------------------------------------------------------------ */
router.post('/profile', upload.single('avatar'), async function (req, res) {
  try {
    var admin = req.admin;
    var displayName = (req.body.displayName || '').trim();
    var batch = (req.body.batch || '').trim();
    var email = (req.body.email || '').trim().toLowerCase();

    if (!displayName) {
      return res.status(400).json({ success: false, message: 'Name is required.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    admin.displayName = displayName;
    admin.batch = batch;
    admin.email = email;

    if (req.file && req.file.buffer) {
      admin.avatar = { data: req.file.buffer, contentType: req.file.mimetype };
    } else if (String(req.body.removeAvatar || '') === '1') {
      admin.avatar = undefined;
    }

    await admin.save();
    return res.json({ success: true, message: 'Profile updated.', admin: serialiseAdmin(admin) });
  } catch (error) {
    console.error('Admin profile update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update the profile. Please try again.' });
  }
});

/* ------------------------------------------------------------------ */
/* POST /admin/credentials – change username and/or password            */
/* ------------------------------------------------------------------ */
router.post('/credentials', async function (req, res) {
  try {
    var admin = req.admin;
    var newUsername     = (req.body.newUsername || req.body.username || '').trim().toLowerCase();
    var newPassword     = (req.body.newPassword || '').trim();
    var confirmPassword = (req.body.confirmPassword || '').trim();

    if (!newUsername && !newPassword) {
      return res.status(400).json({ success: false, message: 'Enter a new username or a new password.' });
    }
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'New password and confirmation do not match.' });
      }
    }
    if (newUsername && newUsername !== admin.username) {
      var clash = await AdminSecret.findOne({ username: newUsername, _id: { $ne: admin._id } }).lean();
      if (clash) {
        return res.status(409).json({ success: false, message: 'That username is already taken.' });
      }
      admin.username = newUsername;
      req.session.adminUsername = newUsername;
    }
    if (newPassword) {
      admin.salt = makeSalt();
      admin.passwordHash = sha256(admin.salt, newPassword);
    }

    await admin.save();
    return res.json({
      success: true,
      message: 'Credentials updated. Use them the next time you sign in.',
      admin: serialiseAdmin(admin)
    });
  } catch (error) {
    console.error('Admin credential update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update credentials. Please try again.' });
  }
});


/* ------------------------------------------------------------------ */
/* HELPER: badge colour based on category                              */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* HELPER: fetch & format upcoming events from EVENT_DETAILS           */
/* ------------------------------------------------------------------ */
async function getUpcomingEvents(limit) {
  try {
    /* Show events sorted nearest-date-first; include all dates so the
       dashboard never goes empty even if all events are in the past.   */
    var now = new Date();
    var docs = await EventDetails
      .find({}, { title: 1, date: 1, category: 1, location: 1,
                  description: 1, 'image.contentType': 1 })
      .sort({ date: 1 })
      .limit(limit)
      .lean();

    /* If nothing upcoming, fall back to the most recent past events. */
    if (!docs.length) {
      docs = await EventDetails
        .find({}, { title: 1, date: 1, category: 1, location: 1,
                    description: 1, 'image.contentType': 1 })
        .sort({ date: -1 })
        .limit(limit)
        .lean();
    } else {
      /* Prefer future events but include past ones to fill the list. */
      var future = docs.filter(function (d) { return new Date(d.date) >= now; });
      if (!future.length) {
        /* all are past – keep them */
      } else {
        docs = future;
      }
    }

    var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN',
                  'JUL','AUG','SEP','OCT','NOV','DEC'];

    return docs.map(function (doc) {
      var d    = new Date(doc.date);
      var mon  = MONTHS[d.getUTCMonth()] || '';
      var day  = String(d.getUTCDate()).padStart(2, '0');
      return {
        id:          String(doc._id),
        title:       doc.title || '',
        month:       mon,
        day:         day,
        location:    doc.location  || '',
        category:    doc.category  || 'General',
        description: doc.description || '',
        badgeColor:  categoryBadge(doc.category),
        hasImage:    !!(doc.image && doc.image.contentType)
      };
    });
  } catch (error) {
    console.error('Upcoming events lookup failed:', error.message);
    return [];
  }
}

/* ================================================================== */
/* HELPER: fetch ALL events (upcoming first by date asc, ended bottom) */
/* ================================================================== */
async function getAllEvents() {
  try {
    var docs = await EventDetails
      .find({}, { title: 1, date: 1, category: 1, location: 1,
                  description: 1, registration: 1, 'image.contentType': 1 })
      .lean();

    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN',
                  'JUL','AUG','SEP','OCT','NOV','DEC'];

    var upcoming = [];
    var ended = [];

    docs.forEach(function (doc) {
      var d   = new Date(doc.date);
      var mon = MONTHS[d.getUTCMonth()] || '';
      var day = String(d.getUTCDate()).padStart(2, '0');
      var isEnded = isNaN(d.getTime()) ? false : (d < todayStart);

      var item = {
        id:          String(doc._id),
        title:       doc.title       || '',
        rawDate:     d,
        dateLabel:   isNaN(d.getTime()) ? '' : (day + ' ' + mon + ' ' + d.getUTCFullYear()),
        month:       mon,
        day:         day,
        location:    doc.location    || '',
        category:    doc.category    || 'General',
        description: doc.description || '',
        registration: !!doc.registration,
        badgeColor:  categoryBadge(doc.category),
        hasImage:    !!(doc.image && doc.image.contentType),
        isEnded:     isEnded
      };

      if (isEnded) {
        ended.push(item);
      } else {
        upcoming.push(item);
      }
    });

    /* Upcoming: order by date ascending (soonest first) */
    upcoming.sort(function (a, b) { return a.rawDate - b.rawDate; });
    /* Ended: order by date descending (most recently ended first) */
    ended.sort(function (a, b) { return b.rawDate - a.rawDate; });

    return upcoming.concat(ended);
  } catch (error) {
    console.error('All events lookup failed:', error.message);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* HELPER: batch-leader count                                          */
/* ------------------------------------------------------------------ */
async function getBatchLeaderCount() {
  try {
    return await BatchLeader.countDocuments();
  } catch (error) {
    console.error('Batch leader count failed:', error.message);
    return 0;
  }
}

/* ================================================================== */
/* GET  /admin/   – Dashboard                                          */
/* ================================================================== */
/* ------------------------------------------------------------------ */
/* HELPER: fetch gallery images (metadata only, never the binary)      */
/* ------------------------------------------------------------------ */
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
        createdAt:   doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        hasImage:    !!(doc.image && doc.image.contentType)
      };
    });
  } catch (error) {
    console.error('Gallery lookup failed:', error.message);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* HELPER: fetch articles (metadata only, never the binary)            */
/* ------------------------------------------------------------------ */
function articleExcerpt(text, max) {
  var clean = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, '') + '\u2026';
}

async function getArticles() {
  try {
    var docs = await Article
      .find({}, { heading: 1, author: 1, content: 1, createdAt: 1, 'image.contentType': 1 })
      .sort({ createdAt: -1 })
      .lean();

    return docs.map(function (doc) {
      var d = doc.createdAt ? new Date(doc.createdAt) : null;
      return {
        _id:      String(doc._id),
        heading:  doc.heading || 'Untitled',
        author:   doc.author  || '',
        excerpt:  articleExcerpt(doc.content, 140),
        content:  doc.content || '',
        dateFormatted: d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
        createdAt: d ? d.toISOString() : null,
        hasImage: !!(doc.image && doc.image.contentType)
      };
    });
  } catch (error) {
    console.error('Articles lookup failed:', error.message);
    return [];
  }
}

router.get('/', async function (req, res, next) {
  await connectDB();

  var totalAlumni = 0;
  var totalBatches = 0;
  var batchLeaders = 0;
  var allMembers = [];
  var allBatchLeaders = [];
  var batchYears = [];
  var batchChart = { labels: [], values: [], batchCount: 0 };
  var allEvents = [];
  var upcomingEvents = [];
  var endedEvents = [];
  var galleryImages = [];
  var articles = [];
  var paymentSetup = null;

  try {
    totalAlumni = await MemberDetails.countDocuments();
    batchLeaders = await getBatchLeaderCount();
    allMembers = await getAllMembers();
    allBatchLeaders = await getAllBatchLeaders();
    batchChart = await getMembersPerBatch();
    totalBatches = batchChart.batchCount;

    allEvents = await getAllEvents();

    // getAllEvents() already sorts upcoming first and ended last.
    upcomingEvents = allEvents.filter(function (event) {
      return !event.isEnded;
    });

    endedEvents = allEvents.filter(function (event) {
      return event.isEnded;
    });

    galleryImages = await getGalleryImages();
    articles = await getArticles();

    var paymentSetupDoc = await PaymentSetup.findOne({ singleton: true }).lean();
    if (paymentSetupDoc) {
      paymentSetup = {
        upiId: paymentSetupDoc.upiId || '',
        gpayNumber: paymentSetupDoc.gpayNumber || '',
        hasQrCode: !!(paymentSetupDoc.qrCode && paymentSetupDoc.qrCode.contentType)
      };
    }

    var contributions = await getAllContributionsData();

    /* Collect sorted unique batch years from the member list */
    var yearSet = {};
    allMembers.forEach(function (member) {
      if (member.batch) yearSet[member.batch] = true;
    });

    batchYears = Object.keys(yearSet).sort(function (a, b) {
      return Number(b) - Number(a);
    });
  } catch (error) {
    console.error('Dashboard stats failed:', error.message);
  }

  res.render('admin', {
    layout: false,
    title: 'Alumni Admin Dashboard',
    admin: serialiseAdmin(req.admin),
    adminName: (req.admin && req.admin.displayName) || 'Super Admin',

    stats: {
      totalAlumni: totalAlumni.toLocaleString('en-US'),
      alumniGrowth: 'registered',
      totalBatches: String(totalBatches),
      batchLeaders: String(batchLeaders),
      upcomingEvents: String(upcomingEvents.length)
    },

    batchChartData: JSON.stringify(batchChart),
    allMembers: allMembers,
    batchLeadersList: allBatchLeaders,
    batchYears: batchYears,

    // Event sections
    upcomingEvents: upcomingEvents,
    endedEvents: endedEvents,
    hasEvents: allEvents.length > 0,
    hasEndedEvents: endedEvents.length > 0,

    galleryImages: galleryImages,
    articles: articles,
    paymentSetup: paymentSetup,
    contributions: contributions,
    contributionsJson: JSON.stringify(contributions)
  });
});

/* ================================================================== */
/* GET  /admin/events/:id/image  – serve event banner image            */
/* ================================================================== */
router.get('/events/:id/image', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).end();
    }
    var doc = await EventDetails.findById(req.params.id, { 'image.data': 1, 'image.contentType': 1 }).lean();
    if (!doc || !doc.image || !doc.image.data) {
      return res.status(404).end();
    }
    res.set('Content-Type', doc.image.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(doc.image.data.buffer || doc.image.data);
  } catch (error) {
    console.error('Serve event image failed:', error.message);
    return res.status(500).end();
  }
});

/* ================================================================== */
/* GET  /admin/events/:id  – return event JSON (no image binary)       */
/* ================================================================== */
router.get('/events/:id', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event id.' });
    }
    var doc = await EventDetails
      .findById(req.params.id,
        { title: 1, date: 1, category: 1, location: 1,
          description: 1, registration: 1, 'image.contentType': 1 })
      .lean();

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN',
                  'JUL','AUG','SEP','OCT','NOV','DEC'];
    var d   = new Date(doc.date);
    var mon = MONTHS[d.getUTCMonth()] || '';
    var day = String(d.getUTCDate()).padStart(2, '0');
    var year = d.getUTCFullYear();

    return res.json({
      success:     true,
      id:          String(doc._id),
      title:       doc.title || '',
      month:       mon,
      day:         day,
      year:        year,
      dateFormatted: day + ' ' + mon + ' ' + year,
      location:    doc.location    || '',
      category:    doc.category    || 'General',
      description: doc.description || '',
      registration: !!doc.registration,
      hasImage:    !!(doc.image && doc.image.contentType)
    });
  } catch (error) {
    console.error('Get event detail failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load event.' });
  }
});

/* ================================================================== */
/* GET  /admin/registrations – every member with at least 1 event       */
/* ================================================================== */
router.get('/registrations', async function (req, res) {
  await connectDB();
  try {
    var events = await EventDetails.find({}, { title: 1 }).lean();
    var titleById = {};
    events.forEach(function (e) { titleById[String(e._id)] = e.title || ''; });

    var docs = await MemberDetails
      .find({ registeredEvents: { $exists: true, $ne: [] } },
            { name: 1, place: 1, batch: 1, phone: 1, whatsapp: 1, admissionNumber: 1, registeredEvents: 1 })
      .sort({ batch: 1, name: 1 })
      .lean();

    var members = docs.map(function (m) {
      var ids = Array.isArray(m.registeredEvents) ? m.registeredEvents : [];
      return {
        id:              String(m._id),
        name:            m.name || '',
        place:           m.place || '',
        batch:           m.batch || '',
        admissionNumber: m.admissionNumber || '',
        phone:           m.phone || '',
        whatsapp:        m.whatsapp || m.phone || '',
        events:          ids.map(function (id) { return titleById[String(id)] || 'Event'; })
      };
    });

    return res.json({
      success: true,
      event:   { id: '', title: 'All events' },
      count:   members.length,
      members: members
    });
  } catch (error) {
    console.error('All registrations lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load registered members.' });
  }
});

/* ================================================================== */
/* GET  /admin/events/:id/registrations – members registered for event */
/* ================================================================== */
router.get('/events/:id/registrations', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event id.' });
    }

    var event = await EventDetails.findById(req.params.id, { title: 1 }).lean();
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    var docs = await MemberDetails
      .find({ registeredEvents: req.params.id },
            { name: 1, place: 1, batch: 1, phone: 1, whatsapp: 1, admissionNumber: 1 })
      .sort({ batch: 1, name: 1 })
      .lean();

    var members = docs.map(function (m) {
      return {
        id:              String(m._id),
        name:            m.name || '',
        place:           m.place || '',
        batch:           m.batch || '',
        admissionNumber: m.admissionNumber || '',
        phone:           m.phone || '',
        whatsapp:        m.whatsapp || m.phone || ''
      };
    });

    return res.json({
      success: true,
      event:   { id: String(event._id), title: event.title || '' },
      count:   members.length,
      members: members
    });
  } catch (error) {
    console.error('Event registrations lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load registered members.' });
  }
});

/* ================================================================== */
/* POST /admin/events  – create event (multipart for image upload)     */
/* ================================================================== */
router.post('/events', upload.single('eventImage'), async function (req, res) {
  await connectDB();
  try {
    var title       = (req.body.title       || '').trim();
    var date        = (req.body.date        || '').trim();
    var category    = (req.body.category    || 'General').trim();
    var location    = (req.body.location    || '').trim();
    var description = (req.body.description || '').trim();
    var registration = req.body.registration === 'on' || req.body.registration === 'true';

    if (!title || !date) {
      return res.status(400).json({ success: false, message: 'Event title and date are required.' });
    }

    var parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid date.' });
    }

    var eventData = {
      title, date: parsedDate, category, location, description, registration,
      image: { data: null, contentType: null }
    };

    if (req.file) {
      eventData.image = { data: req.file.buffer, contentType: req.file.mimetype };
    }

    var event = await EventDetails.create(eventData);

    return res.status(201).json({
      success: true,
      message: 'Event "' + event.title + '" created successfully.',
      event: {
        _id:      event._id,
        title:    event.title,
        date:     event.date,
        category: event.category,
        location: event.location
      }
    });
  } catch (error) {
    console.error('Create event failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the event. Please try again.' });
  }
});

/* ================================================================== */
/* PUT  /admin/events/:id  – update event                              */
/* ================================================================== */
router.put('/events/:id', upload.single('eventImage'), async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event id.' });
    }
    var title       = (req.body.title       || '').trim();
    var date        = (req.body.date        || '').trim();
    var category    = (req.body.category    || 'General').trim();
    var location    = (req.body.location    || '').trim();
    var description = (req.body.description || '').trim();
    var registration = req.body.registration === 'on' || req.body.registration === 'true';

    if (!title || !date) {
      return res.status(400).json({ success: false, message: 'Event title and date are required.' });
    }
    var parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid date.' });
    }

    var update = { title, date: parsedDate, category, location, description, registration };
    if (req.file) {
      update['image.data']        = req.file.buffer;
      update['image.contentType'] = req.file.mimetype;
    }

    var event = await EventDetails.findByIdAndUpdate(
      req.params.id, { $set: update }, { new: true }
    );
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    return res.json({ success: true, message: 'Event "' + event.title + '" updated successfully.' });
  } catch (error) {
    console.error('Update event failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update the event. Please try again.' });
  }
});

/* ================================================================== */
/* DELETE /admin/events/:id  – remove event and clean up member refs  */
/* ================================================================== */
router.delete('/events/:id', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event id.' });
    }

    var eventId = new mongoose.Types.ObjectId(req.params.id);

    /* 1. Delete the event from EVENT_DETAILS */
    var event = await EventDetails.findByIdAndDelete(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    /* 2. Remove the event id from every member who had it registered */
    await MemberDetails.updateMany(
      { registeredEvents: eventId },
      { $pull: { registeredEvents: eventId } }
    );

    return res.json({ success: true, message: 'Event "' + event.title + '" deleted successfully.' });
  } catch (error) {
    console.error('Delete event failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not delete the event. Please try again.' });
  }
});

/* ================================================================== */
/* PATCH /admin/leaders/:id/credentials  – set leader login creds     */
/* ================================================================== */
router.patch('/leaders/:id/credentials', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid leader id.' });
    }
     var password = (req.body.password || '').trim();

    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    /* Store sha256(salt + password) – never plain text. */
    var leaderSalt = makeSalt();
    var leader = await BatchLeader.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          salt: leaderSalt,
          passwordHash: sha256(leaderSalt, password),
          password: '',
          passwordUpdatedAt: new Date()
        }
      },
      { new: true }
    );
    if (!leader) {
      return res.status(404).json({ success: false, message: 'Leader not found.' });
    }
    return res.json({ success: true, message: 'Password updated for Batch ' + leader.year + ' leader.' });
  } catch (error) {
    console.error('Update leader credentials failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update credentials. Please try again.' });
  }
});

/* ================================================================== */
/* HELPER: default password for a member  ->  <admissionNumber>     */
/* ================================================================== */
function generateMemberPassword(admissionNumber) {
  return String(admissionNumber || '').trim();
}

/* ================================================================== */
/* POST /admin/members                                                  */
/* ================================================================== */
router.post('/members', async function (req, res) {
  await connectDB();
  try {
    var admissionNumber = (req.body.admissionNumber || '').trim();
    var name  = (req.body.name  || '').trim();
    var place = (req.body.place || '').trim();
    var batch = (req.body.batch || '').trim();
    var email = (req.body.email || '').trim().toLowerCase();

    if (!admissionNumber || !name || !place || !batch || !email) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    var existing = await MemberDetails.findOne({
      admissionNumber: new RegExp('^' + escapeRegex(admissionNumber) + '$', 'i'),
      name:  new RegExp('^' + escapeRegex(name)  + '$', 'i'),
      batch: batch
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'This member is already added.' });
    }

    var password = generateMemberPassword(admissionNumber);
    var member = await MemberDetails.create({ admissionNumber, name, place, batch, email, password: password });
    await linkMemberToBatch(member);

    return res.status(201).json({
      success: true,
      message: 'Member added successfully. Login password: ' + password,
      password: password,
      member: member
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This member is already added.' });
    }
    console.error('Add member failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the member. Please try again.' });
  }
});

/* ================================================================== */
/* Editable member fields (everything stored in MEMBER_DETAILS except  */
/* system fields and event registrations).                             */
/* ================================================================== */
var MEMBER_TEXT_FIELDS = [
  'admissionNumber', 'name', 'place', 'batch', 'email', 'password',
  'address', 'phone', 'whatsapp',
  'admYear', 'leaveYear', 'eduQual', 'religiousDegree', 'higherEdu',
  'currentStatus', 'workLocation', 'workInstitution', 'jobRole', 'college', 'collegePlace', 'course',
  'skills', 'languages', 'orgName', 'orgRole', 'orgRoles', 'supportNeeded',
  'earningMembers', 'hasDependents', 'dependentsWho', 'parentsDeceased',
  'chronicIll', 'chronicIllDetails',
  'fatherName', 'motherName',
  'ownHouse', 'married'
];
var MEMBER_NUMBER_FIELDS = ['familyCount', 'childrenCount'];
var MEMBER_YESNO_FIELDS = ['higherEdu', 'hasDependents', 'parentsDeceased', 'chronicIll', 'ownHouse', 'married'];
var PROFILE_DETAIL_FIELDS = [
  'address', 'phone', 'whatsapp',
  'admYear', 'leaveYear', 'eduQual', 'religiousDegree', 'higherEdu',
  'currentStatus',
  'skills', 'languages', 'orgRoles', 'supportNeeded',
  'familyCount', 'earningMembers', 'hasDependents',
  'parentsDeceased', 'chronicIll',
  'fatherName', 'motherName', 'ownHouse', 'married'
];

function isProfileCompleted(doc) {
  if (doc.profileCompleted) return true;
  /* Backward compatibility for profiles completed before the flag existed. */
  return PROFILE_DETAIL_FIELDS.every(function (key) {
    var value = doc[key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function profileCompletionPercent(doc) {
  var completedFields = PROFILE_DETAIL_FIELDS.filter(function (key) {
    var value = doc[key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  }).length;
  return Math.round((completedFields / PROFILE_DETAIL_FIELDS.length) * 100);
}

function serialiseMember(doc) {
  var out = { _id: String(doc._id) };
  MEMBER_TEXT_FIELDS.forEach(function (key) { out[key] = doc[key] == null ? '' : String(doc[key]); });
  MEMBER_NUMBER_FIELDS.forEach(function (key) {
    out[key] = (doc[key] === null || doc[key] === undefined || doc[key] === '') ? '' : Number(doc[key]);
  });
  out.createdAt = doc.createdAt ? new Date(doc.createdAt).toISOString() : null;
  out.updatedAt = doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null;
  out.registeredEvents = Array.isArray(doc.registeredEvents) ? doc.registeredEvents.length : 0;
  out.profileCompleted = isProfileCompleted(doc);
  out.profileCompletionPercent = profileCompletionPercent(doc);
  return out;
}

/* ================================================================== */
/* GET /admin/members/:id  – full member document (admin view)          */
/* ================================================================== */
router.get('/members/:id', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid member id.' });
    }
    var doc = await MemberDetails.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Member not found.' });
    return res.json({ success: true, member: serialiseMember(doc) });
  } catch (error) {
    console.error('Member lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the member.' });
  }
});

/* ================================================================== */
/* PUT /admin/members/:id  – update member details                      */
/* ================================================================== */
router.put('/members/:id', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid member id.' });
    }
    var member = await MemberDetails.findById(req.params.id);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    var body = req.body || {};
    var update = {};

    MEMBER_TEXT_FIELDS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) return;
      var value = String(body[key] == null ? '' : body[key]).trim();
      if (key === 'email') value = value.toLowerCase();
      if (MEMBER_YESNO_FIELDS.indexOf(key) !== -1 && ['yes', 'no', ''].indexOf(value) === -1) {
        value = '';
      }
      update[key] = value;
    });

    MEMBER_NUMBER_FIELDS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) return;
      var raw = String(body[key] == null ? '' : body[key]).trim();
      if (raw === '') { update[key] = null; return; }
      var num = Number(raw);
      if (!isFinite(num) || num < 0) { update[key] = null; return; }
      update[key] = num;
    });

    var admissionNumber = update.admissionNumber !== undefined ? update.admissionNumber : member.admissionNumber;
    var name  = update.name  !== undefined ? update.name  : member.name;
    var batch = update.batch !== undefined ? update.batch : member.batch;
    var email = update.email !== undefined ? update.email : member.email;

    if (!admissionNumber || !name || !batch || !email) {
      return res.status(400).json({ success: false, message: 'Admission number, name, batch and email are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    var duplicate = await MemberDetails.findOne({
      _id: { $ne: member._id },
      admissionNumber: new RegExp('^' + escapeRegex(admissionNumber) + '$', 'i'),
      name:  new RegExp('^' + escapeRegex(name) + '$', 'i'),
      batch: batch
    }).lean();
    if (duplicate) {
      return res.status(409).json({ success: false, message: 'Another member with the same admission number, name and batch already exists.' });
    }

    var previousBatch = batchYear(member.batch);

    Object.keys(update).forEach(function (key) { member[key] = update[key]; });
    await member.save();

    var newBatch = batchYear(member.batch);
    if (previousBatch !== newBatch) {
      await unlinkMemberFromBatch(member._id, previousBatch);
      await linkMemberToBatch(member);
    }

    return res.json({
      success: true,
      message: 'Member details updated successfully.',
      member: serialiseMember(member.toObject())
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Another member with the same admission number, name and batch already exists.' });
    }
    console.error('Update member failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update the member. Please try again.' });
  }
});

/* ================================================================== */
/* DELETE /admin/members/:id                                            */
/* Removes the member from MEMBER_DETAILS, BATCH_DETAILS, BATCH_LEADERS */
/* and any active login session in the SESSIONS collection.             */
/* ================================================================== */
router.delete('/members/:id', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid member id.' });
    }
    var member = await MemberDetails.findById(req.params.id).lean();
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    var memberId = String(member._id);

    /* 1. Remove the member document itself */
    await MemberDetails.deleteOne({ _id: member._id });

    /* 2. Detach from every batch that references it */
    await unlinkMemberFromBatch(member._id, batchYear(member.batch));

    /* 3. Remove any batch-leader assignment */
    var leadersRemoved = 0;
    try {
      var leaderResult = await BatchLeader.deleteMany({ memberId: member._id });
      leadersRemoved = (leaderResult && leaderResult.deletedCount) || 0;
    } catch (leaderError) {
      console.error('Removing batch leader record failed:', leaderError.message);
    }

    /* 4. Drop login sessions belonging to this member */
    var sessionsRemoved = await removeMemberSessions(memberId);

    return res.json({
      success: true,
      message: 'Member "' + (member.name || 'Unnamed') + '" was permanently deleted.',
      leadersRemoved: leadersRemoved,
      sessionsRemoved: sessionsRemoved
    });
  } catch (error) {
    console.error('Delete member failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not delete the member. Please try again.' });
  }
});

/* ================================================================== */
/* CSV IMPORT: multer instance + tiny RFC4180-ish parser                */
/* ================================================================== */
var csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },          // 2 MB max
  fileFilter: function (req, file, cb) {
    var name = (file.originalname || '').toLowerCase();
    var ok = name.endsWith('.csv') ||
             ['text/csv', 'application/csv', 'text/plain',
              'application/vnd.ms-excel'].indexOf(file.mimetype) !== -1;
    if (!ok) return cb(new Error('Only .csv files are allowed.'));
    cb(null, true);
  }
});

function detectDelimiter(text) {
  var firstLine = String(text).split('\n')[0] || '';
  var counts = { ',': 0, ';': 0, '\t': 0 };
  var inQuotes = false;
  for (var i = 0; i < firstLine.length; i++) {
    var ch = firstLine[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && counts[ch] !== undefined) counts[ch]++;
  }
  var best = ',';
  Object.keys(counts).forEach(function (d) { if (counts[d] > counts[best]) best = d; });
  return counts[best] > 0 ? best : ',';
}

function parseCsv(text) {
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  text = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  var delimiter = detectDelimiter(text);

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  return rows.filter(function (r) {
    return r.some(function (c) { return String(c).trim() !== ''; });
  });
}

var CSV_HEADER_ALIASES = {
  admissionnumber: 'admissionNumber',
  admissionno:     'admissionNumber',
  admission:       'admissionNumber',
  admno:           'admissionNumber',
  name:            'name',
  membername:      'name',
  fullname:        'name',
  place:           'place',
  location:        'place',
  batch:           'batch',
  year:            'batch',
  email:           'email',
  emailaddress:    'email',
  mail:            'email'
};

function normaliseHeader(cell) {
  var key = String(cell || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return CSV_HEADER_ALIASES[key] || null;
}

/* ================================================================== */
/* POST /admin/members/import  – bulk add members from a CSV file      */
/* ================================================================== */
router.post('/members/import', function (req, res) {
  csvUpload.single('csvFile')(req, res, async function (uploadError) {
    /* Everything below answers with JSON, never an HTML error page. */
    try {
      if (uploadError) {
        var uploadMessage = uploadError.message || 'Could not read the CSV file.';
        if (uploadError.code === 'LIMIT_FILE_SIZE') uploadMessage = 'The file is larger than 2 MB.';
        return res.status(400).json({ success: false, message: uploadMessage });
      }
      if (!req.file || !req.file.buffer || !req.file.buffer.length) {
        return res.status(400).json({ success: false, message: 'Please choose a CSV file.' });
      }

      try {
        await connectDB();
      } catch (dbError) {
        console.error('CSV import DB connection failed:', dbError.message);
        return res.status(503).json({ success: false, message: 'Database is not reachable right now. Please try again in a moment.' });
      }

      var rows = parseCsv(req.file.buffer.toString('utf8'));
      if (rows.length < 2) {
        return res.status(400).json({ success: false, message: 'The CSV needs a header row and at least one member row.' });
      }

      var headers = rows[0].map(normaliseHeader);
      var required = ['admissionNumber', 'name', 'place', 'batch', 'email'];
      var missing = required.filter(function (key) { return headers.indexOf(key) === -1; });
      if (missing.length) {
        return res.status(400).json({
          success: false,
          message: 'Missing column(s): ' + missing.join(', ') +
                   '. Expected header: admissionNumber, name, place, batch, email. ' +
                   'Header row read from your file: ' +
                   rows[0].map(function (c) { return String(c).trim(); }).join(' | ')
        });
      }

      var added = 0;
      var skipped = 0;
      var errors = [];
      var seen = {};

      for (var i = 1; i < rows.length; i++) {
        var cells = rows[i];
        var record = {};
        headers.forEach(function (key, idx) {
          if (key) record[key] = String(cells[idx] === undefined ? '' : cells[idx]).trim();
        });

        var admissionNumber = record.admissionNumber || '';
        var name  = record.name  || '';
        var place = record.place || '';
        var batch = record.batch || '';
        var email = (record.email || '').toLowerCase();
        var line  = i + 1;

        if (!admissionNumber || !name || !place || !batch || !email) {
          skipped++; errors.push('Row ' + line + ': all fields are required.'); continue;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          skipped++; errors.push('Row ' + line + ': invalid email "' + email + '".'); continue;
        }

        var fingerprint = (admissionNumber + '|' + name + '|' + batch).toLowerCase();
        if (seen[fingerprint]) {
          skipped++; errors.push('Row ' + line + ': duplicate row inside the file.'); continue;
        }
        seen[fingerprint] = true;

        try {
          var existing = await MemberDetails.findOne({
            admissionNumber: new RegExp('^' + escapeRegex(admissionNumber) + '$', 'i'),
            name:  new RegExp('^' + escapeRegex(name) + '$', 'i'),
            batch: batch
          });
          if (existing) {
            skipped++; errors.push('Row ' + line + ': ' + name + ' is already added.'); continue;
          }

          var member = await MemberDetails.create({
            admissionNumber, name, place, batch, email,
            password: generateMemberPassword(admissionNumber)
          });
          await linkMemberToBatch(member);
          added++;
        } catch (rowError) {
          skipped++;
          if (rowError && rowError.code === 11000) {
            errors.push('Row ' + line + ': ' + name + ' is already added.');
          } else {
            errors.push('Row ' + line + ': ' + (rowError.message || 'could not be saved.'));
          }
        }
      }

      var message = added
        ? added + (added === 1 ? ' member' : ' members') + ' imported successfully' +
          (skipped ? ', ' + skipped + ' skipped.' : '.')
        : 'No members were imported' +
          (errors.length ? ' \u2014 ' + errors[0] : '. Please check the file and try again.');

      return res.status(added ? 201 : 400).json({
        success: added > 0,
        message: message,
        added: added,
        skipped: skipped,
        errors: errors.slice(0, 20)
      });
    } catch (error) {
      console.error('CSV import failed:', error && error.message);
      return res.status(500).json({
        success: false,
        message: 'Could not import the CSV file: ' + ((error && error.message) || 'unexpected error') + '.'
      });
    }
  });
});

/* ================================================================== */
/* HELPERS for members / batches                                        */
/* ================================================================== */
async function findMembersForYear(year) {
  var docs = await MemberDetails.find({}, { batch: 1 }).lean();
  return docs.filter(function (doc) { return batchYear(doc.batch) === year; });
}

async function linkMemberToBatch(member) {
  try {
    var year = batchYear(member.batch);
    if (!year) return;
    await BatchDetails.updateOne(
      { year: year },
      { $addToSet: { memberIds: member._id }, $setOnInsert: { year: year, description: '' } },
      { upsert: true }
    );
    var batch = await BatchDetails.findOne({ year: year });
    if (batch) { batch.memberCount = batch.memberIds.length; await batch.save(); }
  } catch (error) {
    console.error('Linking member to batch failed:', error.message);
  }
}

/* Remove a member id from BATCH_DETAILS and refresh the stored count.  */
async function unlinkMemberFromBatch(memberId, year) {
  try {
    var filter = /^\d{4}$/.test(String(year || '')) ? { year: String(year) } : { memberIds: memberId };
    await BatchDetails.updateMany(filter, { $pull: { memberIds: memberId } });
    /* Safety net: the member may be listed under another batch document. */
    await BatchDetails.updateMany({ memberIds: memberId }, { $pull: { memberIds: memberId } });

    var batches = await BatchDetails.find({});
    for (var i = 0; i < batches.length; i++) {
      var doc = batches[i];
      var count = Array.isArray(doc.memberIds) ? doc.memberIds.length : 0;
      if (doc.memberCount !== count) { doc.memberCount = count; await doc.save(); }
    }
  } catch (error) {
    console.error('Unlinking member from batch failed:', error.message);
  }
}

/* Delete every express-session document that belongs to this member.   */
async function removeMemberSessions(memberId) {
  try {
    var db = mongoose.connection && mongoose.connection.db;
    if (!db) return 0;
    var sessions = db.collection('SESSIONS');
    var removed = 0;

    /* Sessions may be stored as objects (stringify:false) or as a JSON
       string, so match both shapes.                                     */
    var objectMatch = await sessions.deleteMany({ 'session.memberId': memberId });
    removed += (objectMatch && objectMatch.deletedCount) || 0;

    var stringMatch = await sessions.deleteMany({ session: { $regex: memberId } });
    removed += (stringMatch && stringMatch.deletedCount) || 0;

    return removed;
  } catch (error) {
    console.error('Removing member sessions failed:', error.message);
    return 0;
  }
}

router.get('/batches/:year/members-count', async function (req, res) {
  await connectDB();
  try {
    var year = batchYear(req.params.year);
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Invalid batch year.', count: 0, exists: false });
    }
    var members  = await findMembersForYear(year);
    var existing = await BatchDetails.exists({ year: year });
    return res.json({ success: true, year: year, count: members.length, exists: Boolean(existing) });
  } catch (error) {
    console.error('Batch member count failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load member count.', count: 0, exists: false });
  }
});

router.get('/batches/diagnostics', async function (req, res) {
  await connectDB();
  try {
    var indexes = await BatchDetails.collection.indexes();
    var total   = await BatchDetails.countDocuments();
    return res.json({ success: true, collection: 'BATCH_DETAILS', documents: total, indexes: indexes });
  } catch (error) {
    console.error('Batch diagnostics failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not read index information.' });
  }
});

router.post('/batches', async function (req, res) {
  await connectDB();
  try {
    var year        = batchYear(req.body.year);
    var description = (req.body.description || '').trim();

    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 4-digit batch year.' });
    }
    var existing = await BatchDetails.findOne({ year: year }).lean();
    if (existing) {
      return res.status(409).json({ success: false, message: 'Batch ' + year + ' already exists.' });
    }
    var members   = await findMembersForYear(year);
    var memberIds = members.map(function (doc) { return doc._id; });
    var batch     = await BatchDetails.create({ year, description, memberIds, memberCount: memberIds.length });

    return res.status(201).json({
      success: true,
      message: 'Batch ' + year + ' created with ' + memberIds.length + ' member(s).',
      batch: batch
    });
  } catch (error) {
    if (error && error.code === 11000) {
      var keys = Object.keys(error.keyPattern || {});
      if (keys.length === 1 && keys[0] === 'year') {
        return res.status(409).json({ success: false, message: 'This batch already exists.' });
      }
      return res.status(409).json({
        success: false,
        message: 'A stale unique index (' + (keys.join(', ') || 'unknown') +
          ') on BATCH_DETAILS is blocking new batches. Open /admin/batches/diagnostics and drop that index.'
      });
    }
    console.error('Create batch error:', error);
    return res.status(500).json({ success: false, message: 'Could not create the batch. Please try again.' });
  }
});

router.get('/batches', async function (req, res) {
  await connectDB();
  try {
    var years = {};
    var batches = await BatchDetails.find({}, { year: 1 }).lean();
    batches.forEach(function (b) {
      var y = batchYear(b.year);
      if (/^\d{4}$/.test(y)) years[y] = true;
    });
    var memberBatches = await MemberDetails.distinct('batch');
    memberBatches.forEach(function (b) {
      var y = batchYear(b);
      if (/^\d{4}$/.test(y)) years[y] = true;
    });
    var list = Object.keys(years).sort(function (a, b) { return Number(b) - Number(a); });
    return res.json({ success: true, years: list });
  } catch (error) {
    console.error('Batch list failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load batches.', years: [] });
  }
});

router.get('/batches/:year/members', async function (req, res) {
  await connectDB();
  try {
    var year = batchYear(req.params.year);
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Invalid batch year.', members: [] });
    }
    var docs = await MemberDetails.find({}, { name: 1, admissionNumber: 1, batch: 1 }).lean();
    var members = docs
      .filter(function (doc) { return batchYear(doc.batch) === year; })
      .map(function (doc) {
        return { _id: String(doc._id), name: doc.name || 'Unnamed member', admissionNumber: doc.admissionNumber || '' };
      })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    return res.json({ success: true, year: year, members: members });
  } catch (error) {
    console.error('Batch members lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load members.', members: [] });
  }
});

router.post('/leaders', async function (req, res) {
  await connectDB();
  try {
    var year     = batchYear(req.body.year);
    var password = String(req.body.password || '').trim();

    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Please select a valid 4-digit batch year.' });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: 'Please enter a password for the batch leader.' });
    }

    var leaderSalt = makeSalt();
    var batch  = await BatchDetails.findOne({ year: year }).lean();
    var leader = await BatchLeader.findOneAndUpdate(
      { year: year },
      {
        $set: {
          year: year,
          batchId: batch ? batch._id : undefined,
          salt: leaderSalt,
          passwordHash: sha256(leaderSalt, password),
          password: '',
          passwordUpdatedAt: new Date(),
          assignedAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({
      success: true,
      message: 'Leader password set for Batch ' + year + '.',
      leader: leader
    });
  } catch (error) {
    console.error('Save batch leader password failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save leader setup. Please try again.' });
  }
});

router.delete('/leaders/:id', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid leader id.' });
    }
    var deleted = await BatchLeader.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Leader setup not found.' });
    }
    return res.json({ success: true, message: 'Batch leader setup removed.' });
  } catch (error) {
    console.error('Delete batch leader setup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not remove leader setup.' });
  }
});

/* ================================================================== */
/* UTILITY FUNCTIONS                                                    */
/* ================================================================== */
function batchYear(batch) {
  var match = String(batch || '').match(/\d{4}/);
  return match ? match[0] : String(batch || '').trim();
}

function formatJoinedDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* All batch leaders, newest-assigned first – used by the dashboard batch leaders table. */
async function getAllBatchLeaders() {
  try {
    var docs = await BatchLeader.find({}).sort({ year: -1, _id: -1 }).lean();
    return docs.map(function (doc) {
      return {
        id:          String(doc._id),
        year:        batchYear(doc.year),
        assignedAt:  formatJoinedDate(doc.passwordUpdatedAt || doc.assignedAt || doc.createdAt),
        hasPassword: !!(doc.passwordHash || doc.password)
      };
    });
  } catch (error) {
    console.error('All batch leaders lookup failed:', error.message);
    return [];
  }
}

/* All members, newest first – used by the dashboard members table. */
async function getAllMembers() {
  try {
    var docs = await MemberDetails.find({}).sort({ createdAt: -1, _id: -1 }).lean();
    return docs.map(function (doc) {
      var phone = String(doc.phone || '').trim();
      var wa    = whatsappDigits(doc.whatsapp || doc.phone);
      return {
        id:                       String(doc._id),
        name:                     doc.name || '',
        email:                    doc.email || '',
        batch:                    batchYear(doc.batch),
        admissionNumber:          doc.admissionNumber || '',
        place:                    doc.place || '',
        address:                  doc.address || '',
        phone:                    phone,
        telLink:                  phone ? 'tel:' + phone.replace(/[^0-9+]/g, '') : '',
        whatsapp:                 doc.whatsapp || '',
        waLink:                   wa ? 'https://wa.me/' + wa : '',
        profileCompleted:         isProfileCompleted(doc),
        profileCompletionPercent: profileCompletionPercent(doc),
        admYear:                  doc.admYear || '',
        leaveYear:                doc.leaveYear || '',
        eduQual:                  doc.eduQual || '',
        religiousDegree:          doc.religiousDegree || '',
        higherEdu:                doc.higherEdu || '',
        currentStatus:            doc.currentStatus || '',
        workLocation:             doc.workLocation || '',
        workInstitution:          doc.workInstitution || '',
        jobRole:                  doc.jobRole || '',
        college:                  doc.college || '',
        collegePlace:             doc.collegePlace || '',
        course:                   doc.course || '',
        skills:                   doc.skills || '',
        languages:                doc.languages || '',
        orgName:                  doc.orgName || '',
        orgRole:                  doc.orgRole || '',
        orgRoles:                 doc.orgRoles || '',
        supportNeeded:            doc.supportNeeded || '',
        familyCount:              doc.familyCount != null ? doc.familyCount : '',
        earningMembers:           doc.earningMembers || '',
        hasDependents:            doc.hasDependents || '',
        dependentsWho:            doc.dependentsWho || '',
        parentsDeceased:          doc.parentsDeceased || '',
        chronicIll:               doc.chronicIll || '',
        chronicIllDetails:        doc.chronicIllDetails || '',
        fatherName:               doc.fatherName || '',
        motherName:               doc.motherName || '',
        ownHouse:                 doc.ownHouse || '',
        married:                  doc.married || '',
        childrenCount:            doc.childrenCount != null ? doc.childrenCount : ''
      };
    });
  } catch (error) {
    console.error('All members lookup failed:', error.message);
    return [];
  }
}

/* Normalise a phone number into the digits wa.me expects (India default). */
function whatsappDigits(raw) {
  var d = String(raw || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.length === 10) d = '91' + d;
  else if (d.length === 11 && d.charAt(0) === '0') d = '91' + d.slice(1);
  else if (d.length === 12 && d.slice(0, 2) === '91') d = d;
  return d;
}


async function liveMemberCountsByYear() {
  var counts = {};
  var docs   = await MemberDetails.find({}, { batch: 1 }).lean();
  docs.forEach(function (doc) {
    var year = batchYear(doc.batch);
    if (!year) return;
    counts[year] = (counts[year] || 0) + 1;
  });
  return counts;
}

async function getMembersPerBatch() {
  try {
    var docs = await BatchDetails.find({}, { year: 1, memberCount: 1, memberIds: 1 });
    var live = null;
    try { live = await liveMemberCountsByYear(); } catch (e) { console.error('Live count failed:', e.message); }

    var rows = docs.map(function (doc) {
      var label  = batchYear(doc.year) || String(doc.year || '').trim();
      var stored = typeof doc.memberCount === 'number' ? doc.memberCount : (Array.isArray(doc.memberIds) ? doc.memberIds.length : 0);
      var count  = (live && Object.prototype.hasOwnProperty.call(live, label)) ? live[label] : (live ? 0 : stored);
      return { label: label, value: count };
    }).filter(function (row) { return row.label; });

    rows.sort(function (a, b) {
      var na = Number(a.label), nb = Number(b.label);
      var aNum = !isNaN(na), bNum = !isNaN(nb);
      if (aNum && bNum) return na - nb;
      if (aNum) return -1;
      if (bNum) return 1;
      return String(a.label).localeCompare(String(b.label), undefined, { numeric: true });
    });

    return { labels: rows.map(function (r) { return r.label; }), values: rows.map(function (r) { return r.value; }), batchCount: rows.length };
  } catch (error) {
    console.error('Members per batch lookup failed:', error.message);
    return { labels: [], values: [], batchCount: 0 };
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ================================================================== */
/* GET  /admin/gallery  – list saved gallery images (JSON, no binary)  */
/* ================================================================== */
router.get('/gallery', async function (req, res) {
  await connectDB();
  try {
    var images = await getGalleryImages();
    return res.json({ success: true, images: images });
  } catch (error) {
    console.error('List gallery failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the gallery.' });
  }
});

/* ================================================================== */
/* GET  /admin/gallery/:id/image  – serve stored gallery image         */
/* ================================================================== */
router.get('/gallery/:id/image', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).end();
    }
    var doc = await Gallery.findById(req.params.id, { 'image.data': 1, 'image.contentType': 1 }).lean();
    if (!doc || !doc.image || !doc.image.data) {
      return res.status(404).end();
    }
    res.set('Content-Type', doc.image.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(doc.image.data.buffer || doc.image.data);
  } catch (error) {
    console.error('Serve gallery image failed:', error.message);
    return res.status(500).end();
  }
});

/* ================================================================== */
/* POST /admin/gallery  – upload image + description into GALLERY      */
/* ================================================================== */
router.post('/gallery', upload.single('galleryImage'), async function (req, res) {
  await connectDB();
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please choose an image to upload.' });
    }

    var description = (req.body.description || '').trim();

    var doc = await Gallery.create({
      image:       { data: req.file.buffer, contentType: req.file.mimetype },
      description: description
    });

    return res.status(201).json({
      success: true,
      message: 'Image added to the gallery.',
      image: {
        _id:         String(doc._id),
        description: doc.description || '',
        createdAt:   doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
        hasImage:    true
      }
    });
  } catch (error) {
    console.error('Create gallery image failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the image. Please try again.' });
  }
});

/* ================================================================== */
/* DELETE /admin/gallery/:id  – remove a saved gallery image           */
/* ================================================================== */
router.delete('/gallery/:id', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid image id.' });
    }
    var doc = await Gallery.findByIdAndDelete(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Image not found.' });
    }
    return res.json({ success: true, message: 'Image deleted.' });
  } catch (error) {
    console.error('Delete gallery image failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not delete the image.' });
  }
});

/* ================================================================== */
/* GET  /admin/articles  – list saved articles (JSON, no binary)        */
/* ================================================================== */
router.get('/articles', async function (req, res) {
  await connectDB();
  try {
    var articles = await getArticles();
    return res.json({ success: true, articles: articles });
  } catch (error) {
    console.error('List articles failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the articles.' });
  }
});

/* ================================================================== */
/* GET  /admin/articles/:id/image  – serve stored article image         */
/* ================================================================== */
router.get('/articles/:id/image', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).end();
    }
    var doc = await Article.findById(req.params.id, { 'image.data': 1, 'image.contentType': 1 }).lean();
    if (!doc || !doc.image || !doc.image.data) {
      return res.status(404).end();
    }
    res.set('Content-Type', doc.image.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(doc.image.data.buffer || doc.image.data);
  } catch (error) {
    console.error('Serve article image failed:', error.message);
    return res.status(500).end();
  }
});

/* ================================================================== */
/* POST /admin/articles – save an article into ARTICLE_DETAILS          */
/* ================================================================== */
router.post('/articles', upload.single('articleImage'), async function (req, res) {
  await connectDB();
  try {
    var heading = (req.body.heading || '').trim();
    var author  = (req.body.author  || '').trim();
    var content = (req.body.content || '').trim();

    if (!heading) {
      return res.status(400).json({ success: false, message: 'Article heading is required.' });
    }

    var payload = { heading: heading, author: author, content: content };
    if (req.file && req.file.buffer) {
      payload.image = { data: req.file.buffer, contentType: req.file.mimetype };
    }

    var doc = await Article.create(payload);
    var d = doc.createdAt ? new Date(doc.createdAt) : new Date();

    return res.status(201).json({
      success: true,
      message: 'Article uploaded.',
      article: {
        _id:      String(doc._id),
        heading:  doc.heading,
        author:   doc.author || '',
        excerpt:  articleExcerpt(doc.content, 140),
        content:  doc.content || '',
        dateFormatted: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        createdAt: d.toISOString(),
        hasImage: !!(doc.image && doc.image.contentType)
      }
    });
  } catch (error) {
    console.error('Create article failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the article. Please try again.' });
  }
});

/* ================================================================== */
/* DELETE /admin/articles/:id  – remove a saved article                 */
/* ================================================================== */
router.delete('/articles/:id', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid article id.' });
    }
    var doc = await Article.findByIdAndDelete(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Article not found.' });
    }
    return res.json({ success: true, message: 'Article deleted.' });
  } catch (error) {
    console.error('Delete article failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not delete the article.' });
  }
});

/* ================================================================== */
/* GET  /admin/payment-setup/qr-code  – serve stored payment QR image  */
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
/* POST /admin/payment-setup  – save payment setup into PAYMENT_SETUP   */
/* ================================================================== */
router.post('/payment-setup', upload.single('qrCode'), async function (req, res) {
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
      message: 'Payment details saved successfully',
      paymentSetup: {
        upiId: doc.upiId || '',
        gpayNumber: doc.gpayNumber || '',
        hasQrCode: !!(doc.qrCode && doc.qrCode.contentType)
      }
    });
  } catch (error) {
    console.error('Save payment setup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save payment details. Please try again.' });
  }
});

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

          var dSub = item.submittedAt ? new Date(item.submittedAt) : null;
          var dApp = item.approvedAt ? new Date(item.approvedAt) : null;

          submittedList.push({
            paymentId: String(item._id),
            memberId: memberIdStr,
            memberName: member.name || 'Unnamed',
            admissionNumber: member.admissionNumber || '',
            batch: member.batch || '',
            month: mItem.month,
            year: mItem.year,
            monthLabel: (MONTH_NAMES[mItem.month - 1] || '') + ' ' + mItem.year,
            amount: item.amount || 30,
            status: itemStatus,
            badgeColor: itemStatus === 'Approved' ? 'bg-success' : (itemStatus === 'Pending' ? 'bg-warning text-dark' : 'bg-danger'),
            hasScreenshot: !!(item.screenShot && item.screenShot.contentType),
            approvedBy: item.approvedBy || '',
            approvedAtFormatted: dApp ? dApp.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
            rejectionReason: item.rejectionReason || '',
            submittedAtFormatted: dSub ? dSub.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
          });
        });
      });
    });

    submittedList.sort(function (a, b) {
      return b.year - a.year || b.month - a.month;
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
    console.error('Fetch all contributions failed:', err.message);
    return { submitted: [], unpaid: [], counts: { total: 0, pending: 0, approved: 0, rejected: 0, unpaid: 0 } };
  }
}

/* GET /admin/contributions – JSON list of all submitted and unpaid contributions */
router.get('/contributions', async function (req, res) {
  await connectDB();
  try {
    var data = await getAllContributionsData();
    return res.json({ success: true, submitted: data.submitted, unpaid: data.unpaid, counts: data.counts });
  } catch (error) {
    console.error('List contributions failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load contributions data.' });
  }
});

/* GET /admin/contributions/image/:memberId/:paymentId – serve payment screenshot image */
router.get('/contributions/image/:memberId/:paymentId', async function (req, res) {
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
    console.error('Serve contribution screenshot failed:', error.message);
    return res.status(500).end();
  }
});

/* POST /admin/contributions/:memberId/:paymentId/approve – approve payment */
router.post('/contributions/:memberId/:paymentId/approve', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId) || !mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      return res.status(400).json({ success: false, message: 'Invalid member or payment id.' });
    }

    var adminName ='Hamd Admin';

    var doc = await PaymentStatus.findOne({ memberId: req.params.memberId });
    if (!doc || !doc.membersPayments) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    var targetId = String(req.params.paymentId);
    var item = doc.membersPayments.id(targetId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Payment submission item not found.' });
    }

    item.status = 'Approved';
    item.approvedBy = adminName;
    item.approvedAt = new Date();
    item.rejectionReason = '';

    await doc.save();

    return res.json({ success: true, message: 'Payment approved successfully.' });
  } catch (error) {
    console.error('Approve contribution payment failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not approve payment.' });
  }
});

/* POST /admin/contributions/:memberId/:paymentId/reject – reject payment */
router.post('/contributions/:memberId/:paymentId/reject', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId) || !mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      return res.status(400).json({ success: false, message: 'Invalid member or payment id.' });
    }

    var option = (req.body.reasonOption || '').trim();
    var customReason = (req.body.customReason || '').trim();
    var finalReason = option === 'other' ? customReason : option;
    if (!finalReason) finalReason = 'Rejected by Admin';

    var adminName ='Hamd Admin';

    var doc = await PaymentStatus.findOne({ memberId: req.params.memberId });
    if (!doc || !doc.membersPayments) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    var targetId = String(req.params.paymentId);
    var item = doc.membersPayments.id(targetId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Payment submission item not found.' });
    }

    item.status = 'Rejected';
    item.rejectionReason = finalReason;
    item.approvedBy = adminName;
    item.approvedAt = new Date();

    await doc.save();

    return res.json({ success: true, message: 'Payment rejected.' });
  } catch (error) {
    console.error('Reject contribution payment failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not reject payment.' });
  }
});

module.exports = router;
