var express = require('express');
var router = express.Router();

var MemberDetails = require('../models/MemberDetails');

/* GET Admin Dashboard. */
router.get('/', function(req, res, next) {
  res.render('admin', {
    layout: false,
    title: 'Alumni Admin Dashboard',
    adminName: 'Super Admin',
    stats: {
      totalAlumni: '1,245',
      alumniGrowth: '+12.4%',
      totalBatches: '6',
      batchLeaders: '6',
      upcomingEvents: '3',
      announcements: '5',
      newRegistrations: '12',
      regGrowth: '+8.2%',
      pendingLeaders: '1'
    },
    recentMembers: [
      { id: 1, name: 'Abdullah Al-Mansoor', email: 'abdullah@example.com', batch: '2021', status: 'Active', statusLower: 'active', joinedDate: '12 Jul 2026', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80' },
      { id: 2, name: 'Muhammed Rizwan', email: 'rizwan@example.com', batch: '2022', status: 'Verified', statusLower: 'verified', joinedDate: '15 Jul 2026', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80' },
      { id: 3, name: 'Faris Hameed', email: 'faris@example.com', batch: '2023', status: 'Pending', statusLower: 'pending', joinedDate: '17 Jul 2026', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80' },
      { id: 4, name: 'Zaid Ibn Shafi', email: 'zaid@example.com', batch: '2024', status: 'Active', statusLower: 'active', joinedDate: '20 Jul 2026', avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=100&auto=format&fit=crop&q=80' },
      { id: 5, name: 'Omar Khalid', email: 'omar@example.com', batch: '2025', status: 'Active', statusLower: 'active', joinedDate: '22 Jul 2026', avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=100&auto=format&fit=crop&q=80' }
    ],
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
