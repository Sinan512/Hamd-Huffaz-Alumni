var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var mongoose = require('mongoose');

var BatchLeader = require('../models/BatchLeader');
var MemberDetails = require('../models/MemberDetails');
var LeaderTask = require('../models/LeaderTask');
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
