const mongoose = require('mongoose');

const batchDetailsSchema = new mongoose.Schema(
  {
    batchYear: { type: String, required: true, trim: true, unique: true },
    description: { type: String, trim: true, default: '' },
    totalMembers: { type: Number, default: 0 },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MemberDetails' }]
  },
  { timestamps: true }
);

// Third argument pins the collection name so mongoose does not pluralize it.
module.exports = mongoose.model('BatchDetails', batchDetailsSchema, 'BATCH_DETAILS');
