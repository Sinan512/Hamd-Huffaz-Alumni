var mongoose = require('mongoose');

var gallerySchema = new mongoose.Schema(
{
    image: {
        data: Buffer,
        contentType: String
    },

    description: {
        type: String,
        default: '',
        trim: true
    }
},
{
    timestamps: true,
    collection: 'GALLERY'
});

module.exports = mongoose.model('Gallery', gallerySchema);