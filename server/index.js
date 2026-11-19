'use strict';
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const app = createApp({
  dataDir: process.env.DATA_DIR,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  secureCookies: process.env.SECURE_COOKIES === 'true',
  trustProxy: process.env.TRUST_PROXY === 'true',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 15,
});

app.listen(port, () => {
  console.log(`PROMERGON Vendor Registration running on http://localhost:${port}`);
});
