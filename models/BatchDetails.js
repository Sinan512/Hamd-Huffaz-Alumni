const mongoose = require('mongoose');

const batchDetailsSchema = new mongoose.Schema(
  {
    year: { type: String, required: true, trim: true, unique: true },
    description: { type: String, trim: true, default: '' },
    memberCount: { type: Number, default: 0 },
    // Document _ids of the matching members in the MEMBER_DETAILS collection.
    memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MemberDetails' }]
  },
  { timestamps: true }
);

// Third argument pins the collection name so mongoose does not pluralize it.
module.exports = mongoose.model('BatchDetails', batchDetailsSchema, 'BATCH_DETAILS');
