// Mock email service for local testing
exports.sendOrderConfirmationEmails = async (order) => {
  console.log('📧 [MOCK] Sending order confirmation emails:');
  console.log('   To customer:', order.customerInfo.email);
  console.log('   Order:', order.orderNumber);
  console.log('   Amount: $' + order.paymentInfo.amount);
  console.log('   Items:', order.items.map(item => `${item.name} x${item.quantity}`).join(', '));
  
  // In production, this would send real emails via SendGrid
  return Promise.resolve();
};

exports.sendOrderStatusUpdateEmails = async (order) => {
  console.log('📧 [MOCK] Sending status update email:');
  console.log('   To:', order.customerInfo.email);
  console.log('   Order:', order.orderNumber);
  console.log('   New Status:', order.orderStatus);
  
  return Promise.resolve();
};