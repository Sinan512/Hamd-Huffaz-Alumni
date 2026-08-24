var mongoose = require('mongoose');

var paymentItemSchema = new mongoose.Schema({
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  amount: { type: Number, default: 30 },
  screenShot: {
    data: Buffer,
    contentType: String
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  approvedBy: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: '' },
  submittedAt: { type: Date, default: Date.now }
});

var paymentStatusSchema = new mongoose.Schema(
  {
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MemberDetails',
      required: true,
      unique: true
    },
    membersPayments: [paymentItemSchema]
  },
  {
    timestamps: true,
    collection: 'PAYMENT_STATUS'
  }
);

module.exports = mongoose.model('PaymentStatus', paymentStatusSchema);
