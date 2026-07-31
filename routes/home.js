var express = require('express');
var router  = express.Router();

var MemberDetails = require('../models/MemberDetails');
var BatchDetails  = require('../models/BatchDetails');
var EventDetails  = require('../models/EventDetails');
var Gallery       = require('../models/Gallery');

/* ==================================================================
   DUMMY DATA
   ------------------------------------------------------------------
   Sections that do not have a MongoDB collection yet are served from
   here. When a collection is added later, replace the corresponding
   constant with a database query inside buildHomeData().
================================================================== */

var TIMELINE = [
  { year: '1982', title: 'Founding of Parappalli Markaz',      desc: 'Established by visionary scholars to nurture Huffaz and Islamic scholars in northern Kerala.' },
  { year: '2005', title: 'HAMD Alumni Association Formed',     desc: 'Graduates came together to formalise a community for mutual support, Da\'wa, and charitable work.' },
  { year: '2015', title: 'International Expansion',            desc: 'HAMD chapters established in Gulf countries, connecting alumni working abroad.' },
  { year: '2024', title: 'HAMD Digital Portal Launched',       desc: 'Centralised alumni management system to digitise records, events, and community engagement.' }
];

var ABOUT_CARDS = [
  { icon: 'bi-eye',        title: 'Our Vision',      text: 'To be the foremost alumni network of Islamic scholarship in Kerala — a global community united by faith, knowledge, and service to the Ummah.' },
  { icon: 'bi-bullseye',   title: 'Our Mission',     text: 'To strengthen the bonds between graduates, facilitate Da\'wa activities, support charitable initiatives, and honour the teachings of Parappalli Markaz.' },
  { icon: 'bi-list-check', title: 'Core Objectives', text: 'Alumni registration, event organisation, scholarship grants, community welfare, and digital connection for all graduates worldwide.' },
  { icon: 'bi-people',     title: 'Community Values',text: 'Brotherhood, accountability, lifelong learning, compassion for the less fortunate, and steadfast adherence to Islamic principles.' }
];

var COMMITTEE = [
  { initials: 'AM', role: 'President',         name: 'Abdur Rahman Mankada',  place: 'Malappuram, Kerala' },
  { initials: 'MN', role: 'Vice President',    name: 'Muhammad Naseef',       place: 'Kozhikode, Kerala' },
  { initials: 'SI', role: 'General Secretary', name: 'Sirajuddeen Irfani',    place: 'Parappalli, Kerala' },
  { initials: 'FA', role: 'Treasurer',         name: 'Faisal Arafath',        place: 'Thrissur, Kerala' },
  { initials: 'HK', role: 'Executive Member',  name: 'Hamza Kareem',          place: 'Sharjah, UAE' },
  { initials: 'ZP', role: 'Executive Member',  name: 'Zaid Puthanpurakkal',   place: 'Kannur, Kerala' }
];

var NEWS = [
  {
    image: 'https://picsum.photos/seed/news1/600/300',
    category: 'Scholarship',
    title: 'HAMD Launches ₹50 Lakh Scholarship Fund for Deserving Students',
    desc: 'The Executive Committee approved a major scholarship initiative to support academically excellent but financially challenged students from alumni families.',
    date: 'July 10, 2025'
  },
  {
    image: 'https://picsum.photos/seed/news2/600/300',
    category: 'Da\'wa',
    title: 'Summer Da\'wa Camp Draws 800 Participants Across Three Districts',
    desc: 'HAMD volunteers organised a three-week summer camp covering Quran, Islamic studies, and Arabic language for youth in Malappuram, Kozhikode, and Palakkad.',
    date: 'June 28, 2025'
  },
  {
    image: 'https://picsum.photos/seed/news3/600/300',
    category: 'Technology',
    title: 'HAMD Digital Portal Goes Live — Connecting Alumni Worldwide',
    desc: 'The newly launched HAMD Alumni Portal enables graduates to register, access resources, stay updated on events, and connect with the global HAMD community.',
    date: 'June 5, 2025'
  }
];

var TESTIMONIALS = [
  { initials: 'AM', name: 'Ahmad Musthafa',  batch: 'Batch 2010 · Dubai, UAE',   text: 'HAMD has been a source of barakah in my life. Reconnecting with batch mates and contributing to Da\'wa activities together has kept the spirit of the Markaz alive wherever I go.' },
  { initials: 'SN', name: 'Sulaiman Noushad',batch: 'Batch 2014 · Kozhikode',    text: 'The scholarship I received through HAMD helped me pursue further studies in Islamic sciences. I am forever grateful to this brotherhood and the committee\'s dedication.' },
  { initials: 'FH', name: 'Farhan Hamza',    batch: 'Batch 2007 · Riyadh, KSA',  text: 'The annual gatherings at Parappalli Markaz are something I travel thousands of miles for. The bond we share as HAMD alumni is unlike anything else — it is a brotherhood for life.' },
  { initials: 'RI', name: 'Riyad Ibrahim',   batch: 'Batch 2016 · Kannur',       text: 'Serving as a HAMD volunteer opened doors I never imagined. The training, the network, and the sincerity of everyone involved truly reflects the values we learned at the Markaz.' },
  { initials: 'ZA', name: 'Zainul Abidin',   batch: 'Batch 2019 · Muscat, Oman', text: 'The digital portal has made staying connected so much easier. I can access event details, contribute to fundraisers, and keep up with news from all over the world.' },
  { initials: 'NA', name: 'Nabil Ashraf',    batch: 'Batch 2012 · Malappuram',   text: 'HAMD\'s Da\'wa camps in our district brought hundreds of young people closer to the Quran. Proud to be part of an alumni body that gives back so selflessly to society.' }
];

