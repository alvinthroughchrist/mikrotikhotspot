# MikroTik Hotspot with Safaricom Billing

This repository provides a sample Node.js billing portal for a MikroTik Hotspot that uses Safaricom M-PESA STK push payments to generate hotspot voucher access.

## What is included

- `server.js`: Payment portal and callback handling
- `safaricom.js`: Safaricom Daraja STK push integration
- `mikrotik.js`: RouterOS API helper to add hotspot users
- `config.example.json`: Example configuration for Safaricom and RouterOS
- `.gitignore`: Standard Node.js ignores

## Features

- Initiate M-PESA payment from a hotspot portal
- Receive and process Safaricom callback
- Automatically create MikroTik hotspot user accounts after payment
- Provide voucher credentials to the paid user

## Setup

1. Copy the example configuration:

```bash
cp config.example.json config.json
```

2. Set values in `config.json`:

- `safaricom.consumerKey`
- `safaricom.consumerSecret`
- `safaricom.shortCode`
- `safaricom.passKey`
- `safaricom.callbackUrl`
- `routeros.host`
- `routeros.port`
- `routeros.user`
- `routeros.password`
- `routeros.hotspotProfile`

3. Install dependencies:

```bash
npm install
```

4. Run the server:

```bash
npm start
```

5. Open the portal in a browser:

```text
http://localhost:3000
```

## MikroTik Configuration Notes

- Configure the MikroTik hotspot normally using RouterOS.
- Ensure API access is enabled and the RouterOS user has permission to modify `/ip hotspot user`.
- Use `routeros.hotspotProfile` to match the hotspot user profile you want to assign.
- If you want the hotspot login page to redirect to this portal, customize the hotspot login page to point users at the portal URL.

## Safaricom Requirements

- Use sandbox credentials for local testing.
- The callback URL must be reachable by Safaricom (HTTPS in production, or use a tunnel such as ngrok for local development).
- `callbackUrl` should point to `/mpesa/callback` on your running service.

## Usage

1. A user visits the portal and enters their phone number.
2. The portal sends an STK push to the user’s phone.
3. Safaricom sends the payment result to `/mpesa/callback`.
4. The service creates a MikroTik hotspot user and stores a voucher.
5. The user checks `/status/:merchantRequestID` to view credentials after payment.

## RouterOS Hotspot Login Page Integration

You can configure your MikroTik hotspot login page to redirect users to this billing portal.

If your service is reachable at `http://localhost:3000` (or a public host), set the hotspot login URL to:

```text
http://<portal-host>/login
```

The portal exposes `/login` as a simple hotspot login landing page. When RouterOS sends users there, it will show a continue link to the payment portal.

Alternatively, you can use the sample RouterOS login page at `public/hotspot-login.html` and customize the button URL to your actual portal host.

- Use `config.server.baseUrl` to make sure the portal URL is correct.
- For local development behind NAT, use a tunnel like `ngrok` and set `callbackUrl` to the public tunnel URL.

## Notes

- This is a sample implementation. In production, add persistent storage, secure HTTPS, and stronger error handling.
- If you plan to use the portal from the MikroTik hotspot login page, set the login page to include a link or redirect to the portal.
