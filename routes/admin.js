var express = require('express');
var router = express.Router();
var multer = require('multer');

var mongoose = require('mongoose');
var MemberDetails = require('../models/MemberDetails');
var BatchDetails = require('../models/BatchDetails');
var BatchLeader = require('../models/BatchLeader');
var EventDetails = require('../models/EventDetails');
const connectDB = require("../config/db");

/* Multer: store uploaded files in memory as Buffer. */
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

/* Number of assigned batch leaders (BATCH_LEADERS collection). */
async function getBatchLeaderCount() {
  try {
    return await BatchLeader.countDocuments();
  } catch (error) {
    console.error('Batch leader count failed:', error.message);
    return 0;
  }
}


/* GET Admin Dashboard. */
router.get('/', async function(req, res, next) {
  await connectDB();
  let totalAlumni = 0;
  let totalBatches = 0;
  let batchLeaders = 0;
  let recentMembers = [];
  let batchChart = { labels: [], values: [], batchCount: 0 };

  try {
    totalAlumni = await MemberDetails.countDocuments();
    batchLeaders = await getBatchLeaderCount();
    recentMembers = await getRecentMembers(5);
    batchChart = await getMembersPerBatch();
    /* Batch figures come from BATCH_DETAILS so header, badge and chart agree. */
    totalBatches = batchChart.batchCount;
  } catch (error) {
    console.error('Dashboard stats failed:', error.message);
  }


  res.render('admin', {
    layout: false,
    title: 'Alumni Admin Dashboard',
    adminName: 'Super Admin',
    stats: {
      totalAlumni: totalAlumni.toLocaleString('en-US'),
      alumniGrowth: '+12.4%',
      totalBatches: String(totalBatches),
      batchLeaders: String(batchLeaders),
      upcomingEvents: '3'
    },
    batchChartData: JSON.stringify(batchChart),

    recentMembers: recentMembers,
    upcomingEvents: [
      { title: 'Annual Alumni Meet 2026', date: 'Aug 15, 2026', month: 'AUG', day: '15', location: 'Grand Auditorium', category: 'Reunion', badgeColor: 'bg-primary' },
      { title: 'Executive Committee Meeting', date: 'Aug 25, 2026', month: 'AUG', day: '25', location: 'Conference Room B', category: 'Official', badgeColor: 'bg-info' },
      { title: 'Global Career Seminar & Tech Talk', date: 'Sep 02, 2026', month: 'SEP', day: '02', location: 'Virtual (Zoom)', category: 'Seminar', badgeColor: 'bg-warning text-dark' }
    ],
    recentActivities: [
      { type: 'user', icon: 'bi-person-plus-fill', iconBg: 'bg-emerald-soft text-emerald', title: 'New Alumni Registered', desc: 'Zaid Ibn Shafi completed verification for Batch 2024.', time: '10 mins ago' },
      { type: 'leader', icon: 'bi-person-badge-fill', iconBg: 'bg-indigo-soft text-indigo', title: 'Batch Leader Assigned', desc: 'Muhammed Rizwan assigned as Leader for Batch 2022.', time: '2 hours ago' },
      { type: 'announcement', icon: 'bi-megaphone-fill', iconBg: 'bg-amber-soft text-amber', title: 'Announcement Published', desc: 'Registration for Annual Meet 2026 is now open.', time: '5 hours ago' },
      { type: 'gallery', icon: 'bi-images', iconBg: 'bg-purple-soft text-purple', title: 'Gallery Album Updated', desc: 'Uploaded 24 new high-res photos from Convocation Day.', time: '1 day ago' }
    ]
  });
});

