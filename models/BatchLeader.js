var mongoose = require('mongoose');

/* One leader per batch year, stored in the BATCH_LEADERS collection.
   Passwords are stored as sha256(salt + password) – never plain text.
   The legacy `password` field is kept only so old records can still be
   read and migrated on the leader's next successful login. */
var batchLeaderSchema = new mongoose.Schema(
  {
    year: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BatchDetails'
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MemberDetails',
      required: true
    },
    memberName: {
      type: String,
      trim: true,
      default: ''
    },
    assignedAt: {
      type: Date,
      default: Date.now
    },
    admissionNumber: {
      type: String,
      trim: true,
      default: ''
    },

    /* --- credentials --- */
    passwordHash: {
      type: String,
      default: ''
    },
    salt: {
      type: String,
      default: ''
    },
    /* legacy plain-text password – cleared once migrated to passwordHash */
    password: {
      type: String,
      default: ''
    },
    passwordUpdatedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    collection: 'BATCH_LEADERS'
  }
);

module.exports = mongoose.model('BatchLeader', batchLeaderSchema);
