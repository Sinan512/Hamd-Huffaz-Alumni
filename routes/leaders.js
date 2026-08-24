var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var mongoose = require('mongoose');

var BatchLeader = require('../models/BatchLeader');
var MemberDetails = require('../models/MemberDetails');
var LeaderTask = require('../models/LeaderTask');
var PaymentStatus = require('../models/PaymentStatus');
var connectDB = require('../config/db');

/* Leader sessions live in the "SESSIONS" collection (see app.js) and are
   valid for 7 days. Every request refreshes the window (rolling sessions). */
var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

/* Guard for leader-only endpoints. */
function requireLeader(req, res, next) {
  if (req.session && req.session.leaderId) {
    if (req.session.cookie) req.session.cookie.maxAge = SEVEN_DAYS_MS;
    return next();
  }
  return res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
}

/* Members of a batch, shaped for the leader dashboard.
   Phone + WhatsApp are included so the row actions work. Passwords never leave here. */
async function loadBatchMembers(year) {
  var members = await MemberDetails.find({
    batch: new RegExp('^' + escapeRegex(year) + '$', 'i')
  })
    .sort({ name: 1 })
    .lean();

  return members.map(function (m) {
    return {
      admissionNumber: m.admissionNumber || '',
      name: m.name || '',
      place: m.place || '',
      batch: m.batch || '',
      email: m.email || '',
      phone: m.phone || '',
      whatsapp: m.whatsapp || ''
    };
  });
}

/* GET /leaders – leader login + dashboard page */
router.get('/', function (req, res) {
  res.render('leaders', {
    layout: false,
    title: 'Batch Leader Portal'
  });
});

/* GET /leaders/session – restore an existing 7 day session on page load */
router.get('/session', async function (req, res) {
  if (!req.session || !req.session.leaderId) {
    return res.json({ success: false, authenticated: false });
  }

  try {
    await connectDB();
    var leader = await BatchLeader.findById(req.session.leaderId).lean();
    if (!leader) {
      req.session.destroy(function () {});
      return res.json({ success: false, authenticated: false });
    }

    /* refresh the 7 day window */
    req.session.cookie.maxAge = SEVEN_DAYS_MS;

    var members = await loadBatchMembers(leader.year);

    return res.json({
      success: true,
      authenticated: true,
      leader: {
        name: 'Batch ' + leader.year + ' Leader',
        year: leader.year
      },
      members: members
    });
  } catch (error) {
    console.error('Leader session lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not restore your session.' });
  }
});

/* POST /leaders/login – validate batch year + password */
router.post('/login', async function (req, res) {
  try {
    await connectDB();

    var year = (req.body.year || '').trim();
    var password = (req.body.password || '').trim();

    var invalid = {
      success: false,
      message: 'Invalid batch year or password.'
    };

    if (!year || !password) {
      return res.status(400).json({
        success: false,
        message: 'Batch year and password are required.'
      });
    }

    var leader = await BatchLeader.findOne({
      year: new RegExp('^' + escapeRegex(year) + '$', 'i')
    });

    if (!leader) {
      return res.status(401).json(invalid);
    }

    var storedHash = (leader.passwordHash || '').trim();
    var storedSalt = (leader.salt || '').trim();
    var legacyPassword = (leader.password || '').trim();

    if (!storedHash && !legacyPassword) {
      return res.status(401).json({
        success: false,
        message: 'Login password is not set up for this batch yet. Please contact the admin.'
      });
    }

    var passwordOk = false;
    if (storedHash && storedSalt) {
      passwordOk = safeEqual(sha256(storedSalt, password), storedHash);
    } else if (legacyPassword) {
      /* Old record saved before hashing existed – verify, then upgrade. */
      passwordOk = safeEqual(legacyPassword, password);
      if (passwordOk) {
        var newSalt = makeSalt();
        leader.salt = newSalt;
        leader.passwordHash = sha256(newSalt, password);
        leader.password = '';
        leader.passwordUpdatedAt = new Date();
        try {
          await leader.save();
        } catch (upgradeError) {
          console.error('Leader password upgrade failed:', upgradeError.message);
        }
      }
    }

    if (!passwordOk) {
      return res.status(401).json(invalid);
    }

    var members = await loadBatchMembers(leader.year);

    var payload = {
      success: true,
      authenticated: true,
      leader: {
        name: 'Batch ' + leader.year + ' Leader',
        year: leader.year
      },
      members: members
    };

    /* Fresh session id on login, valid for 7 days. */
    return req.session.regenerate(function (regenError) {
      if (regenError) {
        console.error('Leader session regenerate failed:', regenError.message);
        return res.status(500).json({ success: false, message: 'Could not start your session. Please try again.' });
      }

      req.session.leaderId = String(leader._id);
      req.session.leaderYear = leader.year;
      req.session.leaderName = 'Batch ' + leader.year + ' Leader';
      req.session.cookie.maxAge = SEVEN_DAYS_MS;

      req.session.save(function (saveError) {
        if (saveError) {
          console.error('Leader session save failed:', saveError.message);
          return res.status(500).json({ success: false, message: 'Could not start your session. Please try again.' });
        }
        return res.json(payload);
      });
    });
  } catch (error) {
    console.error('Leader login failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not sign you in. Please try again.' });
  }
});