/* POST Add a new alumni member. */
router.post('/members', async function (req, res) {
  await connectDB();
  try {
    const admissionNumber = (req.body.admissionNumber || '').trim();
    const name = (req.body.name || '').trim();
    const place = (req.body.place || '').trim();
    const batch = (req.body.batch || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();

    if (!admissionNumber || !name || !place || !batch || !email) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const existing = await MemberDetails.findOne({
      admissionNumber: new RegExp('^' + escapeRegex(admissionNumber) + '$', 'i'),
      name: new RegExp('^' + escapeRegex(name) + '$', 'i'),
      batch: batch
    });

    if (existing) {
      return res.status(409).json({ success: false, message: 'This member is already added.' });
    }

    const member = await MemberDetails.create({ admissionNumber, name, place, batch, email });

    // Keep BATCH_DETAILS in sync with the new member.
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

/* All MEMBER_DETAILS documents that belong to a given batch year. */
async function findMembersForYear(year) {
  const docs = await MemberDetails.find({}, { batch: 1 }).lean();
  return docs.filter(function (doc) { return batchYear(doc.batch) === year; });
}

/* Add a freshly created member to its BATCH_DETAILS document (creating it if needed). */
async function linkMemberToBatch(member) {
  try {
    const year = batchYear(member.batch);
    if (!year) return;

    await BatchDetails.updateOne(
      { year: year },
      {
        $addToSet: { memberIds: member._id },
        $setOnInsert: { year: year, description: '' }
      },
      { upsert: true }
    );

    const batch = await BatchDetails.findOne({ year: year });
    if (batch) {
      batch.memberCount = batch.memberIds.length;
      await batch.save();
    }
  } catch (error) {
    console.error('Linking member to batch failed:', error.message);
  }
}

/* GET how many members would be linked to a batch year (used by the Create Batch modal). */
router.get('/batches/:year/members-count', async function (req, res) {
  await connectDB();
  try {
    const year = batchYear(req.params.year);
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Invalid batch year.', count: 0, exists: false });
    }

    const members = await findMembersForYear(year);
    const existing = await BatchDetails.exists({ year: year });
    return res.json({ success: true, year: year, count: members.length, exists: Boolean(existing) });
  } catch (error) {
    console.error('Batch member count failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load member count.', count: 0, exists: false });
  }
});

/* GET diagnostics for BATCH_DETAILS indexes (helps explain false duplicate errors). */
router.get('/batches/diagnostics', async function (req, res) {
  await connectDB();
  try {
    const indexes = await BatchDetails.collection.indexes();
    const total = await BatchDetails.countDocuments();
    return res.json({ success: true, collection: 'BATCH_DETAILS', documents: total, indexes: indexes });
  } catch (error) {
    console.error('Batch diagnostics failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not read index information.' });
  }
});

/* POST Create a new batch in BATCH_DETAILS. */
router.post('/batches', async function (req, res) {
await connectDB();
  try {
    const year = batchYear(req.body.year);
    const description = (req.body.description || '').trim();

    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 4-digit batch year.' });
    }

    /* The ONLY condition that means "already exists": a BATCH_DETAILS doc with this year. */
    const existing = await BatchDetails.findOne({ year: year }).lean();
    if (existing) {
      return res.status(409).json({ success: false, message: 'Batch ' + year + ' already exists.' });
    }

    const members = await findMembersForYear(year);
    const memberIds = members.map(function (doc) { return doc._id; });

    const batch = await BatchDetails.create({
      year: year,
      description: description,
      memberIds: memberIds,
      memberCount: memberIds.length
    });

    return res.status(201).json({
      success: true,
      message: 'Batch ' + year + ' created with ' + memberIds.length + ' member(s).',
      batch: batch
    });
  } catch (error) {
    if (error && error.code === 11000) {
      const keyPattern = error.keyPattern || {};
      const keys = Object.keys(keyPattern);
      /* Only a conflict on `year` is a real duplicate batch. */
      if (keys.length === 1 && keys[0] === 'year') {
        return res.status(409).json({ success: false, message: 'This batch already exists.' });
      }
      console.error(
        'Create batch duplicate key on an unexpected index:',
        JSON.stringify(keyPattern),
        JSON.stringify(error.keyValue || {})
      );
      return res.status(409).json({
        success: false,
        message: 'A stale unique index (' + (keys.join(', ') || 'unknown') +
          ') on BATCH_DETAILS is blocking new batches. Open /admin/batches/diagnostics and drop that index.'
      });
    }

    console.error("========== CREATE BATCH ERROR ==========");
console.error(error);
console.error("Code:", error.code);
console.error("Name:", error.name);
console.error("KeyPattern:", error.keyPattern);
console.error("KeyValue:", error.keyValue);
console.error("========================================");

    return res.status(500).json({ success: false, message: 'Could not create the batch. Please try again.' });
  }
});


/* GET the list of batch years for the Assign Leader modal. */
router.get('/batches', async function (req, res) {
await connectDB();
  try {
    const years = {};

    const batches = await BatchDetails.find({}, { year: 1 }).lean();
    batches.forEach(function (b) {
      const year = batchYear(b.year);
      if (/^\d{4}$/.test(year)) years[year] = true;
    });

    /* Fall back to whatever years the members themselves carry. */
    const memberBatches = await MemberDetails.distinct('batch');
    memberBatches.forEach(function (b) {
      const year = batchYear(b);
      if (/^\d{4}$/.test(year)) years[year] = true;
    });

    const list = Object.keys(years).sort(function (a, b) { return Number(b) - Number(a); });
    return res.json({ success: true, years: list });
  } catch (error) {
    console.error('Batch list failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load batches.', years: [] });
  }
});

/* GET the members of a batch year (used to fill the leader dropdown). */
router.get('/batches/:year/members', async function (req, res) {
await connectDB();
  try {
    const year = batchYear(req.params.year);
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Invalid batch year.', members: [] });
    }

    const docs = await MemberDetails.find({}, { name: 1, admissionNumber: 1, batch: 1 }).lean();
    const members = docs
      .filter(function (doc) { return batchYear(doc.batch) === year; })
      .map(function (doc) {
        return {
          _id: String(doc._id),
          name: doc.name || 'Unnamed member',
          admissionNumber: doc.admissionNumber || ''
        };
      })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    return res.json({ success: true, year: year, members: members });
  } catch (error) {
    console.error('Batch members lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load members.', members: [] });
  }
});

