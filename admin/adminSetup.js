const AdminJS = require('adminjs');
const AdminJSExpress = require('@adminjs/express');
const AdminJSMongoose = require('@adminjs/mongoose');

AdminJS.registerAdapter(AdminJSMongoose);

const adminOptions = {
  resources: [],
  branding: {
    companyName: 'M&H Distributions Admin',
    logo: false
  }
};

const admin = new AdminJS(adminOptions);
const adminRouter = AdminJSExpress.buildRouter(admin);

module.exports = { admin, adminRouter };