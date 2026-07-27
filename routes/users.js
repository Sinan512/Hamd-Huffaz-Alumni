var express = require('express');
var router = express.Router();

/* GET Member Dashboard. */
router.get('/', function(req, res, next) {
  res.render('users', {
    layout: false,
    title: 'Alumni Member Portal',
    user: {
      name: 'Abdullah Al-Mansoor',
      email: 'abdullah@example.com',
      batch: '2021',
      occupation: 'Software Engineer',
      location: 'Kozhikode, India',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      status: 'Verified Member'
    },
    stats: {
      myBatch: '2021',
      upcomingEvents: '3',
      unreadNotifications: '5',
      galleryAlbums: '12'
    },
    notifications: [
      { id: 1, title: 'General Committee Election 2026', category: 'General Announcement', date: 'Today, 10:30 AM', isNew: true, icon: 'bi-broadcast text-danger' },
      { id: 2, title: 'Batch 2021 Virtual Meet & Greet', category: 'Batch Notification', date: 'Yesterday, 4:15 PM', isNew: true, icon: 'bi-people-fill text-indigo' },
      { id: 3, title: 'Career Seminar & Tech Talk Registration Open', category: 'Event Update', date: 'Jul 22, 2026', isNew: true, icon: 'bi-calendar-event text-amber' },
      { id: 4, title: 'Annual Alumni Report 2025-26 Released', category: 'Document Release', date: 'Jul 20, 2026', isNew: false, icon: 'bi-file-earmark-pdf text-emerald' },
      { id: 5, title: 'Membership Directory Information Verification', category: 'Profile Update', date: 'Jul 18, 2026', isNew: false, icon: 'bi-shield-check text-purple' }
    ],
    upcomingEvents: [
      {
        id: 1,
        title: 'Annual Alumni Meet 2026',
        date: '15 August 2026',
        time: '10:00 AM - 4:00 PM',
        location: 'Main Auditorium, Campus Ground',
        category: 'Reunion',
        image: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=600&auto=format&fit=crop&q=80'
      },
      {
        id: 2,
        title: 'Career Guidance & Mentorship Session',
        date: '02 September 2026',
        time: '6:30 PM IST',
        location: 'Online via Zoom Meeting',
        category: 'Seminar',
        image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=600&auto=format&fit=crop&q=80'
      },
      {
        id: 3,
        title: 'Global Tech & Entrepreneurship Summit',
        date: '20 September 2026',
        time: '9:00 AM - 5:00 PM',
        location: 'Grand Convention Center',
        category: 'Conference',
        image: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=600&auto=format&fit=crop&q=80'
      }
    ],
    galleryAlbums: [
      { id: 1, title: 'Convocation 2021', photoCount: 48, cover: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=500&auto=format&fit=crop&q=80' },
      { id: 2, title: 'Reunion Meet 2025', photoCount: 32, cover: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=500&auto=format&fit=crop&q=80' },
      { id: 3, title: 'Sports Gala Day', photoCount: 64, cover: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=500&auto=format&fit=crop&q=80' },
      { id: 4, title: 'Cultural Festival', photoCount: 29, cover: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop&q=80' }
    ],
    downloads: [
      { name: 'Annual Report 2025-2026.pdf', size: '4.2 MB', date: 'Jul 20, 2026', type: 'PDF Document' },
      { name: 'Alumni Quarterly Newsletter Vol.14.pdf', size: '2.8 MB', date: 'Jul 15, 2026', type: 'PDF Document' },
      { name: 'Membership Code of Conduct & Guide.pdf', size: '1.5 MB', date: 'Jun 30, 2026', type: 'PDF Document' },
      { name: 'Verified Alumni Directory 2026.pdf', size: '8.1 MB', date: 'Jun 10, 2026', type: 'PDF Document' }
    ]
  });
});

module.exports = router;
