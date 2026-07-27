var express = require('express');
var router = express.Router();

var mongoose = require('mongoose');
var MemberDetails = require('../models/MemberDetails');

/* Count batch leaders only if such a collection exists in the database. */
async function getBatchLeaderCount() {
  try {
    const db = mongoose.connection && mongoose.connection.db;
    if (!db) return 0;

    const collections = await db.listCollections().toArray();
    const leaderCollection = collections.find(function (c) {
      return /batch[_\s-]*leader/i.test(c.name);
    });

    if (!leaderCollection) return 0;

    return await db.collection(leaderCollection.name).countDocuments();
  } catch (error) {
    console.error('Batch leader count failed:', error.message);
    return 0;
  }
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
    batchLeaders = await getBatchLeaderCount();
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

    return res.status(201).json({ success: true, message: 'Member added successfully.', member: member });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This member is already added.' });
    }
    console.error('Add member failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the member. Please try again.' });
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

function escapeRegex(value) {

  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
