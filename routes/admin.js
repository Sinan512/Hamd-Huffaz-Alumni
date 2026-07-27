var express = require('express');
var router = express.Router();

var mongoose = require('mongoose');
var MemberDetails = require('../models/MemberDetails');
var BatchDetails = require('../models/BatchDetails');
var BatchLeader = require('../models/BatchLeader');

/* Batch value may be "2021", "2021-2022" or "Batch 2021" - show the year only. */
function batchYear(batch) {
  const match = String(batch || '').match(/\d{4}/);
  return match ? match[0] : String(batch || '').trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* All members whose batch resolves to the given year. */
async function membersOfBatch(year) {
  const docs = await MemberDetails.find({}, { name: 1, batch: 1, email: 1, admissionNumber: 1 })
    .sort({ name: 1 })
    .lean();

  return docs.filter(function (doc) {
    return batchYear(doc.batch) === year;
  });
}

/*
 * Keep BATCH_DETAILS in sync for one batch year: refresh the member id list
 * and the total member count. Creates the batch document when missing.
 */
async function syncBatchDetails(year, description) {
  const cleanYear = batchYear(year);
  if (!cleanYear) return null;

  const members = await membersOfBatch(cleanYear);
  const memberIds = members.map(function (m) { return m._id; });

  const update = {
    batchYear: cleanYear,
    members: memberIds,
    totalMembers: memberIds.length
  };

  if (typeof description === 'string' && description.trim() !== '') {
    update.description = description.trim();
  }

  return BatchDetails.findOneAndUpdate(
    { batchYear: cleanYear },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

/* GET Admin Dashboard. */
router.get('/', async function(req, res, next) {
  let totalAlumni = 0;
  let totalBatches = 0;
  let batchLeaders = 0;
  let recentMembers = [];
  let batchChart = { labels: [], values: [] };

  try {
    const batches = await MemberDetails.distinct('batch');

    totalAlumni = await MemberDetails.countDocuments();
    totalBatches = batches.filter(function (b) { return b && String(b).trim() !== ''; }).length;
    batchLeaders = await BatchLeader.countDocuments();
    recentMembers = await getRecentMembers(5);
    batchChart = await getMembersPerBatch();
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

    // Keep the batch document (BATCH_DETAILS) up to date with the new member.
    try {
      await syncBatchDetails(batch);
    } catch (syncError) {
      console.error('Batch sync after member add failed:', syncError.message);
    }

    return res.status(201).json({ success: true, message: 'Member added successfully.', member: member });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This member is already added.' });
    }
    console.error('Add member failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the member. Please try again.' });
  }
});

/* GET all batches from BATCH_DETAILS. */
router.get('/batches', async function (req, res) {
  try {
    const batches = await BatchDetails.find({}, { batchYear: 1, description: 1, totalMembers: 1 })
      .sort({ batchYear: 1 })
      .lean();

    return res.json({ success: true, batches: batches });
  } catch (error) {
    console.error('Batch list failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load batches.' });
  }
});

/* POST Create a new batch in BATCH_DETAILS. */
router.post('/batches', async function (req, res) {
  try {
    const year = batchYear(req.body.batchYear);
    const description = (req.body.description || '').trim();

    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 4-digit batch year.' });
    }

    const existing = await BatchDetails.findOne({ batchYear: year });
    if (existing) {
      return res.status(409).json({ success: false, message: 'This batch already exists.' });
    }

    const batch = await syncBatchDetails(year, description);

    return res.status(201).json({
      success: true,
      message: 'Batch created with ' + batch.totalMembers + ' member(s).',
      batch: { batchYear: batch.batchYear, totalMembers: batch.totalMembers, description: batch.description }
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This batch already exists.' });
    }
    console.error('Create batch failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not create the batch. Please try again.' });
  }
});

/* GET members + current leaders of one batch. */
router.get('/batches/:year/members', async function (req, res) {
  try {
    const year = batchYear(req.params.year);
    if (!year) {
      return res.status(400).json({ success: false, message: 'Invalid batch year.' });
    }

    const members = await membersOfBatch(year);
    const leaders = await BatchLeader.find({ batchYear: year }).sort({ createdAt: -1 }).lean();
    const leaderIds = leaders.map(function (l) { return String(l.memberId); });

    return res.json({
      success: true,
      members: members.map(function (m) {
        return {
          id: String(m._id),
          name: m.name,
          admissionNumber: m.admissionNumber,
          email: m.email,
          isLeader: leaderIds.indexOf(String(m._id)) !== -1
        };
      }),
      leaders: leaders.map(function (l) {
        return { id: String(l._id), memberId: String(l.memberId), name: l.name, email: l.email };
      })
    });
  } catch (error) {
    console.error('Batch members lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load batch members.' });
  }
});

/* POST Assign a batch leader (saved in BATCH_LEADERS). */
router.post('/leaders', async function (req, res) {
  try {
    const memberId = (req.body.memberId || '').trim();

    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      return res.status(400).json({ success: false, message: 'Please select a member.' });
    }

    const member = await MemberDetails.findById(memberId).lean();
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }

    const year = batchYear(member.batch);

    const existing = await BatchLeader.findOne({ batchYear: year, memberId: member._id });
    if (existing) {
      return res.status(409).json({ success: false, message: 'This member is already a leader of this batch.' });
    }

    const leader = await BatchLeader.create({
      batchYear: year,
      memberId: member._id,
      name: member.name,
      admissionNumber: member.admissionNumber,
      email: member.email
    });

    return res.status(201).json({
      success: true,
      message: member.name + ' is now a leader of Batch ' + year + '.',
      leader: { id: String(leader._id), memberId: String(leader.memberId), name: leader.name }
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This member is already a leader of this batch.' });
    }
    console.error('Assign leader failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not assign the leader. Please try again.' });
  }
});

/* DELETE Remove a batch leader. */
router.delete('/leaders/:id', async function (req, res) {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid leader id.' });
    }

    const removed = await BatchLeader.findByIdAndDelete(id);
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Leader not found.' });
    }

    return res.json({ success: true, message: removed.name + ' removed from leaders.' });
  } catch (error) {
    console.error('Remove leader failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not remove the leader. Please try again.' });
  }
});

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

/* Real member counts grouped by batch year, for the "Members per Batch" chart. */
async function getMembersPerBatch() {
  try {
    const docs = await MemberDetails.find({}, { batch: 1 }).lean();
    const counts = {};

    docs.forEach(function (doc) {
      const year = batchYear(doc.batch);
      if (!year) return;
      counts[year] = (counts[year] || 0) + 1;
    });

    const labels = Object.keys(counts).sort(function (a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    });

    return {
      labels: labels,
      values: labels.map(function (label) { return counts[label]; })
    };
  } catch (error) {
    console.error('Members per batch lookup failed:', error.message);
    return { labels: [], values: [] };
  }
}

module.exports = router;
