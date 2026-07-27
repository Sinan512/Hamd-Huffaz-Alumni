var mongoose = require('mongoose');

/* One leader per batch year, stored in the BATCH_LEADERS collection. */
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
    }
  },
  {
    timestamps: true,
    collection: 'BATCH_LEADERS'
  }
);

module.exports = mongoose.model('BatchLeader', batchLeaderSchema);
