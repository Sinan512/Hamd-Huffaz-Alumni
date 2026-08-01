var mongoose = require('mongoose');

/* Tasks created by a batch leader, stored in the LEADER_TASKS collection.
   Each task belongs to exactly one batch year and carries the list of
   batch members the leader assigned to it. */
var leaderTaskMemberSchema = new mongoose.Schema(
  {
    admissionNumber: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

var leaderTaskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    dueDate: {
      type: Date,
      default: null
    },
    leaderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BatchLeader'
    },
    batchYear: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    members: {
      type: [leaderTaskMemberSchema],
      default: []
    }
  },
  {
    timestamps: true,
    collection: 'LEADER_TASKS'
  }
);

module.exports = mongoose.model('LeaderTask', leaderTaskSchema);
