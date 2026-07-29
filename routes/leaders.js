var express = require('express');
var router = express.Router();

var BatchLeader = require('../models/BatchLeader');
var MemberDetails = require('../models/MemberDetails');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* GET /leaders – leader login + dashboard page */
router.get('/', function (req, res) {
  res.render('leaders', {
    layout: false,
    title: 'Batch Leader Portal'
  });
});

/* POST /leaders/login – validate batch year + admission number + password */
router.post('/login', async function (req, res) {
  try {
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
    }).lean();

    if (!leader) {
      return res.status(401).json(invalid);
    }

    var storedAdmission = (leader.admissionNumber || '').trim();
    var storedPassword = (leader.password || '').trim();

    if (!storedAdmission || !storedPassword) {
      return res.status(401).json({
        success: false,
        message: 'Login is not set up for this batch yet. Please contact the admin.'
      });
    }

    if (storedAdmission.toLowerCase() !== admissionNumber.toLowerCase() || storedPassword !== password) {
      return res.status(401).json(invalid);
    }

    var members = await MemberDetails.find({
      batch: new RegExp('^' + escapeRegex(leader.year) + '$', 'i')
    })
      .sort({ name: 1 })
      .lean();

    return res.json({
      success: true,
      leader: {
        name: leader.memberName || 'Batch Leader',
        year: leader.year,
        admissionNumber: storedAdmission
      },
      members: members.map(function (m) {
        return {
          admissionNumber: m.admissionNumber || '',
          name: m.name || '',
          place: m.place || '',
          batch: m.batch || '',
          email: m.email || ''
        };
      })
    });
  } catch (error) {
    console.error('Leader login failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not sign you in. Please try again.' });
  }
});

module.exports = router;