/* GET /leaders/members – batch members for the signed in leader */
router.get('/members', requireLeader, async function (req, res) {
  try {
    await connectDB();
    var members = await loadBatchMembers(req.session.leaderYear);
    return res.json({ success: true, members: members });
  } catch (error) {
    console.error('Leader members lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load your batch members.' });
  }
});

/* GET /leaders/members/:admissionNumber – full record of ONE member of this
   leader's batch. The password field is never selected or returned. */
router.get('/members/:admissionNumber', requireLeader, async function (req, res) {
  try {
    await connectDB();

    var adm = String(req.params.admissionNumber || '').trim();
    if (!adm) {
      return res.status(400).json({ success: false, message: 'Admission number is required.' });
    }

    var member = await MemberDetails.findOne({
      admissionNumber: new RegExp('^' + escapeRegex(adm) + '$', 'i'),
      batch: new RegExp('^' + escapeRegex(req.session.leaderYear) + '$', 'i')
    })
      .select('-password -__v')
      .lean();

    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found in your batch.' });
    }

    /* Belt and braces – strip anything sensitive before sending. */
    delete member.password;
    delete member.registeredEvents;

    return res.json({ success: true, member: member });
  } catch (error) {
    console.error('Leader member detail lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load this member.' });
  }
});

/* ==================== TASKS (LEADER_TASKS collection) ==================== */

function shapeTask(task) {
  return {
    _id: String(task._id),
    title: task.title || '',
    dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
    members: (task.members || []).map(function (m) {
      return { admissionNumber: m.admissionNumber || '', name: m.name || '' };
    }),
    createdAt: task.createdAt || null
  };
}

/* Keep only the admission numbers that really belong to this leader's batch. */
async function resolveBatchMembers(year, admissionNumbers) {
  var list = Array.isArray(admissionNumbers) ? admissionNumbers : [];
  var wanted = {};
  list.forEach(function (a) {
    var key = String(a || '').trim().toLowerCase();
    if (key) wanted[key] = true;
  });

  var members = await loadBatchMembers(year);
  return members
    .filter(function (m) {
      return wanted[String(m.admissionNumber).trim().toLowerCase()] === true;
    })
    .map(function (m) {
      return { admissionNumber: m.admissionNumber, name: m.name };
    });
}

/* GET /leaders/tasks – all tasks of this leader's batch */
router.get('/tasks', requireLeader, async function (req, res) {
  try {
    await connectDB();
    var tasks = await LeaderTask.find({
      batchYear: new RegExp('^' + escapeRegex(req.session.leaderYear) + '$', 'i')
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, tasks: tasks.map(shapeTask) });
  } catch (error) {
    console.error('Leader tasks lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load your tasks.' });
  }
});

/* POST /leaders/tasks – create a task with selected batch members */
router.post('/tasks', requireLeader, async function (req, res) {
  try {
    await connectDB();

    var title = String(req.body.title || '').trim();
    var dueDateRaw = String(req.body.dueDate || '').trim();

    if (!title) {
      return res.status(400).json({ success: false, message: 'Task title is required.' });
    }
    if (title.length > 160) {
      return res.status(400).json({ success: false, message: 'Task title is too long (max 160 characters).' });
    }

    var dueDate = null;
    if (dueDateRaw) {
      dueDate = new Date(dueDateRaw);
      if (isNaN(dueDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Please pick a valid due date.' });
      }
    }

    var members = await resolveBatchMembers(req.session.leaderYear, req.body.members);

    var task = await LeaderTask.create({
      title: title,
      dueDate: dueDate,
      leaderId: req.session.leaderId,
      batchYear: req.session.leaderYear,
      members: members
    });

    return res.json({ success: true, task: shapeTask(task.toObject()) });
  } catch (error) {
    console.error('Leader task create failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not create the task.' });
  }
});

