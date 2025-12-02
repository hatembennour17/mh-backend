const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true, required: true },
  customerInfo: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zipCode: { type: String, required: true },
    country: { type: String, default: 'US' }
  },
  paymentInfo: {
    squarePaymentToken: { type: String, required: true },
    squareOrderId: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    paymentStatus: { 
      type: String, 
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending'
    }
  },
  items: [{
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    description: { type: String }
  }],
  orderStatus: {
    type: String,
    enum: ['pending', 'paid', 'processing', 'fulfilled', 'cancelled', 'shipped', 'delivered'],
    default: 'pending'
  },
  trackingNumber: { type: String },
  shippingAddress: {
    firstName: { type: String },
    lastName: { type: String },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    zipCode: { type: String }
  },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    const date = new Date();
    this.orderNumber = `MHD-${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);