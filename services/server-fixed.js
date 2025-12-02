require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:4200', 'https://your-tiiny-site.tiiny.site'],
  credentials: true
}));

// Validate environment variables
const requiredEnvVars = ['MONGODB_URI'];
requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
});

console.log('✅ Environment variables loaded successfully');

// Try to initialize Square client with error handling
let squareClient = null;
try {
  const { Client, Environment } = require('square');
  
  const squareConfig = {
    environment: process.env.SQUARE_ENVIRONMENT === 'production' 
      ? Environment.Production 
      : Environment.Sandbox,
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
  };

  squareClient = new Client(squareConfig);
  console.log('✅ Square SDK initialized successfully');
} catch (squareError) {
  console.log('⚠️ Square SDK not available, using mock mode');
  console.log('💡 Square error:', squareError.message);
  
  // Mock Square client for development
  squareClient = {
    paymentsApi: {
      createPayment: async (paymentData) => {
        console.log('💳 [MOCK] Processing payment:', {
          amount: paymentData.amountMoney?.amount,
          currency: paymentData.amountMoney?.currency
        });
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        return {
          result: {
            payment: {
              id: 'mock_payment_' + Date.now(),
              orderId: 'mock_order_' + Date.now(),
              status: 'COMPLETED'
            }
          }
        };
      }
    }
  };
}

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// Import models and services
const Order = require('./models/Order');
const { sendOrderConfirmationEmails, sendOrderStatusUpdateEmails } = require('./services/emailService');

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'M&H Distributions Backend is running',
    square: squareClient ? 'Available' : 'Mock Mode',
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString()
  });
});

// Process payment endpoint (works with both real and mock Square)
app.post('/api/process-payment', async (req, res) => {
  const { paymentToken, total, items, customerInfo } = req.body;
  
  console.log('💰 Processing payment request:', { 
    total, 
    items: items?.length,
    customer: customerInfo?.email,
    squareMode: squareClient.paymentsApi.createPayment.name === 'createPayment' ? 'Real' : 'Mock'
  });

  // Validate input
  if (!paymentToken || !total || !items || !customerInfo) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: paymentToken, total, items, and customerInfo are required'
    });
  }

  try {
    // Convert dollars to cents
    const amountCents = Math.round(total * 100);
    
    // Create payment with Square (real or mock)
    const { result } = await squareClient.paymentsApi.createPayment({
      sourceId: paymentToken,
      idempotencyKey: require('crypto').randomUUID?.() || 'mock_' + Date.now(),
      amountMoney: {
        amount: amountCents,
        currency: 'USD'
      },
      locationId: process.env.SQUARE_LOCATION_ID || 'mock_location',
      note: `M&H Distributions - ${customerInfo.firstName} ${customerInfo.lastName}`
    });

    console.log('✅ Payment successful:', result.payment?.id);

    // Create order in database
    const order = new Order({
      customerInfo: customerInfo,
      items: items,
      paymentInfo: {
        squarePaymentToken: result.payment.id,
        squareOrderId: result.payment.orderId,
        amount: total,
        paymentStatus: 'paid'
      },
      orderStatus: 'paid',
      shippingAddress: {
        firstName: customerInfo.firstName,
        lastName: customerInfo.lastName,
        address: customerInfo.address,
        city: customerInfo.city,
        state: customerInfo.state,
        zipCode: customerInfo.zipCode
      }
    });

    await order.save();
    console.log('✅ Order created:', order.orderNumber);

    // Send confirmation emails
    await sendOrderConfirmationEmails(order);

    res.json({ 
      success: true, 
      paymentId: result.payment.id,
      orderId: order._id,
      orderNumber: order.orderNumber,
      orderTotal: total,
      message: 'Payment processed and order created successfully'
    });

  } catch (error) {
    console.error('❌ Payment processing error:', error);
    
    let errorMessage = 'Payment processing failed';
    
    if (error.errors && error.errors.length > 0) {
      errorMessage = error.errors[0].detail || errorMessage;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(400).json({ 
      success: false, 
      error: errorMessage 
    });
  }
});

// Get all orders
app.get('/api/orders', async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const query = status ? { orderStatus: status } : {};
    
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Order.countDocuments(query);

    res.json({
      success: true,
      orders,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });

  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
});

// Update order status
app.patch('/api/orders/:orderId/status', async (req, res) => {
  try {
    const { status, trackingNumber, notes } = req.body;
    const { orderId } = req.params;

    const validStatuses = ['pending', 'paid', 'processing', 'fulfilled', 'cancelled', 'shipped', 'delivered'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

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
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Send status update emails
    await sendOrderStatusUpdateEmails(order);

    res.json({
      success: true,
      order,
      message: `Order status updated to ${status}`
    });

  } catch (error) {
    console.error('❌ Error updating order status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update order status'
    });
  }
});

// Test endpoint - create order without payment
app.post('/api/test-order', async (req, res) => {
  const { total, items, customerInfo } = req.body;
  
  console.log('🧪 Creating test order:', { 
    total, 
    items: items?.length,
    customer: customerInfo?.email 
  });

  try {
    const order = new Order({
      customerInfo: customerInfo,
      items: items,
      paymentInfo: {
        squarePaymentToken: 'test_token_' + Date.now(),
        squareOrderId: 'test_order_' + Date.now(),
        amount: total,
        paymentStatus: 'paid'
      },
      orderStatus: 'paid'
    });

    await order.save();
    console.log('✅ Test order created:', order.orderNumber);

    await sendOrderConfirmationEmails(order);

    res.json({ 
      success: true, 
      orderId: order._id,
      orderNumber: order.orderNumber,
      message: 'Test order created successfully'
    });

  } catch (error) {
    console.error('❌ Test order error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create test order'
    });
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error('🚨 Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 M&H Distributions Backend running on port ${PORT}`);
  console.log(`💳 Square Mode: ${squareClient.paymentsApi.createPayment.name === 'createPayment' ? 'Real' : 'Mock'}`);
  console.log(`🗄️  MongoDB: Connected`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`✅ Ready to process orders!`);
});