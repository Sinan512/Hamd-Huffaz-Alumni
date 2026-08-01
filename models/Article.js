var mongoose = require('mongoose');

var articleSchema = new mongoose.Schema(
  {
    heading: { type: String, required: true, trim: true },
    author:  { type: String, trim: true, default: '' },
    content: { type: String, default: '' },
    image: {
      data:        { type: Buffer, default: null },
      contentType: { type: String, default: null }
    }
  },
  { timestamps: true, collection: 'ARTICLE_DETAILS' }
);

/* Third argument pins the collection name so mongoose does not pluralize it. */
module.exports = mongoose.model('Article', articleSchema, 'ARTICLE_DETAILS');
