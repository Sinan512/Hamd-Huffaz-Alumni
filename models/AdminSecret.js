const mongoose = require('mongoose');

/* ------------------------------------------------------------------ */
/* ADMIN_SECRETS – admin credentials + admin profile                    */
/*                                                                      */
/* The password is NEVER stored in plain text. We keep a random salt    */
/* and the SHA-256 hex digest of (salt + password).                     */
/* ------------------------------------------------------------------ */
const adminSecretSchema = new mongoose.Schema(
  {
    /* ── Credentials ── */
    username:     { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    salt:         { type: String, required: true },

    /* ── Profile (shown in the admin header / sidebar) ── */
    displayName:  { type: String, trim: true, default: 'Super Admin' },
    batch:        { type: String, trim: true, default: '' },
    email:        { type: String, trim: true, lowercase: true, default: '' },

    /* ── Avatar image, stored directly in MongoDB ── */
    avatar: {
      data:        Buffer,
      contentType: String
    },

    lastLoginAt:  { type: Date, default: null }
  },
  { timestamps: true }
);

/* Third argument pins the collection name so mongoose does not pluralize it. */
module.exports = mongoose.model('AdminSecret', adminSecretSchema, 'ADMIN_SECRETS');
