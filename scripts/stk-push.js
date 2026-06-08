#!/usr/bin/env node
const safaricom = require('../safaricom');

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (arg === '--till') { args.till = true; return; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  });
  return args;
}

async function main() {
  const args = parseArgs();
  const phone = args.phone || args.msisdn || args.ph || args.p;
  const amount = Number(args.amount || args.amt || 1);
  const ref = args.ref || args.accountReference || `CLI-${Date.now()}`;
  const desc = args.desc || args.description || 'CLI STK Push';

  if (!phone) {
    console.error('Missing phone. Usage: node scripts/stk-push.js --phone=2547... --amount=10 [--ref=REF] [--desc=DESC] [--till]');
    process.exit(1);
  }

  try {
    const fn = args.till ? safaricom.stkPushWithTill : safaricom.stkPush;
    const res = await fn(phone, amount, ref, desc);
    console.log('STK Push response:');
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error initiating STK Push:', err.message || err);
    process.exit(2);
  }
}

main();
