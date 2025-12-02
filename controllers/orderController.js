const Order = require('../models/Order');
const { sendEmail } = require('../services/emailService');
const squareClient = require('../config/square');

exports.createOrder = async (req, res) => {
  try {
    const { customerInfo, items, squarePaymentToken, totalAmount } = req.body;

    // Process payment with Square
    const paymentResult = await squareClient.paymentsApi.createPayment({
      sourceId: squarePaymentToken,
      amountMoney: {
        amount: Math.round(totalAmount * 100), // Convert to cents
        currency: 'USD'
      },
      idempotencyKey: require('crypto').randomBytes(32).toString('hex')
    });

    if (paymentResult.result.payment.status === 'COMPLETED') {
      // Create order record
      const order = new Order({
        customerInfo,
        items,
        paymentInfo: {
          squarePaymentToken: paymentResult.result.payment.id,
          squareOrderId: paymentResult.result.payment.orderId,
          amount: totalAmount,
          paymentStatus: 'paid'
        },
        orderStatus: 'paid'
      });

      await order.save();

      // Send confirmation emails
      await sendOrderConfirmationEmails(order);

      res.status(201).json({
        success: true,
        order: order,
        message: 'Order created successfully'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating order',
      error: error.message
    });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, trackingNumber, notes } = req.body;

    const order = await Order.findByIdAndUpdate(
      orderId,
      { 
        orderStatus: status,
        ...(trackingNumber && { trackingNumber }),
        ...(notes && { notes }),
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Send status update emails
    await sendOrderStatusUpdateEmails(order);

    res.json({
      success: true,
      order: order,
      message: `Order status updated to ${status}`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating order status',
      error: error.message
    });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = status ? { orderStatus: status } : {};
    
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    res.json({
      orders,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
};