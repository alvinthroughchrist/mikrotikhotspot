const axios = require('axios');
const fs = require('fs');

function loadConfig() {
  try {
    return require('./config.json');
  } catch (error) {
    return require('./config.example.json');
  }
}

const config = loadConfig();
const env = config.safaricom.environment === 'production' ? 'production' : 'sandbox';
const endpoints = {
  sandbox: {
    oauth: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    stkPush: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
    stkPushQuery: 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query'
  },
  production: {
    oauth: 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    stkPush: 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
    stkPushQuery: 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query'
  }
};

function isPlaceholder(value) {
  return !value || /YOUR_|your-/.test(String(value));
}

function getCallbackUrl() {
  const callbackUrl = config.safaricom.callbackUrl;
  if (callbackUrl && callbackUrl !== 'https://your-public-host.com/mpesa/callback') {
    return callbackUrl;
  }

  if (config.server && config.server.baseUrl) {
    return `${config.server.baseUrl.replace(/\/$/, '')}/mpesa/callback`;
  }

  throw new Error('Safaricom callback URL is not configured. Please set safaricom.callbackUrl or server.baseUrl in config.json.');
}

async function getAccessToken() {
  if (isPlaceholder(config.safaricom.consumerKey) || isPlaceholder(config.safaricom.consumerSecret)) {
    throw new Error('Safaricom consumer key and consumer secret must be configured in config.json and cannot be placeholder values.');
  }

  const auth = Buffer.from(`${config.safaricom.consumerKey}:${config.safaricom.consumerSecret}`).toString('base64');
  const url = endpoints[env].oauth;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${auth}`
      }
    });
    return response.data.access_token;
  } catch (error) {
    const detail = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Failed to get Safaricom access token: ${detail}`);
  }
}

async function stkPush(phone, amount, accountReference, transactionDesc, useTillNumber = false) {
  // Determine which payment method to use
  const usesTill = useTillNumber && !isPlaceholder(config.safaricom.tillNumber);
  
  if (usesTill) {
    // Till Number (Buy Goods) validation
    if (isPlaceholder(config.safaricom.tillNumber)) {
      throw new Error('Safaricom till number is not configured. Set safaricom.tillNumber in config.json.');
    }
  } else {
    // Short Code (PayBill) validation
    if (isPlaceholder(config.safaricom.shortCode) || isPlaceholder(config.safaricom.passKey)) {
      throw new Error('Safaricom short code and passkey must be configured in config.json and cannot be placeholder values.');
    }
  }

  const callbackUrl = getCallbackUrl();
  if (isPlaceholder(callbackUrl)) {
    throw new Error('Safaricom callback URL must be configured in config.json and cannot be a placeholder value.');
  }

  const accessToken = await getAccessToken();
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  
  const businessCode = usesTill ? config.safaricom.tillNumber : config.safaricom.shortCode;
  const transactionType = usesTill ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline';
  const password = Buffer.from(`${businessCode}${config.safaricom.passKey}${timestamp}`).toString('base64');

  const payload = {
    BusinessShortCode: businessCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: transactionType,
    Amount: amount,
    PartyA: phone,
    PartyB: businessCode,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: accountReference,
    TransactionDesc: transactionDesc
  };

  const url = endpoints[env].stkPush;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    const detail = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Safaricom STK Push failed: ${detail}`);
  }
}

async function stkPushQuery(checkoutRequestID, useTillNumber = false) {
  if (!checkoutRequestID) {
    throw new Error('CheckoutRequestID is required for STK Push status query.');
  }

  const usesTill = useTillNumber && !isPlaceholder(config.safaricom.tillNumber);
  const businessCode = usesTill ? config.safaricom.tillNumber : config.safaricom.shortCode;

  if (usesTill) {
    if (isPlaceholder(config.safaricom.tillNumber)) {
      throw new Error('Safaricom till number is not configured. Set safaricom.tillNumber in config.json.');
    }
  } else {
    if (isPlaceholder(config.safaricom.shortCode) || isPlaceholder(config.safaricom.passKey)) {
      throw new Error('Safaricom short code and passkey must be configured in config.json and cannot be placeholder values.');
    }
  }

  const accessToken = await getAccessToken();
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const password = Buffer.from(`${businessCode}${config.safaricom.passKey}${timestamp}`).toString('base64');
  const payload = {
    BusinessShortCode: businessCode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestID
  };

  const url = endpoints[env].stkPushQuery;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    const detail = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Safaricom STK Push status query failed: ${detail}`);
  }
}

module.exports = {
  stkPush,
  stkPushWithTill: (phone, amount, accountReference, transactionDesc) => 
    stkPush(phone, amount, accountReference, transactionDesc, true),
  stkPushQuery
};