/* PUT /leaders/tasks/:id/members – replace the assigned member list */
router.put('/tasks/:id/members', requireLeader, async function (req, res) {
  try {
    await connectDB();

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id.' });
    }

    var members = await resolveBatchMembers(req.session.leaderYear, req.body.members);

    var task = await LeaderTask.findOneAndUpdate(
      {
        _id: req.params.id,
        batchYear: new RegExp('^' + escapeRegex(req.session.leaderYear) + '$', 'i')
      },
      { $set: { members: members } },
      { new: true }
    ).lean();

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    return res.json({ success: true, task: shapeTask(task) });
  } catch (error) {
    console.error('Leader task member update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update the task members.' });
  }
});

/* PUT /leaders/tasks/:id – update title / due date */
router.put('/tasks/:id', requireLeader, async function (req, res) {
  try {
    await connectDB();

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id.' });
    }

    var update = {};
    if (typeof req.body.title !== 'undefined') {
      var title = String(req.body.title || '').trim();
      if (!title) {
        return res.status(400).json({ success: false, message: 'Task title is required.' });
      }
      update.title = title;
    }
    if (typeof req.body.dueDate !== 'undefined') {
      var raw = String(req.body.dueDate || '').trim();
      if (!raw) {
        update.dueDate = null;
      } else {
        var d = new Date(raw);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ success: false, message: 'Please pick a valid due date.' });
        }
        update.dueDate = d;
      }
    }

    var task = await LeaderTask.findOneAndUpdate(
      {
        _id: req.params.id,
        batchYear: new RegExp('^' + escapeRegex(req.session.leaderYear) + '$', 'i')
      },
      { $set: update },
      { new: true }
    ).lean();

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    return res.json({ success: true, task: shapeTask(task) });
  } catch (error) {
    console.error('Leader task update failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update the task.' });
  }
});

/* DELETE /leaders/tasks/:id */
router.delete('/tasks/:id', requireLeader, async function (req, res) {
  try {
    await connectDB();

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id.' });
    }

    var deleted = await LeaderTask.findOneAndDelete({
      _id: req.params.id,
      batchYear: new RegExp('^' + escapeRegex(req.session.leaderYear) + '$', 'i')
    }).lean();

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Leader task delete failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not delete the task.' });
  }
});

/* ==================== CONTRIBUTIONS (PAYMENT_STATUS collection) ==================== */

var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function getLeaderContributionsData(leaderYear) {
  var members = await MemberDetails.find({
    batch: new RegExp('^' + escapeRegex(leaderYear) + '$', 'i')
  }).lean();

  var memberIds = members.map(function (m) { return m._id; });
  var memberMap = {};
  members.forEach(function (m) { memberMap[String(m._id)] = m; });

  var paymentDocs = await PaymentStatus.find({ memberId: { $in: memberIds } }).lean();

  var submittedList = [];
  var paidMonthSet = {};

  paymentDocs.forEach(function (doc) {
    var memberIdStr = String(doc.memberId);
    var member = memberMap[memberIdStr] || { name: 'Unknown Member', admissionNumber: '', batch: leaderYear };

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
          batch: member.batch || leaderYear,
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
          batch: member.batch || leaderYear,
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
}

/* GET /leaders/contributions – JSON list of batch submitted and unpaid contributions */
router.get('/contributions', requireLeader, async function (req, res) {
  try {
    await connectDB();
    var data = await getLeaderContributionsData(req.session.leaderYear);
    return res.json({ success: true, submitted: data.submitted, unpaid: data.unpaid, counts: data.counts });
  } catch (error) {
    console.error('Leader list contributions failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load contributions data.' });
  }
});

/* GET /leaders/contributions/image/:memberId/:paymentId – serve payment screenshot image */
router.get('/contributions/image/:memberId/:paymentId', requireLeader, async function (req, res) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId) || !mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      return res.status(400).end();
    }

    var member = await MemberDetails.findOne({
      _id: req.params.memberId,
      batch: new RegExp('^' + escapeRegex(req.session.leaderYear) + '$', 'i')
    }).lean();

    if (!member) {
      return res.status(403).end();
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
    console.error('Serve leader contribution screenshot failed:', error.message);
    return res.status(500).end();
  }
});

