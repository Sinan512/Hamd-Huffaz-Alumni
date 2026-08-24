var mongoose = require('mongoose');

/* A single, admin-managed payment configuration for the alumni site. */
var paymentSetupSchema = new mongoose.Schema(
  {
    singleton: {
      type: Boolean,
      default: true,
      unique: true
    },
    upiId: {
      type: String,
      default: '',
      trim: true
    },
    gpayNumber: {
      type: String,
      default: '',
      trim: true
    },
    contributionStartMonth: { type: Number, min: 1, max: 12, default: null },
    contributionStartYear: { type: Number, min: 2000, max: 2100, default: null },
    qrCode: {
      data: Buffer,
      contentType: String
    }
  },
  {
    timestamps: true,
    collection: 'PAYMENT_SETUP'
  }
);

module.exports = mongoose.model('PaymentSetup', paymentSetupSchema);
