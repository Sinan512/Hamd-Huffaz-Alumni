var express  = require('express');
var router   = express.Router();
var mongoose = require('mongoose');
var connectDB = require('../config/db');

var Gallery      = require('../models/Gallery');
var Article      = require('../models/Article');
var EventDetails = require('../models/EventDetails');

/* ==================================================================
   PUBLIC MEDIA ROUTES
   ------------------------------------------------------------------
   Read-only image streams for content that is already shown publicly
   on the home page (gallery photos, article covers, event banners).

   These deliberately live OUTSIDE /admin: every /admin route sits
   behind requireAdmin, so the previous /admin/<type>/:id/image URLs
   returned 401 for anyone who was not signed in as admin — which is
   why images only appeared on the admin's own device.

   Nothing here lists or exposes anything beyond the image bytes of a
   document whose id is already public in the rendered page.
================================================================== */

var ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

function sendImage(Model) {
  return async function (req, res) {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).end();
      }

      await connectDB();

      var doc = await Model
        .findById(req.params.id, { 'image.data': 1, 'image.contentType': 1 })
        .lean();

      if (!doc || !doc.image || !doc.image.data) {
        return res.status(404).end();
      }

      res.set('Content-Type', doc.image.contentType || 'application/octet-stream');
      res.set('Cache-Control', 'public, max-age=' + ONE_WEEK_SECONDS + ', immutable');
      return res.send(doc.image.data.buffer || doc.image.data);
    } catch (error) {
      console.error('Media: image fetch failed —', error.message);
      return res.status(500).end();
    }
  };
}

router.get('/gallery/:id',  sendImage(Gallery));
router.get('/articles/:id', sendImage(Article));
router.get('/events/:id',   sendImage(EventDetails));

module.exports = router;
