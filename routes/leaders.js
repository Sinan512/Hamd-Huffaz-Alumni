var express = require('express');
var router = express.Router();
var crypto = require('crypto');

var BatchLeader = require('../models/BatchLeader');
var MemberDetails = require('../models/MemberDetails');
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

/* Members of a batch, shaped for the leader dashboard. */
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
      email: m.email || ''
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
        name: leader.memberName || 'Batch Leader',
        year: leader.year,
        admissionNumber: (leader.admissionNumber || '').trim()
      },
      members: members
    });
  } catch (error) {
    console.error('Leader session lookup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not restore your session.' });
  }
});

/* POST /leaders/login – validate batch year + admission number + password */
router.post('/login', async function (req, res) {
  try {
    await connectDB();

    var year = (req.body.year || '').trim();
    var admissionNumber = (req.body.admissionNumber || '').trim();
    var password = (req.body.password || '').trim();

    var invalid = {
      success: false,
      message: 'Invalid batch year, admission number or password.'
    };

    if (!year || !admissionNumber || !password) {
      return res.status(400).json({
        success: false,
        message: 'Batch year, admission number and password are all required.'
      });
    }

    var leader = await BatchLeader.findOne({
      year: new RegExp('^' + escapeRegex(year) + '$', 'i')
    });

    if (!leader) {
      return res.status(401).json(invalid);
    }

    var storedAdmission = (leader.admissionNumber || '').trim();
    var storedHash = (leader.passwordHash || '').trim();
    var storedSalt = (leader.salt || '').trim();
    var legacyPassword = (leader.password || '').trim();

    if (!storedAdmission || (!storedHash && !legacyPassword)) {
      return res.status(401).json({
        success: false,
        message: 'Login is not set up for this batch yet. Please contact the admin.'
      });
    }

    if (storedAdmission.toLowerCase() !== admissionNumber.toLowerCase()) {
      return res.status(401).json(invalid);
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
        name: leader.memberName || 'Batch Leader',
        year: leader.year,
        admissionNumber: storedAdmission
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
      req.session.leaderName = leader.memberName || 'Batch Leader';
      req.session.leaderAdmission = storedAdmission;
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