/* POST /leaders/contributions/:memberId/:paymentId/approve – approve payment */
router.post('/contributions/:memberId/:paymentId/approve', requireLeader, async function (req, res) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId) || !mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      return res.status(400).json({ success: false, message: 'Invalid member or payment id.' });
    }

    var member = await MemberDetails.findOne({
      _id: req.params.memberId,
      batch: new RegExp('^' + escapeRegex(req.session.leaderYear) + '$', 'i')
    }).lean();

    if (!member) {
      return res.status(403).json({ success: false, message: 'Member does not belong to your batch.' });
    }

    var leaderName = req.session.leaderName || ('Batch ' + req.session.leaderYear + ' Leader');

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
    item.approvedBy = leaderName;
    item.approvedAt = new Date();
    item.rejectionReason = '';

    await doc.save();

    return res.json({ success: true, message: 'Payment approved successfully.' });
  } catch (error) {
    console.error('Leader approve payment failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not approve payment.' });
  }
});

/* POST /leaders/contributions/:memberId/:paymentId/reject – reject payment */
router.post('/contributions/:memberId/:paymentId/reject', requireLeader, async function (req, res) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId) || !mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      return res.status(400).json({ success: false, message: 'Invalid member or payment id.' });
    }

    var member = await MemberDetails.findOne({
      _id: req.params.memberId,
      batch: new RegExp('^' + escapeRegex(req.session.leaderYear) + '$', 'i')
    }).lean();

    if (!member) {
      return res.status(403).json({ success: false, message: 'Member does not belong to your batch.' });
    }

    var option = (req.body.reasonOption || '').trim();
    var customReason = (req.body.customReason || '').trim();
    var finalReason = option === 'other' ? customReason : option;
    if (!finalReason) finalReason = 'Rejected by Leader';

    var leaderName = req.session.leaderName || ('Batch ' + req.session.leaderYear + ' Leader');

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
    item.approvedBy = leaderName;
    item.approvedAt = new Date();

    await doc.save();

    return res.json({ success: true, message: 'Payment rejected successfully.' });
  } catch (error) {
    console.error('Leader reject payment failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not reject payment.' });
  }
});

/* PUT /leaders/contributions/:memberId/:paymentId – edit payment data */
router.put('/contributions/:memberId/:paymentId', requireLeader, async function (req, res) {
  try {
    await connectDB();
    if (!mongoose.Types.ObjectId.isValid(req.params.memberId) || !mongoose.Types.ObjectId.isValid(req.params.paymentId)) {
      return res.status(400).json({ success: false, message: 'Invalid member or payment id.' });
    }

    var member = await MemberDetails.findOne({
      _id: req.params.memberId,
      batch: new RegExp('^' + escapeRegex(req.session.leaderYear) + '$', 'i')
    }).lean();

    if (!member) {
      return res.status(403).json({ success: false, message: 'Member does not belong to your batch.' });
    }

    var doc = await PaymentStatus.findOne({ memberId: req.params.memberId });
    if (!doc || !doc.membersPayments) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    var targetId = String(req.params.paymentId);
    var item = doc.membersPayments.id(targetId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Payment submission item not found.' });
    }

    if (typeof req.body.amount !== 'undefined') {
      var amt = Number(req.body.amount);
      if (!isNaN(amt) && amt >= 0) item.amount = amt;
    }
    if (typeof req.body.status !== 'undefined') {
      var st = String(req.body.status).trim();
      if (['Pending', 'Approved', 'Rejected'].indexOf(st) !== -1) {
        item.status = st;
      }
    }
    if (typeof req.body.rejectionReason !== 'undefined') {
      item.rejectionReason = String(req.body.rejectionReason).trim();
    }
    if (typeof req.body.month !== 'undefined') {
      var m = Number(req.body.month);
      if (!isNaN(m) && m >= 1 && m <= 12) item.month = m;
    }
    if (typeof req.body.year !== 'undefined') {
      var y = Number(req.body.year);
      if (!isNaN(y) && y >= 2000 && y <= 2100) item.year = y;
    }

    item.approvedBy = req.session.leaderName || ('Batch ' + req.session.leaderYear + ' Leader');
    await doc.save();

    return res.json({ success: true, message: 'Payment updated successfully.' });
  } catch (error) {
    console.error('Leader update payment failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not update payment.' });
  }
});

/* POST /leaders/logout – destroy the session document + clear the cookie */
router.post('/logout', function (req, res) {
  if (!req.session) {
    return res.json({ success: true });
  }
  req.session.destroy(function (error) {
    if (error) {
      console.error('Leader logout failed:', error.message);
      return res.status(500).json({ success: false, message: 'Could not sign you out. Please try again.' });
    }
    res.clearCookie('hamd.sid', { path: '/' });
    return res.json({ success: true });
  });
});

module.exports = router;