/* POST Assign a batch leader into BATCH_LEADERS. */
router.post('/leaders', async function (req, res) {
await connectDB();
  try {
    const year = batchYear(req.body.year);
    const memberId = String(req.body.memberId || '').trim();

    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Please select a valid batch year.' });
    }
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      return res.status(400).json({ success: false, message: 'Please select a member to assign.' });
    }

    const member = await MemberDetails.findById(memberId).lean();
    if (!member) {
      return res.status(404).json({ success: false, message: 'That member no longer exists.' });
    }
    if (batchYear(member.batch) !== year) {
      return res.status(400).json({ success: false, message: 'That member does not belong to batch ' + year + '.' });
    }

    const batch = await BatchDetails.findOne({ year: year }).lean();

    const leader = await BatchLeader.findOneAndUpdate(
      { year: year },
      {
        $set: {
          year: year,
          batchId: batch ? batch._id : undefined,
          memberId: member._id,
          memberName: member.name || '',
          assignedAt: new Date()
        }
      },
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



/* Batch value may be "2021", "2021-2022" or "Batch 2021" - show the year only. */
function batchYear(batch) {
  const match = String(batch || '').match(/\d{4}/);
  return match ? match[0] : String(batch || '').trim();
}

function formatJoinedDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

/* Latest registered members from MEMBER_DETAILS. */
async function getRecentMembers(limit) {
  try {
    const docs = await MemberDetails.find({})
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    return docs.map(function (doc) {
      return {
        id: String(doc._id),
        name: doc.name,
        email: doc.email,
        batch: batchYear(doc.batch),
        joinedDate: formatJoinedDate(doc.createdAt)
      };
    });
  } catch (error) {
    console.error('Recent members lookup failed:', error.message);
    return [];
  }
}

/* Live member count per year, computed from MEMBER_DETAILS (never stale). */
async function liveMemberCountsByYear() {
  const counts = {};
  const docs = await MemberDetails.find({}, { batch: 1 }).lean();
  docs.forEach(function (doc) {
    const year = batchYear(doc.batch);
    if (!year) return;
    counts[year] = (counts[year] || 0) + 1;
  });
  return counts;
}

/*
 * Member counts per batch.
 * BATCH_DETAILS is the source of truth for WHICH batches exist; the bar value is
 * a live MEMBER_DETAILS count so an out-of-date memberCount can't show stale data.
 */
async function getMembersPerBatch() {
  try {
    const docs = await BatchDetails.find({}, { year: 1, memberCount: 1, memberIds: 1 });

    let live = null;
    try {
      live = await liveMemberCountsByYear();
    } catch (countError) {
      console.error('Live member count failed, falling back to stored counts:', countError.message);
    }

    const rows = docs.map(function (doc) {
      const label = batchYear(doc.year) || String(doc.year || '').trim();
      const stored = typeof doc.memberCount === 'number'
        ? doc.memberCount
        : (Array.isArray(doc.memberIds) ? doc.memberIds.length : 0);
      const count = (live && Object.prototype.hasOwnProperty.call(live, label))
        ? live[label]
        : (live ? 0 : stored);
      return { label: label, value: count };
    }).filter(function (row) { return row.label; });

    rows.sort(function (a, b) {
      const na = Number(a.label);
      const nb = Number(b.label);
      const aNum = !isNaN(na);
      const bNum = !isNaN(nb);
      if (aNum && bNum) return na - nb;
      if (aNum) return -1;
      if (bNum) return 1;
      return String(a.label).localeCompare(String(b.label), undefined, { numeric: true });
    });

    return {
      labels: rows.map(function (row) { return row.label; }),
      values: rows.map(function (row) { return row.value; }),
      batchCount: rows.length
    };
  } catch (error) {
    console.error('Members per batch lookup failed:', error.message);
    return { labels: [], values: [], batchCount: 0 };
  }
}


/* POST Create a new event in EVENT_DETAILS. Accepts multipart/form-data for image upload. */
router.post('/events', upload.single('eventImage'), async function (req, res) {
  await connectDB();
  try {
    const title = (req.body.title || '').trim();
    const date = (req.body.date || '').trim();
    const category = (req.body.category || 'General').trim();
    const location = (req.body.location || '').trim();
    const description = (req.body.description || '').trim();

    if (!title || !date) {
      return res.status(400).json({ success: false, message: 'Event title and date are required.' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid date.' });
    }

    const eventData = {
      title,
      date: parsedDate,
      category,
      location,
      description,
      image: { data: null, contentType: null }
    };

    if (req.file) {
      eventData.image = {
        data: req.file.buffer,
        contentType: req.file.mimetype
      };
    }

    const event = await EventDetails.create(eventData);

    return res.status(201).json({
      success: true,
      message: 'Event "' + event.title + '" created successfully.',
      event: {
        _id: event._id,
        title: event.title,
        date: event.date,
        category: event.category,
        location: event.location
      }
    });
  } catch (error) {
    console.error('Create event failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the event. Please try again.' });
  }
});


function escapeRegex(value) {

  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
