
require('dotenv').config();
const express = require('express');
const { Client, Environment } = require('square');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 0; // 0 means use any available port

// File path for orders storage
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// Load existing orders from file
let orders = [];
try {
  if (fs.existsSync(ORDERS_FILE)) {
    const data = fs.readFileSync(ORDERS_FILE, 'utf8');
    orders = JSON.parse(data);
    console.log(`📂 Loaded ${orders.length} existing orders from file`);
  }
} catch (error) {
  console.log('📂 Starting with empty orders (no file found)');
}

// Function to save orders to file
function saveOrdersToFile() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
    console.log(`💾 Saved ${orders.length} orders to file`);
  } catch (error) {
    console.error('❌ Error saving orders to file:', error);
  }
}

// Square client configuration
const squareClient = new Client({
  environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
  accessToken: process.env.SQUARE_ACCESS_TOKEN
});

// Middleware
app.use(express.json());
app.use(cors({
  origin: ['https://your-tiiny-site.tiiny.site'],
  credentials: true
}));

let orderIdCounter = orders.length + 1;
// Add this health check route (Railway needs this)
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    service: 'M&H Distributions Backend',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'M&H Distributions Backend is running',
    square: 'Connected',
    database: 'JSON File Storage',
    ordersCount: orders.length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/orders', (req, res) => {
  res.json({
    success: true,
    orders: orders,
    count: orders.length
  });
});

app.post('/api/orders', async (req, res) => {
  try {
    console.log('💰 Processing order:', req.body);
    
    // Extract data with defaults
    const { 
      total = 0, 
      items = 0, 
      customer = 'unknown@customer.com', 
      products = [], 
      customerDetails = {},
      paymentToken,  // ADD THIS: Get the payment token from frontend
    } = req.body;
    
    // VALIDATION: Ensure payment token exists
    if (!paymentToken) {
      return res.status(400).json({
        success: false,
        error: 'Payment token is required'
      });
    }
    
    // Process payment with Square - USE REAL TOKEN
    try {
      const paymentResult = await squareClient.paymentsApi.createPayment({
        sourceId: paymentToken,  // CHANGE THIS: Use the real token from frontend
        idempotencyKey: 'order-' + Date.now(),
        amountMoney: {
          amount: Math.round(total * 100), // Convert to cents
          currency: 'USD'
        },
        locationId: process.env.SQUARE_LOCATION_ID,
        // ADD customer information for better tracking
        buyerEmailAddress: customerDetails.email || customer,
        billingAddress: {
          addressLine1: customerDetails.address || '',
          locality: customerDetails.city || '',
          administrativeDistrictLevel1: customerDetails.state || '',
          postalCode: customerDetails.zipCode || '',
          country: 'US'
        }
      });
      
      console.log('💳 Square payment processed:', paymentResult.result.payment.id);
      console.log('💳 Payment status:', paymentResult.result.payment.status);
      
    } catch (paymentError) {
      // DON'T fall back to mock mode in production!
      console.error('❌ Square payment failed:', paymentError);
      
      // Return error to frontend
      return res.status(400).json({
        success: false,
        error: `Payment failed: ${paymentError.message}`,
        details: paymentError.errors || 'No additional details'
      });
    }
    
    // Only create order if payment succeeded
    const order = {
      id: 'MHD-' + orderIdCounter++,
      orderNumber: 'ORD-' + Date.now(),
      squareOrderId: 'sq-' + Date.now(),
      total: total,
      items: items,
      customer: customer,
      customerDetails: customerDetails,
      products: products,
      status: 'pending',
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      shippingStatus: 'not_shipped',
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    orders.push(order);
    saveOrdersToFile();
    
    console.log('✅ Order created:', order.id);
    console.log('👤 Customer:', customerDetails.firstName, customerDetails.lastName);
    console.log('📧 Email:', customer);
    console.log('📞 Phone:', customerDetails.phone);
    
    res.json({
      success: true,
      order: order,
      message: 'Order processed successfully'
    });
    
  } catch (error) {
    console.error('❌ Order processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 M&H Distributions Backend running on port', PORT);
  console.log('💳 Square Environment:', process.env.SQUARE_ENVIRONMENT);
  console.log('📍 Square Location ID:', process.env.SQUARE_LOCATION_ID);
  console.log('🗄️  Database: JSON File Storage');
  console.log('📂 Orders file:', ORDERS_FILE);
  console.log('🌐 Health check: http://localhost:' + PORT + '/api/health');
  console.log('✅ Ready to process orders!');
});
