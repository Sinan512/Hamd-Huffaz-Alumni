var mongoose = require('mongoose');

var eventDetailsSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    category: { type: String, trim: true, default: 'General' },
    location: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    image: {
      data: { type: Buffer, default: null },
      contentType: { type: String, default: null }
    }
  },
  { timestamps: true, collection: 'EVENT_DETAILS' }
);

module.exports = mongoose.model('EventDetails', eventDetailsSchema);
