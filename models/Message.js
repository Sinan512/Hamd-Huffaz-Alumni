var mongoose = require('mongoose');

var messageSchema = new mongoose.Schema(
  {
    name:    { type: String, required: true, trim: true },
    email:   { type: String, required: true, trim: true, lowercase: true },
    phone:   { type: String, trim: true, default: '' },
    subject: { type: String, trim: true, default: '' },
    message: { type: String, required: true, trim: true },
    read:    { type: Boolean, default: false }
  },
  { timestamps: true, collection: 'MESSAGES' }
);

/* Third argument pins the collection name so mongoose does not pluralize it. */
module.exports = mongoose.model('Message', messageSchema, 'MESSAGES');
