require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const safaricom = require('./safaricom');
const mikrotik = require('./mikrotik');

const config = loadConfig();
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const packages = {
  basic: { label: '30 minutes', amount: 5, duration: '30m', profile: config.routeros.hotspotProfile || 'default' },
  standard: { label: '1 hour', amount: 10, duration: '1h', profile: config.routeros.hotspotProfile || 'default' },
  premium: { label: '3 hours', amount: 30, duration: '3h', profile: config.routeros.hotspotProfile || 'default' }
};
const payments = {};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/pay', async (req, res) => {
  const packageId = req.body.package || 'standard';
  const phone = normalizePhone(req.body.phone || req.body.msisdn || '');
  const product = packages[packageId] || packages.standard;

  if (!phone) {
    return res.status(400).json({ error: 'Enter a valid Kenyan phone number in the format 07XXXXXXXX.' });
  }

  const merchantRequestID = `HOTSPOT-${Date.now()}`;
  const username = `guest-${Date.now()}`;
  const password = Math.random().toString(36).slice(2, 10);

  payments[merchantRequestID] = {
    status: 'pending',
    phone,
    amount: product.amount,
    package: product.label,
    duration: product.duration,
    profile: product.profile,
    username,
    password,
    accountReference: merchantRequestID,
    description: `Hotspot access for ${product.label}`
  };

  try {
    const result = await safaricom.stkPush(phone, product.amount, merchantRequestID, payments[merchantRequestID].description);
    payments[merchantRequestID].stk = result;
    return res.json({ merchantRequestID, status: 'pending' });
  } catch (error) {
    console.error('STK Push error:', error);
    return res.status(500).json({ error: error.message || 'Unable to initiate M-PESA payment.' });
  }
});

app.get('/status/:merchantRequestID', (req, res) => {
  return res.redirect(`/status.html?merchantRequestID=${encodeURIComponent(req.params.merchantRequestID)}`);
});

app.get('/api/status/:merchantRequestID', async (req, res) => {
  const record = payments[req.params.merchantRequestID];
  if (!record) {
    return res.status(404).json({ error: 'Payment record not found.' });
  }

  const checkoutRequestID = record.checkoutRequestID || (record.stk && record.stk.CheckoutRequestID);
  if (checkoutRequestID && ['pending', 'processing'].includes(record.status)) {
    try {
      const queryResult = await safaricom.stkPushQuery(checkoutRequestID);
      record.darajaQuery = queryResult;

      const resultCode = String(queryResult.ResultCode || queryResult.resultCode || '');
      const resultDesc = queryResult.ResultDesc || queryResult.resultDesc || queryResult.ResponseDescription || queryResult.responseDescription;

      if (resultCode !== '0') {
        record.status = 'failed';
        record.result = resultDesc || record.result || 'Payment was not completed.';
      } else if (resultCode === '0') {
        if (record.status !== 'success') {
          const metadata = Array.isArray(queryResult.CallbackMetadata?.Item)
            ? queryResult.CallbackMetadata.Item
            : [];

          if (metadata.length > 0 && !record.voucher) {
            const details = metadata.reduce((acc, item) => {
              acc[item.Name] = item.Value;
              return acc;
            }, {});

            record.receipt = details.MpesaReceiptNumber || details.ReceiptNumber || record.receipt;
            record.amountPaid = details.Amount || record.amount;
            record.phone = details.PhoneNumber || record.phone;

            try {
              await mikrotik.addHotspotUser(record.username, record.password, record.duration, record.profile);
              record.status = 'success';
              record.voucher = {
                username: record.username,
                password: record.password,
                expiry: new Date(Date.now() + parseDuration(record.duration)).toISOString()
              };
            } catch (error) {
              record.status = 'error';
              record.result = `Failed to create hotspot user: ${error.message}`;
            }
          } else {
            record.status = 'processing';
          }
        }
      }
    } catch (error) {
      console.error('STK Push query error:', error);
      record.darajaQueryError = error.message || error;
    }
  }

  return res.json(record);
});

app.get('/api/packages', (req, res) => {
  return res.json(packages);
});

app.post('/mpesa/callback', async (req, res) => {
  const callback = req.body.Body && req.body.Body.stkCallback;
  if (!callback) {
    return res.status(400).json({ error: 'Invalid callback payload' });
  }

  const requestId = callback.MerchantRequestID;
  const record = payments[requestId];
  if (!record) {
    return res.status(404).json({ error: 'Payment record not found' });
  }

  record.checkoutRequestID = callback.CheckoutRequestID;
  record.resultCode = callback.ResultCode;
  record.resultDesc = callback.ResultDesc;

  if (callback.ResultCode !== 0) {
    record.status = 'failed';
    record.result = callback.ResultDesc;
    return res.status(200).json({ message: 'Callback recorded' });
  }

  record.status = 'processing';
  const metadata = callback.CallbackMetadata && callback.CallbackMetadata.Item;
  const details = Array.isArray(metadata)
    ? metadata.reduce((acc, item) => {
        acc[item.Name] = item.Value;
        return acc;
      }, {})
    : {};

  record.receipt = details.MpesaReceiptNumber || details.ReceiptNumber;
  record.amountPaid = details.Amount || record.amount;
  record.phone = details.PhoneNumber || record.phone;

  try {
    await mikrotik.addHotspotUser(record.username, record.password, record.duration, record.profile);
    record.status = 'success';
    record.voucher = {
      username: record.username,
      password: record.password,
      expiry: new Date(Date.now() + parseDuration(record.duration)).toISOString()
    };
  } catch (error) {
    record.status = 'error';
    record.result = `Failed to create hotspot user: ${error.message}`;
  }

  return res.status(200).json({ message: 'Callback processed' });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const port = process.env.PORT || config.server.port || 3000;
app.listen(port, () => {
  console.log(`Hotspot billing service listening on port ${port}`);
});

function loadConfig() {
  try {
    return require('./config.json');
  } catch (error) {
    return require('./config.example.json');
  }
}

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 9) {
    return `254${digits}`;
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return `254${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith('254')) {
    return digits;
  }
  return '';
}

function parseDuration(duration) {
  if (typeof duration !== 'string') return 0;
  const match = duration.match(/^(\d+)([mh])$/);
  if (!match) return 0;
  const value = Number(match[1]);
  return match[2] === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000;
}

