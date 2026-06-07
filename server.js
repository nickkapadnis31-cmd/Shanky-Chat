const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

/* =========================
ENV VARIABLES
========================= */

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const TOKEN = process.env.TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;

/* =========================
FIREBASE INIT
========================= */

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);

if (!admin.apps.length) {
admin.initializeApp({
credential: admin.credential.cert(firebaseConfig),
});
}

const db = admin.firestore();

/* =========================
SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
res.send("Navin Nati Running");
});

/* =========================
WEBHOOK VERIFICATION
========================= */

app.get("/webhook", (req, res) => {
const mode = req.query["hub.mode"];
const token = req.query["hub.verify_token"];
const challenge = req.query["hub.challenge"];

if (mode && token) {
if (mode === "subscribe" && token === VERIFY_TOKEN) {
console.log("Webhook Verified");
return res.status(200).send(challenge);
}
}

return res.sendStatus(403);
});

/* =========================
WHATSAPP SEND MESSAGE
========================= */

async function sendText(to, message) {
try {
await axios.post(
'https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages',
{
messaging_product: "whatsapp",
to,
type: "text",
text: {
body: message,
},
},
{
headers: {
Authorization: 'Bearer ${TOKEN}',
"Content-Type": "application/json",
},
}
);
} catch (err) {
console.error(
"SEND ERROR:",
err.response?.data || err.message
);
}
}

/* =========================
USER HELPERS
========================= */

async function getUser(phone) {
const ref = db.collection("users").doc(phone);
const doc = await ref.get();

if (!doc.exists) {
const newUser = {
  phone,

  state: "NEW",

  activeChatPartner: null,

  pendingRequests: [],

  blockedUsers: [],

  dailyMessages: 0,

  invitationsToday: 0,

  plan: "free",

  tempReceiver: null,

  relationshipType: null,

  waitingCustomerCare: false,

  createdAt: Date.now(),

  lastActivity: Date.now()
};

await ref.set(newUser);

return newUser;

}

return doc.data();
}

async function updateUser(phone, data) {
await db.collection("users")
.doc(phone)
.set(data, { merge: true });
}

/* =========================
WELCOME MESSAGE
========================= */

async function sendWelcome(phone) {
const msg =
`👋 Welcome to Navin Nati

🔒 Mobile numbers remain hidden.

🔒 Only you and the person you're chatting with can view the conversation.

🔒 Block and report options are available for your safety.

Please enter the WhatsApp number of someone you know.`;

await sendText(phone, msg);
}

/* =========================
MESSAGE HANDLER
========================= */

async function handleIncomingMessage(phone, text) {

const user = await getUser(phone);

await updateUser(phone, {
lastActivity: Date.now()
});

const msg = text.trim();

/* FIRST TIME USER */

if (
user.state === "NEW" ||
msg.toLowerCase() === "hi" ||
msg.toLowerCase() === "hello" ||
msg.toLowerCase() === "start"
) {

await sendWelcome(phone);

await updateUser(phone, {
  state: "WAITING_NUMBER"
});

return;

}

/* TEMP PLACEHOLDER */

await sendText(
phone,
"System active. Part 2 will handle number validation and relationship selection."
);
}

/* =========================
WEBHOOK RECEIVER
========================= */

app.post("/webhook", async (req, res) => {

try {

const entry =
  req.body?.entry?.[0];

const change =
  entry?.changes?.[0];

const value =
  change?.value;

const message =
  value?.messages?.[0];

if (!message) {
  return res.sendStatus(200);
}

const from = message.from;

if (message.type === "text") {

  const text = message.text.body;

  await handleIncomingMessage(
    from,
    text
  );
} else {

  await sendText(
    from,
    "⚠️ Currently Navin Nati supports text messages only."
  );
}

return res.sendStatus(200);

} catch (err) {

console.error(err);

return res.sendStatus(500);

}
});

/* =========================
START SERVER
========================= */

app.listen(PORT, () => {
console.log(
'Navin Nati running on port ${PORT}'
);
});
