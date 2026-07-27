const mongoose = require('mongoose');

const batchLeaderSchema = new mongoose.Schema(
  {
    batchYear: { type: String, required: true, trim: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'MemberDetails', required: true },
    name: { type: String, required: true, trim: true },
    admissionNumber: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    assignedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// A member can only lead a given batch once.
batchLeaderSchema.index({ batchYear: 1, memberId: 1 }, { unique: true });

module.exports = mongoose.model('BatchLeader', batchLeaderSchema, 'BATCH_LEADERS');
