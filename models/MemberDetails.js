const mongoose = require('mongoose');

const memberDetailsSchema = new mongoose.Schema(
  {
    admissionNumber: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    place: { type: String, required: true, trim: true },
    batch: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true }
  },
  { timestamps: true }
);

// A member counts as "already added" when admission number + name + batch match.
memberDetailsSchema.index(
  { admissionNumber: 1, name: 1, batch: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

// Third argument pins the collection name so mongoose does not pluralize it.
module.exports = mongoose.model('MemberDetails', memberDetailsSchema, 'MEMBER_DETAILS');