var DONATE = {
  features: [
    'Scholarship funding',
    'Da\'wa programmes',
    'Community welfare',
    'Educational resources',
    'Alumni events',
    'Emergency aid'
  ],
  bank: {
    account: 'HAMD Alumni Trust',
    number:  'XXXX XXXX XXXX',
    ifsc:    'HDFC0001234'
  },
  whatsapp: '+91 94000 12345'
};

var CONTACT = {
  address:  'Parappalli Markaz, Parappalli P.O,<br/>Malappuram District, Kerala – 676 552',
  email:    'info@hamd-alumni.org',
  phone:    '+91 94000 12345',
  whatsapp: '+91 94000 12345',
  mapLabel: 'Parappalli Markaz, Malappuram',
  officeHours: 'Saturday – Thursday: 9 AM – 6 PM<br/>Friday: Closed'
};

/* Stats that have no collection yet — the first two are replaced with
   live counts in buildHomeData(). */
var EXTRA_STATS = [
  { icon: 'bi-megaphone',       target: 250, suffix: '+', label: 'Da\'wa Activities' },
  { icon: 'bi-globe2',          target: 18,  suffix: '+', label: 'Countries' },
  { icon: 'bi-hand-thumbs-up',  target: 300, suffix: '+', label: 'Volunteers' }
];

/* ==================================================================
   REAL DATA HELPERS
================================================================== */

var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

async function getEvents() {
  try {
    var docs = await EventDetails
      .find({}, { title: 1, date: 1, category: 1, location: 1, 'image.contentType': 1 })
      .sort({ date: 1 })
      .limit(12)
      .lean();

    return docs.map(function (doc) {
      var d = new Date(doc.date);
      return {
        id:       String(doc._id),
        title:    doc.title    || '',
        category: doc.category || 'General',
        location: doc.location || '',
        day:      String(d.getUTCDate()).padStart(2, '0'),
        month:    MONTHS[d.getUTCMonth()] || '',
        imageUrl: (doc.image && doc.image.contentType)
          ? '/events/' + String(doc._id) + '/image'
          : 'https://picsum.photos/seed/ev' + String(doc._id).slice(-4) + '/640/360'
      };
    });
  } catch (err) {
    console.error('Home: events fetch failed —', err.message);
    return [];
  }
}

async function getGallery() {
  try {
    var docs = await Gallery
      .find({}, { description: 1, 'image.contentType': 1 })
      .sort({ createdAt: -1 })
      .limit(12)
      .lean();

    return docs
      .filter(function (doc) { return doc.image && doc.image.contentType; })
      .map(function (doc, i) {
        return {
          id:          String(doc._id),
          description: doc.description || ('Gallery image ' + (i + 1)),
          url:         '/gallery/' + String(doc._id) + '/image'
        };
      });
  } catch (err) {
    console.error('Home: gallery fetch failed —', err.message);
    return [];
  }
}

async function getStats() {
  var alumni  = 0;
  var batches = 0;

  try { alumni = await MemberDetails.countDocuments({}); }
  catch (err) { console.error('Home: member count failed —', err.message); }

  try { batches = await BatchDetails.countDocuments({}); }
  catch (err) { console.error('Home: batch count failed —', err.message); }

  return [
    { icon: 'bi-mortarboard', target: alumni,  suffix: '', label: 'Registered Alumni' },
    { icon: 'bi-calendar3',   target: batches, suffix: '', label: 'Batches' }
  ].concat(EXTRA_STATS);
}

async function buildHomeData() {
  var results = await Promise.all([getStats(), getEvents(), getGallery()]);

  return {
    /* real data (MongoDB) */
    stats:   results[0],
    events:  results[1],
    gallery: results[2],

    /* dummy data (this file) */
    timeline:     TIMELINE,
    aboutCards:   ABOUT_CARDS,
    committee:    COMMITTEE,
    news:         NEWS,
    testimonials: TESTIMONIALS,
    donate:       DONATE,
    contact:      CONTACT
  };
}

/* ==================================================================
   ROUTES
================================================================== */

/* Home page */
router.get('/', async function (req, res) {
  var data;
  try {
    data = await buildHomeData();
  } catch (err) {
    console.error('Home: render fell back to empty data —', err.message);
    data = {
      stats: [], events: [], gallery: [],
      timeline: TIMELINE, aboutCards: ABOUT_CARDS, committee: COMMITTEE,
      news: NEWS, testimonials: TESTIMONIALS, donate: DONATE, contact: CONTACT
    };
  }
  data.layout = false;
  res.render('home', data);
});

/* Public gallery image — so the home page never depends on /admin URLs */
router.get('/gallery/:id/image', async function (req, res) {
  try {
    var doc = await Gallery.findById(req.params.id).select('image').lean();
    if (!doc || !doc.image || !doc.image.data) return res.sendStatus(404);
    res.set('Content-Type', doc.image.contentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(doc.image.data);
  } catch (err) {
    return res.sendStatus(404);
  }
});

/* Public event image */
router.get('/events/:id/image', async function (req, res) {
  try {
    var doc = await EventDetails.findById(req.params.id).select('image').lean();
    if (!doc || !doc.image || !doc.image.data) return res.sendStatus(404);
    res.set('Content-Type', doc.image.contentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(doc.image.data);
  } catch (err) {
    return res.sendStatus(404);
  }
});

module.exports = router;
module.exports.buildHomeData = buildHomeData;
module.exports.dummy = {
  TIMELINE: TIMELINE,
  ABOUT_CARDS: ABOUT_CARDS,
  COMMITTEE: COMMITTEE,
  NEWS: NEWS,
  TESTIMONIALS: TESTIMONIALS,
  DONATE: DONATE,
  CONTACT: CONTACT,
  EXTRA_STATS: EXTRA_STATS
};
