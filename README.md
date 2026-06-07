# Navin Nati - Complete MVP

An anonymous, privacy-focused WhatsApp communication relay built with Node.js, Express, Firebase, and the WhatsApp Cloud API.

## Features
- **Phone Number Privacy**: Users never see each other's numbers. Messages are relayed.
- **State Machine**: Guided user flows (WAITING_NUMBER -> REQUEST -> ACCEPT -> CHAT).
- **Automated Limits & Paywalls**: 10 msgs/day and 3 invites/day limit on free tier.
- **Admin Commands**: Direct WhatsApp integration for admin to approve payments and receive reports.

## Setup & Deployment (Render)

1. Push this repository to GitHub.
2. In [Render](https://render.com), create a new **Web Service** and connect your repo.
3. Add the following **Environment Variables** in the Render dashboard:
   - `VERIFY_TOKEN`: A string of your choice to verify the WhatsApp Webhook.
   - `TOKEN`: Your permanent WhatsApp Cloud API Access Token.
   - `PHONE_NUMBER_ID`: Found in your Meta Developer Dashboard.
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`: Found in Meta Dashboard.
   - `FIREBASE_CONFIG`: A compressed, stringified JSON of your Firebase Admin Service Account Key.
   - `ADMIN_NUMBER`: Your admin phone number (Format: `918308401528`).
   - `UPI_ID`: Your UPI ID for payments.
   - `PAYMENT_QR_URL`: A URL pointing to an image of your payment QR code.

4. Once deployed, copy your Render URL.
5. Go to your Meta Developer App -> WhatsApp -> Configuration.
6. Set the Webhook URL to: `https://your-render-app-url.onrender.com/webhook`
7. Set the Verify Token to match the `VERIFY_TOKEN` you set in Render.
8. Subscribe to the `messages` webhook field.

## Database (Firestore)
The app will automatically create the required collections (`users`, `messages`, `reports`, `customerCare`) as data flows in.

## Admin Commands via WhatsApp
Send the following directly from your `ADMIN_NUMBER` to the bot:
- `CONFIRM 919xxxxxxxxx DAY` - Approves a 1-day plan.
- `CONFIRM 919xxxxxxxxx MONTH` - Approves a 30-day plan.
- `REJECT 919xxxxxxxxx` - Rejects payment.
