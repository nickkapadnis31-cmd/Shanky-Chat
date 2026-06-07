Navin Nati

WhatsApp privacy-focused chat platform.

Stack

- WhatsApp Cloud API
- Node.js
- Express
- Firebase Firestore
- Render

Features

- Hidden phone numbers
- Text-only chat
- One active chat
- Pending requests
- Block user
- Report user
- Customer care
- Daily free limits
- QR payment flow
- Auto cleanup after 3 days

Environment Variables

VERIFY_TOKEN

TOKEN

PHONE_NUMBER_ID

WHATSAPP_BUSINESS_ACCOUNT_ID

FIREBASE_CONFIG

ADMIN_NUMBER

Deploy

1. Push code to GitHub
2. Create Render Web Service
3. Add environment variables
4. Deploy
5. Configure Meta webhook

Webhook

/webhook

Database

Firestore collections:

users

requests

activeChats

messages

reports

customerCare

payments

blockedUsers

flags
