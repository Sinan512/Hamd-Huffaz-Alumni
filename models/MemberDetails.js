const mongoose = require('mongoose');

const memberDetailsSchema = new mongoose.Schema(
  {
    /* ── Core fields (set by admin — not editable by member) ── */
    admissionNumber: { type: String, required: true, trim: true },
    name:            { type: String, required: true, trim: true },
    place:           { type: String, trim: true, default: '' },
    batch:           { type: String, required: true, trim: true },
    email:           { type: String, required: true, trim: true, lowercase: true },

    /* ── Auth ── */
    /* If not set, admissionNumber is used as the initial/default password. */
    password:        { type: String, trim: true, default: '' },

    /* ── Personal ── */
    address:         { type: String, trim: true, default: '' },
    phone:           { type: String, trim: true, default: '' },
    whatsapp:        { type: String, trim: true, default: '' },

    /* ── Education ── */
    admYear:         { type: String, trim: true, default: '' },   // Year of Admission
    leaveYear:       { type: String, trim: true, default: '' },   // Year of Leaving
    eduQual:         { type: String, trim: true, default: '' },   // Educational Qualification
    religiousDegree: { type: String, trim: true, default: '' },   // Religious / General Degree
    higherEdu:       { type: String, enum: ['yes', 'no', ''], default: '' },

    /* ── Job / Study ── */
    currentStatus:   { type: String, trim: true, default: '' },   // 'Job' | 'Study' | 'Job & Study' | 'Other'
    workLocation:    { type: String, trim: true, default: '' },
    jobRole:         { type: String, trim: true, default: '' },
    college:         { type: String, trim: true, default: '' },
    course:          { type: String, trim: true, default: '' },

    /* ── Other ── */
    skills:          { type: String, trim: true, default: '' },   // Creative Skills
    languages:       { type: String, trim: true, default: '' },   // Languages Known
    orgRoles:        { type: String, trim: true, default: '' },   // Organizational Roles

    /* ── Family ── */
    familyCount:     { type: Number, default: null },
    earningMembers:  { type: String, trim: true, default: '' },
    hasDependents:   { type: String, enum: ['yes', 'no', ''], default: '' },
    dependentsWho:   { type: String, trim: true, default: '' },
    parentsDeceased: { type: String, enum: ['yes', 'no', ''], default: '' },
    chronicIll:      { type: String, enum: ['yes', 'no', ''], default: '' },
    chronicIllDetails: { type: String, trim: true, default: '' },

    /* ── Parents ── */
    fatherName:      { type: String, trim: true, default: '' },
    motherName:      { type: String, trim: true, default: '' },

    /* ── Misc ── */
    ownHouse:        { type: String, enum: ['yes', 'no', ''], default: '' },
    married:         { type: String, enum: ['yes', 'no', ''], default: '' },
    childrenCount:   { type: Number, default: null },

    /* ── Event registrations ── */
    registeredEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EventDetails' }]
  },
  { timestamps: true }
);

/* A member counts as "already added" when admission number + name + batch match. */
memberDetailsSchema.index(
  { admissionNumber: 1, name: 1, batch: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

/* Third argument pins the collection name so mongoose does not pluralize it. */
module.exports = mongoose.model('MemberDetails', memberDetailsSchema, 'MEMBER_DETAILS');
