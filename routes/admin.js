var express = require('express');
var router = express.Router();
var multer  = require('multer');

var mongoose    = require('mongoose');
var MemberDetails = require('../models/MemberDetails');
var BatchDetails  = require('../models/BatchDetails');
var BatchLeader   = require('../models/BatchLeader');
var EventDetails  = require('../models/EventDetails');
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
router.get('/', async function (req, res, next) {
  await connectDB();
  var totalAlumni  = 0;
  var totalBatches = 0;
  var batchLeaders = 0;
  var allMembers   = [];
  var allBatchLeaders = [];
  var batchYears   = [];
  var batchChart   = { labels: [], values: [], batchCount: 0 };
  var upcomingEvents = [];

  try {
    totalAlumni     = await MemberDetails.countDocuments();
    batchLeaders    = await getBatchLeaderCount();
    allMembers      = await getAllMembers();
    allBatchLeaders = await getAllBatchLeaders();
    batchChart      = await getMembersPerBatch();
    totalBatches   = batchChart.batchCount;
    upcomingEvents = await getUpcomingEvents(5);
    /* Collect sorted unique batch years from the member list */
    var yearSet = {};
    allMembers.forEach(function (m) { if (m.batch) yearSet[m.batch] = true; });
    batchYears = Object.keys(yearSet).sort(function (a, b) { return Number(b) - Number(a); });
  } catch (error) {
    console.error('Dashboard stats failed:', error.message);
  }

  res.render('admin', {
    layout: false,
    title:     'Alumni Admin Dashboard',
    adminName: 'Super Admin',
    stats: {
      totalAlumni:    totalAlumni.toLocaleString('en-US'),
      alumniGrowth:   '+12.4%',
      totalBatches:   String(totalBatches),
      batchLeaders:   String(batchLeaders),
      upcomingEvents: String(upcomingEvents.length)
    },
    batchChartData: JSON.stringify(batchChart),
    allMembers:       allMembers,
    batchLeadersList: allBatchLeaders,
    batchYears:       batchYears,
    upcomingEvents: upcomingEvents,
    recentActivities: [
      { type: 'user',         icon: 'bi-person-plus-fill',  iconBg: 'bg-emerald-soft text-emerald', title: 'New Alumni Registered',    desc: 'Zaid Ibn Shafi completed verification for Batch 2024.', time: '10 mins ago' },
      { type: 'leader',       icon: 'bi-person-badge-fill', iconBg: 'bg-indigo-soft text-indigo',   title: 'Batch Leader Assigned',     desc: 'Muhammed Rizwan assigned as Leader for Batch 2022.',    time: '2 hours ago' },
      { type: 'announcement', icon: 'bi-megaphone-fill',    iconBg: 'bg-amber-soft text-amber',     title: 'Announcement Published',    desc: 'Registration for Annual Meet 2026 is now open.',        time: '5 hours ago' },
      { type: 'gallery',      icon: 'bi-images',            iconBg: 'bg-purple-soft text-purple',   title: 'Gallery Album Updated',     desc: 'Uploaded 24 new high-res photos from Convocation Day.', time: '1 day ago'   }
    ]
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
          description: 1, 'image.contentType': 1 })
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
      hasImage:    !!(doc.image && doc.image.contentType)
    });
  } catch (error) {
    console.error('Get event detail failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load event.' });
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

    if (!title || !date) {
      return res.status(400).json({ success: false, message: 'Event title and date are required.' });
    }

    var parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid date.' });
    }

    var eventData = {
      title, date: parsedDate, category, location, description,
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

    if (!title || !date) {
      return res.status(400).json({ success: false, message: 'Event title and date are required.' });
    }
    var parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid date.' });
    }

    var update = { title, date: parsedDate, category, location, description };
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
/* DELETE /admin/events/:id  – remove event                           */
/* ================================================================== */
router.delete('/events/:id', async function (req, res) {
  await connectDB();
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid event id.' });
    }
    var event = await EventDetails.findByIdAndDelete(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
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
    var username = (req.body.username || '').trim();
    var password = (req.body.password || '').trim();

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    var leader = await BatchLeader.findByIdAndUpdate(
      req.params.id,
      { $set: { username, password } },
      { new: true }
    );
    if (!leader) {
      return res.status(404).json({ success: false, message: 'Leader not found.' });
    }
    return res.json({ success: true, message: 'Credentials updated for ' + (leader.memberName || 'leader') + '.' });
  } catch (error) {
    console.error('Update leader credentials failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update credentials. Please try again.' });
  }
});

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

    var member = await MemberDetails.create({ admissionNumber, name, place, batch, email });
    await linkMemberToBatch(member);

    return res.status(201).json({ success: true, message: 'Member added successfully.', member: member });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This member is already added.' });
    }
    console.error('Add member failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the member. Please try again.' });
  }
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
    var memberId = String(req.body.memberId || '').trim();

    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Please select a valid batch year.' });
    }
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      return res.status(400).json({ success: false, message: 'Please select a member to assign.' });
    }
    var member = await MemberDetails.findById(memberId).lean();
    if (!member) {
      return res.status(404).json({ success: false, message: 'That member no longer exists.' });
    }
    if (batchYear(member.batch) !== year) {
      return res.status(400).json({ success: false, message: 'That member does not belong to batch ' + year + '.' });
    }
    var batch  = await BatchDetails.findOne({ year: year }).lean();
    var leader = await BatchLeader.findOneAndUpdate(
      { year: year },
      { $set: { year, batchId: batch ? batch._id : undefined, memberId: member._id, memberName: member.name || '', assignedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({
      success: true,
      message: (member.name || 'Member') + ' is now the leader of batch ' + year + '.',
      leader: leader
    });
  } catch (error) {
    console.error('Assign batch leader failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not assign the leader. Please try again.' });
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
    var docs = await BatchLeader.find({}).sort({ assignedAt: -1, _id: -1 }).lean();
    return docs.map(function (doc) {
      return {
        id:          String(doc._id),
        memberName:  doc.memberName  || '',
        year:        batchYear(doc.year),
        assignedAt:  formatJoinedDate(doc.assignedAt)
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
      return {
        id:         String(doc._id),
        name:       doc.name       || '',
        email:      doc.email      || '',
        batch:      batchYear(doc.batch),
        joinedDate: formatJoinedDate(doc.createdAt)
      };
    });
  } catch (error) {
    console.error('All members lookup failed:', error.message);
    return [];
  }
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

module.exports = router;
