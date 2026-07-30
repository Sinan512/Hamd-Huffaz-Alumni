var express = require('express');
var router = express.Router();
var multer  = require('multer');

var mongoose    = require('mongoose');
var MemberDetails = require('../models/MemberDetails');
var BatchDetails  = require('../models/BatchDetails');
var BatchLeader   = require('../models/BatchLeader');
var EventDetails  = require('../models/EventDetails');
var Gallery       = require('../models/Gallery');
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

/* ================================================================== */
/* HELPER: fetch ALL events (no date filter, no limit)                */
/* ================================================================== */
async function getAllEvents() {
  try {
    var docs = await EventDetails
      .find({}, { title: 1, date: 1, category: 1, location: 1,
                  description: 1, 'image.contentType': 1 })
      .sort({ date: -1 })
      .lean();

    var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN',
                  'JUL','AUG','SEP','OCT','NOV','DEC'];

    return docs.map(function (doc) {
      var d   = new Date(doc.date);
      var mon = MONTHS[d.getUTCMonth()] || '';
      var day = String(d.getUTCDate()).padStart(2, '0');
      return {
        id:          String(doc._id),
        title:       doc.title       || '',
        month:       mon,
        day:         day,
        location:    doc.location    || '',
        category:    doc.category    || 'General',
        description: doc.description || '',
        badgeColor:  categoryBadge(doc.category),
        hasImage:    !!(doc.image && doc.image.contentType)
      };
    });
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
  var galleryImages  = [];

  try {
    totalAlumni     = await MemberDetails.countDocuments();
    batchLeaders    = await getBatchLeaderCount();
    allMembers      = await getAllMembers();
    allBatchLeaders = await getAllBatchLeaders();
    batchChart      = await getMembersPerBatch();
    totalBatches   = batchChart.batchCount;
    upcomingEvents = await getAllEvents();
    galleryImages  = await getGalleryImages();
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
    galleryImages: galleryImages
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
    var admissionNumber = (req.body.admissionNumber || '').trim();
    var password = (req.body.password || '').trim();

    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }

    var leader = await BatchLeader.findByIdAndUpdate(
      req.params.id,
      { $set: { admissionNumber: admissionNumber, password: password } },
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
/* HELPER: default password for a member  ->  <admissionNumber>@123     */
/* ================================================================== */
function generateMemberPassword(admissionNumber) {
  return String(admissionNumber || '').trim() + '@123';
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
    var memberIds = docs.map(function (d) { return d.memberId; }).filter(Boolean);
    var members = await MemberDetails.find({ _id: { $in: memberIds } }, { admissionNumber: 1 }).lean();
    var admissionById = {};
    members.forEach(function (m) { admissionById[String(m._id)] = m.admissionNumber || ''; });
    return docs.map(function (doc) {
       return {
    id:         String(doc._id),
    memberName: doc.memberName || '',
    year:       batchYear(doc.year),
    assignedAt: formatJoinedDate(doc.assignedAt),
    admissionNumber: doc.admissionNumber || admissionById[String(doc.memberId)] || '',
    password:   doc.password || ''
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

module.exports = router;
