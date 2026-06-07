const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

/* =====================================================
   NAVIN NATI - WHATSAPP PRIVACY CHAT PLATFORM
   Text chat only. Payment QR image allowed.
   Bot controls only via WhatsApp buttons/list selections.
   Typed text during active chat is relayed as user message.
===================================================== */

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const TOKEN = process.env.TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const ADMIN_NUMBER = normalizePhone(process.env.ADMIN_NUMBER || "");

const TEMPLATE_NAME = process.env.TEMPLATE_NAME || "navin_nati";
const TEMPLATE_LANGUAGE = process.env.TEMPLATE_LANGUAGE || "en";

const PAYMENT_QR_19_URL = process.env.PAYMENT_QR_19_URL || "";
const PAYMENT_QR_100_URL = process.env.PAYMENT_QR_100_URL || "";

const FIREBASE_CONFIG = process.env.FIREBASE_CONFIG;

if (!VERIFY_TOKEN || !TOKEN || !PHONE_NUMBER_ID || !FIREBASE_CONFIG) {
  console.warn("Missing important environment variables. Please check Render environment.");
}

const firebaseConfig = JSON.parse(FIREBASE_CONFIG);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(firebaseConfig),
  });
}

const db = admin.firestore();
const PORT = process.env.PORT || 3000;

const FREE_DAILY_MESSAGES = 10;
const FREE_DAILY_INVITES = 3;
const MAX_PENDING_REQUESTS = 5;

const DAY_PLAN_MS = 24 * 60 * 60 * 1000;
const MONTH_PLAN_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/* =====================================================
   BASIC ROUTES
===================================================== */

app.get("/", (req, res) => {
  res.send("Navin Nati Running");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* =====================================================
   UTILITIES
===================================================== */

function normalizePhone(number) {
  if (!number) return null;

  let phone = String(number).replace(/\D/g, "");

  if (phone.startsWith("91") && phone.length === 12) return phone;
  if (phone.length === 10) return "91" + phone;

  return null;
}

function now() {
  return Date.now();
}

function todayKeyIST() {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function cleanText(text) {
  return (text || "").toString().trim();
}

function lower(text) {
  return cleanText(text).toLowerCase();
}

function isPaid(user) {
  return Boolean(user.plan && user.plan !== "free" && user.planExpiry && user.planExpiry > now());
}

function getPlanLabel(plan) {
  return plan === "month" ? "₹100 Monthly Plan" : "₹19 Day Plan";
}

function safeTitle(title) {
  // WhatsApp button title limit is 20 characters.
  return title.substring(0, 20);
}

/* =====================================================
   WHATSAPP SEND HELPERS
===================================================== */

async function sendText(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("SEND TEXT ERROR:", JSON.stringify(err.response?.data || err.message));
  }
}

async function sendButtons(to, body, buttons) {
  try {
    const safeButtons = buttons.slice(0, 3).map((b, index) => ({
      type: "reply",
      reply: {
        id: b.id || `BTN_${index + 1}`,
        title: safeTitle(b.title),
      },
    }));

    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: { buttons: safeButtons },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("SEND BUTTON ERROR:", JSON.stringify(err.response?.data || err.message));
    await sendText(to, `${body}\n\n${buttons.map((b) => b.title).join("\n")}`);
  }
}

async function sendListMenu(to) {
  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          header: { type: "text", text: "Navin Nati" },
          body: {
            text:
              "📋 Please choose from the following options.\nकृपया नीचे दिए गए विकल्पों में से एक चुनें।",
          },
          footer: { text: "Private & Secure Communication" },
          action: {
            button: "Open Menu",
            sections: [
              {
                title: "Navin Nati Menu",
                rows: [
                  { id: "MENU_ABOUT", title: "About", description: "About Navin Nati" },
                  { id: "MENU_REQUESTS", title: "View Requests", description: "Pending chat requests" },
                  { id: "MENU_RECENT", title: "Recent Chats", description: "Reconnect with last 5 chats" },
                  { id: "MENU_END", title: "End Chat", description: "End current chat only" },
                  { id: "MENU_BLOCK", title: "Block User", description: "Block current chat user" },
                  { id: "MENU_REPORT", title: "Report User", description: "Report misuse" },
                  { id: "MENU_CARE", title: "Customer Care", description: "Contact support" },
                  { id: "MENU_RECHARGE", title: "Recharge", description: "₹19 or ₹100 plan" },
                  { id: "MENU_START", title: "Start Again", description: "Begin new request" },
                ],
              },
            ],
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("SEND LIST MENU ERROR:", JSON.stringify(err.response?.data || err.message));
    await sendText(
      to,
      `📋 NAVIN NATI MENU\n\nABOUT\nREQUESTS\nEND\nBLOCK\nREPORT\nCUSTOMER CARE\nRECHARGE\nSTART`
    );
  }
}

async function sendImage(to, imageUrl, caption = "") {
  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: {
          link: imageUrl,
          caption,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("SEND IMAGE ERROR:", JSON.stringify(err.response?.data || err.message));
    await sendText(to, caption || "QR image could not be sent. Please contact Customer Care.");
  }
}

async function sendTemplateInvite(to) {
  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: TEMPLATE_NAME,
          language: { code: TEMPLATE_LANGUAGE },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("SEND TEMPLATE ERROR:", JSON.stringify(err.response?.data || err.message));
  }
}

async function notifyAdmin(message) {
  if (ADMIN_NUMBER) await sendText(ADMIN_NUMBER, message);
}

async function sendAdminPaymentButtons(userPhone, plan) {
  await sendButtons(
    ADMIN_NUMBER,
    `💰 Payment Request\n\nUser:\n${userPhone}\n\nPlan:\n${getPlanLabel(plan)}\n\nApprove or reject?`,
    [
      { id: `ADMIN_PAY_CONFIRM_${userPhone}`, title: "Confirm" },
      { id: `ADMIN_PAY_REJECT_${userPhone}`, title: "Reject" },
    ]
  );
}

/* =====================================================
   FIREBASE USER HELPERS
===================================================== */

async function getUser(phone) {
  const ref = db.collection("users").doc(phone);
  const snap = await ref.get();

  if (!snap.exists) {
    const user = {
      phone,
      state: "NEW",
      activeChatPartner: null,
      lastActiveChatPartner: null,
      recentChats: [],
      tempReceiver: null,
      relationshipType: null,
      blockedUsers: [],
      dailyMessages: 0,
      dailyKey: todayKeyIST(),
      invitationsToday: 0,
      inviteKey: todayKeyIST(),
      plan: "free",
      planExpiry: null,
      requestedPlan: null,
      waitingCustomerCare: false,
      createdAt: now(),
      lastActivity: now(),
    };

    await ref.set(user);
    return user;
  }

  return snap.data();
}

async function updateUser(phone, data) {
  await db.collection("users").doc(phone).set(data, { merge: true });
}

async function resetDailyIfNeeded(phone, user) {
  const today = todayKeyIST();
  const updates = {};

  if (user.dailyKey !== today) {
    updates.dailyKey = today;
    updates.dailyMessages = 0;
  }

  if (user.inviteKey !== today) {
    updates.inviteKey = today;
    updates.invitationsToday = 0;
  }

  if (Object.keys(updates).length) {
    await updateUser(phone, updates);
    return { ...user, ...updates };
  }

  return user;
}

/* =====================================================
   WELCOME / ABOUT / PAYMENT SCREENS
===================================================== */

async function sendWelcome(phone) {
  await sendButtons(
    phone,
    `👋 Welcome to Navin Nati\n\nA new trusted platform that connects people.\nलोगों को जोड़ने वाला भरोसेमंद प्लेटफॉर्म।\n\n🔒 Your messages are private.\n🔒 Block and Report options are available for your safety.\n\n🔒 आपके संदेश निजी रहेंगे।\n🔒 आपकी सुरक्षा के लिए Block और Report विकल्प उपलब्ध हैं।\n\nPlease choose an option below.\nकृपया नीचे दिए गए विकल्पों में से एक चुनें।`,
    [
      { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]
  );
}

async function askForNumber(phone) {
  await updateUser(phone, {
    state: "WAITING_NUMBER",
    activeChatPartner: null,
    tempReceiver: null,
    relationshipType: null,
    waitingCustomerCare: false,
  });

  await sendButtons(
    phone,
    `Please enter the WhatsApp number of the friend you want to talk to without showing your mobile number.\n\nअपना मोबाइल नंबर दिखाए बिना जिस मित्र से बात करना चाहते हैं, उसका WhatsApp नंबर भेजें।\n\nExample:\n9876543210\nor\n919876543210`,
    [{ id: "ACTION_OPEN_MENU", title: "Menu" }]
  );
}

async function sendAbout(phone) {
  await sendButtons(
    phone,
    `ℹ️ About Navin Nati\n\nNavin Nati helps known people connect privately on WhatsApp.\n\n🔒 Phone numbers remain hidden.\n🔒 मोबाइल नंबर छुपे रहते हैं।\n\n🔒 Messages are relayed through Navin Nati.\n🔒 संदेश Navin Nati के माध्यम से जाते हैं।\n\nSafety options:\nEnd Chat, Block, Report, Customer Care\n\nMVP supports text messages only.\nअभी केवल text messages support हैं।`,
    [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
      { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
    ]
  );
}

async function sendRechargeOptions(phone, limitMessage = false) {
  const body = limitMessage
    ? `📢 You have used your 10 free messages today.\n\nआज के 10 free message उपयोग हो चुके हैं।\n\nChoose a plan to continue.\nजारी रखने के लिए plan चुनें।`
    : `💳 Recharge Plans\n\n₹19 - Day Plan\n₹100 - Monthly Plan\n\nChoose one option.\nएक option चुनें।`;

  await sendButtons(phone, body, [
    { id: "PAY_PLAN_19", title: "₹19 Day Plan" },
    { id: "PAY_PLAN_100", title: "₹100 Monthly" },
    { id: "ACTION_OPEN_MENU", title: "Menu" },
  ]);
}

async function sendFiveMessageWarning(phone) {
  await sendButtons(
    phone,
    `📢 Free Limit Update\n\nYou have used 5 of your 10 free messages today.\n\nआज के 10 free messages में से 5 messages उपयोग हो चुके हैं।`,
    [
      { id: "ACTION_CONTINUE_CHAT", title: "Continue Chat" },
      { id: "ACTION_RECHARGE", title: "Recharge" },
    ]
  );
}

async function sendPaymentQR(phone, plan) {
  const isMonth = plan === "month";
  const qrUrl = isMonth ? PAYMENT_QR_100_URL : PAYMENT_QR_19_URL;

  await updateUser(phone, {
    requestedPlan: plan,
    state: "PAYMENT_PENDING",
  });

  const caption = `💳 Navin Nati Payment\n\n${getPlanLabel(plan)}\n\nScan QR and pay.\nQR scan करके payment करें।\n\nAfter payment tap PAID.\nPayment के बाद PAID दबाएं।`;

  if (qrUrl) {
    await sendImage(phone, qrUrl, caption);
  } else {
    await sendText(phone, `${caption}\n\nQR image is not configured. Please contact Customer Care.`);
  }

  await sendButtons(phone, `After payment, tap PAID.\nPayment के बाद PAID दबाएं।`, [
    { id: "PAYMENT_PAID", title: "PAID" },
    { id: "ACTION_OPEN_MENU", title: "Menu" },
  ]);
}

/* =====================================================
   REQUEST / CHAT HELPERS
===================================================== */

async function createRequest(sender, receiver, relationship) {
  const ref = db.collection("requests").doc();
  const requestId = ref.id;

  await ref.set({
    requestId,
    sender,
    receiver,
    relationship,
    status: "pending",
    createdAt: now(),
    lastActivity: now(),
  });

  return requestId;
}

async function getPendingRequests(phone) {
  // Single-field query avoids composite index problems.
  const snap = await db.collection("requests").where("receiver", "==", phone).get();

  return snap.docs
    .map((d) => d.data())
    .filter((r) => r.status === "pending")
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

async function isBlocked(sender, receiver) {
  const receiverUser = await getUser(receiver);
  return (receiverUser.blockedUsers || []).includes(sender);
}


async function saveRecentChat(userPhone, partnerPhone) {
  const user = await getUser(userPhone);
  const existing = Array.isArray(user.recentChats) ? user.recentChats : [];

  const filtered = existing.filter((item) => item.partner !== partnerPhone);

  const updated = [
    {
      partner: partnerPhone,
      lastChatAt: now(),
    },
    ...filtered,
  ].slice(0, 5);

  await updateUser(userPhone, {
    recentChats: updated,
    lastActiveChatPartner: partnerPhone,
  });
}

async function showRecentChats(phone) {
  const user = await getUser(phone);
  const recentChats = Array.isArray(user.recentChats) ? user.recentChats : [];

  if (!recentChats.length) {
    await sendButtons(
      phone,
      `🕘 No recent chats found.\nअभी कोई recent chat नहीं है।`,
      [
        { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
        { id: "ACTION_OPEN_MENU", title: "Menu" },
      ]
    );
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "interactive",
        interactive: {
          type: "list",
          header: { type: "text", text: "Recent Chats" },
          body: {
            text:
              "🕘 Choose a previous chat to reconnect.\nपुरानी chat से दोबारा जुड़ने के लिए option चुनें।",
          },
          footer: { text: "Phone numbers remain hidden" },
          action: {
            button: "Open Recent",
            sections: [
              {
                title: "Last 5 Chats",
                rows: recentChats.map((item, index) => ({
                  id: `RECENT_CHAT_${index}`,
                  title: `Previous Chat ${index + 1}`,
                  description: "Send reconnect request",
                })),
              },
            ],
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("SEND RECENT CHATS ERROR:", JSON.stringify(err.response?.data || err.message));
    await sendButtons(
      phone,
      `🕘 Recent chats are available.\nPlease try again or use Menu.`,
      [
        { id: "ACTION_OPEN_MENU", title: "Menu" },
        { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
      ]
    );
  }
}

async function reconnectRecentChat(phone, controlId) {
  const index = Number(String(controlId).replace("RECENT_CHAT_", ""));
  const user = await getUser(phone);
  const recentChats = Array.isArray(user.recentChats) ? user.recentChats : [];

  if (!Number.isInteger(index) || index < 0 || index >= recentChats.length) {
    await sendButtons(
      phone,
      `Recent chat not found.\nRecent chat नहीं मिली।`,
      [
        { id: "MENU_RECENT", title: "Recent Chats" },
        { id: "ACTION_OPEN_MENU", title: "Menu" },
      ]
    );
    return;
  }

  const receiver = recentChats[index].partner;

  if (!receiver) {
    await sendButtons(phone, `Recent chat not found.`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  if (await isBlocked(phone, receiver)) {
    await sendButtons(phone, `❌ This request cannot be delivered.`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  const receiverPending = await getPendingRequests(receiver);
  if (receiverPending.length >= MAX_PENDING_REQUESTS) {
    await sendButtons(phone, `This person is currently unavailable. Please try later.`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  if (!isPaid(user) && (user.invitationsToday || 0) >= FREE_DAILY_INVITES) {
    await sendRechargeOptions(phone, false);
    return;
  }

  await createRequest(phone, receiver, "Previous Chat");
  await notifyReceiver(phone, receiver, "Previous Chat");

  await updateUser(phone, {
    state: user.activeChatPartner ? user.state : "WAITING_RESPONSE",
    invitationsToday: (user.invitationsToday || 0) + 1,
    lastActivity: now(),
  });

  await sendButtons(
    phone,
    `✅ Reconnect request sent.\nReconnect request भेज दी गई है।\n\nYour current chat, if any, will continue normally.`,
    [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
      { id: "MENU_RECENT", title: "Recent Chats" },
    ]
  );
}

async function createChat(user1, user2) {
  const chatId = [user1, user2].sort().join("_");

  await db.collection("activeChats").doc(chatId).set({
    chatId,
    user1,
    user2,
    status: "active",
    createdAt: now(),
    lastActivity: now(),
  });

  await updateUser(user1, {
    activeChatPartner: user2,
    lastActiveChatPartner: user2,
    state: "ACTIVE_CHAT",
    lastActivity: now(),
  });

  await updateUser(user2, {
    activeChatPartner: user1,
    lastActiveChatPartner: user1,
    state: "ACTIVE_CHAT",
    lastActivity: now(),
  });

  await saveRecentChat(user1, user2);
  await saveRecentChat(user2, user1);

  return chatId;
}

async function endChat(phone, notifyPartner = true) {
  const user = await getUser(phone);

  if (!user.activeChatPartner) {
    await updateUser(phone, { state: "WAITING_NUMBER" });
    return;
  }

  const partner = user.activeChatPartner;
  const chatId = [phone, partner].sort().join("_");

  await updateUser(phone, {
    activeChatPartner: null,
    lastActiveChatPartner: partner,
    state: "WAITING_NUMBER",
    lastActivity: now(),
  });

  await updateUser(partner, {
    activeChatPartner: null,
    lastActiveChatPartner: phone,
    state: "WAITING_NUMBER",
    lastActivity: now(),
  });

  await db.collection("activeChats").doc(chatId).set(
    {
      status: "ended",
      endedAt: now(),
      lastActivity: now(),
    },
    { merge: true }
  );

  if (notifyPartner) {
    await sendButtons(
      partner,
      `🚪 Current chat ended by the other user.\nदूसरे user ने chat end कर दी है।`,
      [
        { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
        { id: "ACTION_OPEN_MENU", title: "Menu" },
      ]
    );
  }
}

async function notifyReceiver(sender, receiver, relationship) {
  await sendTemplateInvite(receiver);

  const receiverUser = await getUser(receiver);

  if (receiverUser.activeChatPartner) {
    await sendButtons(
      receiver,
      `📩 New Chat Request Received\n\nYour current chat continues normally.\nआपकी current chat जारी रहेगी।\n\nOpen menu and choose View Requests.`,
      [
        { id: "ACTION_OPEN_MENU", title: "Menu" },
        { id: "MENU_REQUESTS", title: "Requests" },
      ]
    );
  }
}

/* =====================================================
   BLOCK / REPORT / CUSTOMER CARE
===================================================== */

async function checkAbuseFlag(phone) {
  const snap = await db.collection("blockedUsers").where("blocked", "==", phone).get();
  const blockers = new Set();

  snap.docs.forEach((d) => blockers.add(d.data().blocker));

  if (blockers.size >= 3) {
    await db.collection("flags").add({
      user: phone,
      reason: "Blocked by 3 different users",
      createdAt: now(),
    });

    await notifyAdmin(`⚠️ Abuse Alert\n\nUser flagged:\n${phone}\n\nReason:\nBlocked by 3 different users.`);
  }
}

async function blockCurrentUser(phone, user) {
  if (!user.activeChatPartner) {
    await sendButtons(phone, `No active chat to block.\nBlock करने के लिए active chat नहीं है।`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  const partner = user.activeChatPartner;
  const blocked = user.blockedUsers || [];
  if (!blocked.includes(partner)) blocked.push(partner);

  await updateUser(phone, { blockedUsers: blocked });

  await db.collection("blockedUsers").add({
    blocker: phone,
    blocked: partner,
    createdAt: now(),
  });

  await endChat(phone, false);

  await sendButtons(
    phone,
    `⛔ User blocked.\n\nCurrent chat ended.\nFuture requests from this person will not be delivered.\n\nUser block हो गया है।\nइस व्यक्ति की future requests deliver नहीं होंगी।`,
    [
      { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]
  );

  await checkAbuseFlag(partner);
}

async function reportCurrentUser(phone, user, blockToo = false) {
  if (!user.activeChatPartner) {
    await sendButtons(phone, `No active chat to report.\nReport करने के लिए active chat नहीं है।`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  const reported = user.activeChatPartner;

  await db.collection("reports").add({
    reporter: phone,
    reportedUser: reported,
    blockToo,
    createdAt: now(),
  });

  await notifyAdmin(
    `🚨 User Report\n\nReporter:\n${phone}\n\nReported:\n${reported}\n\nBlock also:\n${blockToo ? "YES" : "NO"}`
  );

  if (blockToo) {
    await blockCurrentUser(phone, user);
  } else {
    await sendButtons(phone, `✅ Report submitted to Navin Nati admin.\nReport admin को भेज दी गई है।`, [
      { id: "MENU_BLOCK", title: "Block User" },
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
  }
}

async function startCustomerCare(phone) {
  await updateUser(phone, { waitingCustomerCare: true });

  await sendText(
    phone,
    `🎧 Customer Care\n\nPlease type your message.\nकृपया अपना message type करें।\n\nAdmin number will not be shown.\nAdmin number नहीं दिखेगा।`
  );
}

async function handleCustomerCare(phone, text, user, isControl) {
  if (!user.waitingCustomerCare) return false;

  if (isControl) {
    await updateUser(phone, { waitingCustomerCare: false });
    return false;
  }

  await db.collection("customerCare").add({
    user: phone,
    message: text,
    createdAt: now(),
  });

  await notifyAdmin(`🎧 Customer Care Message\n\nUser:\n${phone}\n\nMessage:\n${text}`);

  await updateUser(phone, { waitingCustomerCare: false });

  await sendButtons(phone, `✅ Your message has been sent to Customer Care.\nआपका message Customer Care को भेज दिया गया है।`, [
    { id: "ACTION_OPEN_MENU", title: "Menu" },
    { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
  ]);

  return true;
}

/* =====================================================
   MENU / CONTROL HANDLERS
===================================================== */

async function showRequests(phone) {
  const requests = await getPendingRequests(phone);

  if (!requests.length) {
    await sendButtons(phone, `📭 No pending requests.\nकोई pending request नहीं है।`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
      { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
    ]);
    return;
  }

  let msg = `📩 Pending Requests\nPending requests:\n\n`;
  requests.forEach((r, i) => {
    msg += `${i + 1}. ${r.relationship}\n`;
  });

  msg += `\nOldest request will be handled first.\nसबसे पुरानी request पहले handle होगी।`;

  await sendButtons(phone, msg, [
    { id: "REQ_ACCEPT", title: "Accept" },
    { id: "REQ_REJECT", title: "Reject" },
    { id: "ACTION_OPEN_MENU", title: "Menu" },
  ]);
}

async function handleAdminPaymentDecision(phone, controlId) {
  if (phone !== ADMIN_NUMBER) return false;

  if (!controlId.startsWith("ADMIN_PAY_CONFIRM_") && !controlId.startsWith("ADMIN_PAY_REJECT_")) return false;

  const confirm = controlId.startsWith("ADMIN_PAY_CONFIRM_");
  const target = normalizePhone(controlId.replace("ADMIN_PAY_CONFIRM_", "").replace("ADMIN_PAY_REJECT_", ""));

  if (!target) {
    await sendText(phone, "Target user not found.");
    return true;
  }

  const targetUser = await getUser(target);

  if (confirm) {
    const plan = targetUser.requestedPlan || "day";
    const expiry = now() + (plan === "month" ? MONTH_PLAN_MS : DAY_PLAN_MS);

    await updateUser(target, {
      plan,
      planExpiry: expiry,
      requestedPlan: null,
      state: targetUser.lastActiveChatPartner ? "ACTIVE_CHAT" : "WAITING_NUMBER",
      activeChatPartner: targetUser.lastActiveChatPartner || null,
    });

    await db.collection("payments").add({
      user: target,
      plan,
      status: "approved",
      approvedAt: now(),
      approvedBy: phone,
    });

    await sendButtons(
      target,
      `✅ Payment Approved\n\nYour plan is now active.\nEnjoy unlimited messaging.\n\nPayment approve हो गया है।\nअब unlimited messaging शुरू है।`,
      [
        { id: "ACTION_CONTINUE_CHAT", title: "Continue Chat" },
        { id: "ACTION_OPEN_MENU", title: "Menu" },
      ]
    );

    await sendText(phone, "Payment approved and user updated.");
    return true;
  }

  await updateUser(target, {
    requestedPlan: null,
    state: "WAITING_NUMBER",
  });

  await db.collection("payments").add({
    user: target,
    status: "rejected",
    rejectedAt: now(),
    rejectedBy: phone,
  });

  await sendButtons(
    target,
    `❌ Payment could not be verified.\nPayment verify नहीं हो पाया।\n\nPlease contact Customer Care if needed.`,
    [
      { id: "MENU_CARE", title: "Customer Care" },
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]
  );

  await sendText(phone, "Payment rejected and user notified.");
  return true;
}

async function handleControl(phone, controlId, rawTitle, user) {
  if (await handleAdminPaymentDecision(phone, controlId)) return true;

  if (String(controlId).startsWith("RECENT_CHAT_")) {
    await reconnectRecentChat(phone, controlId);
    return true;
  }

  switch (controlId) {
    case "ACTION_OPEN_MENU":
    case "MENU":
    case "MENU_MAIN":
      await sendListMenu(phone);
      return true;

    case "ACTION_START_PRIVATE_CHAT":
    case "MENU_START":
      await askForNumber(phone);
      return true;

    case "MENU_ABOUT":
      await sendAbout(phone);
      return true;

    case "MENU_REQUESTS":
      await showRequests(phone);
      return true;

    case "MENU_RECENT":
      await showRecentChats(phone);
      return true;

    case "MENU_END":
      await endChat(phone, true);
      await sendButtons(phone, `✅ Current chat ended.\nCurrent chat end हो गई है।`, [
        { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
        { id: "ACTION_OPEN_MENU", title: "Menu" },
      ]);
      return true;

    case "MENU_BLOCK":
      await blockCurrentUser(phone, user);
      return true;

    case "MENU_REPORT":
      await sendButtons(phone, `⚠️ Report User\n\nChoose an option.\nएक option चुनें।`, [
        { id: "REPORT_ONLY", title: "Report Only" },
        { id: "REPORT_BLOCK", title: "Report + Block" },
        { id: "ACTION_OPEN_MENU", title: "Menu" },
      ]);
      return true;

    case "REPORT_ONLY":
      await reportCurrentUser(phone, user, false);
      return true;

    case "REPORT_BLOCK":
      await reportCurrentUser(phone, user, true);
      return true;

    case "MENU_CARE":
      await startCustomerCare(phone);
      return true;

    case "MENU_RECHARGE":
    case "ACTION_RECHARGE":
      await sendRechargeOptions(phone, false);
      return true;

    case "PAY_PLAN_19":
      await sendPaymentQR(phone, "day");
      return true;

    case "PAY_PLAN_100":
      await sendPaymentQR(phone, "month");
      return true;

    case "PAYMENT_PAID": {
      const freshUser = await getUser(phone);
      const plan = freshUser.requestedPlan || "day";

      await db.collection("payments").add({
        user: phone,
        plan,
        status: "pending",
        createdAt: now(),
      });

      if (ADMIN_NUMBER) await sendAdminPaymentButtons(phone, plan);

      await sendButtons(phone, `✅ Payment request sent to admin.\nPayment request admin को भेज दी गई है।\n\nPlease wait for approval.`, [
        { id: "ACTION_OPEN_MENU", title: "Menu" },
        { id: "MENU_CARE", title: "Customer Care" },
      ]);
      return true;
    }

    case "ACTION_CONTINUE_CHAT": {
      const freshUser = await getUser(phone);
      if (freshUser.activeChatPartner) {
        await sendText(phone, "💬 Continue chatting.\nआप chat जारी रख सकते हैं।");
      } else if (freshUser.lastActiveChatPartner) {
        await updateUser(phone, { activeChatPartner: freshUser.lastActiveChatPartner, state: "ACTIVE_CHAT" });
        await sendText(phone, "💬 Last chat restored. You can continue.\nLast chat continue हो गई है।");
      } else {
        await askForNumber(phone);
      }
      return true;
    }

    case "REQ_ACCEPT":
      await acceptOldestRequest(phone, rawTitle || "Accepted");
      return true;

    case "REQ_REJECT":
      await rejectOldestRequest(phone);
      return true;

    case "KNOW_YES":
      await proceedKnowYes(phone);
      return true;

    case "KNOW_NO":
      await proceedKnowNo(phone);
      return true;

    case "REL_RELATIVE":
      await selectRelationship(phone, "Relative");
      return true;

    case "REL_FRIEND":
      await selectRelationship(phone, "Friend");
      return true;

    case "REL_KNOWN":
      await selectRelationship(phone, "I Know Them");
      return true;

    case "SEND_REQUEST":
      await sendPreparedRequest(phone);
      return true;

    default:
      // Template buttons may not carry our custom IDs, so use title fallback.
      return await handleTemplateButtonByTitle(phone, rawTitle || controlId, user);
  }
}

async function handleTemplateButtonByTitle(phone, title, user) {
  const t = lower(title);

  if (t.includes("menu") || t.includes("मेनू")) {
    await sendListMenu(phone);
    return true;
  }

  if (t.includes("don't want") || t.includes("dont want") || t.includes("बात नहीं")) {
    await rejectOldestRequest(phone);
    return true;
  }

  if (t.includes("who are you") || t.includes("name") || t.includes("नाम") || t.includes("hi")) {
    await acceptOldestRequest(phone, title);
    return true;
  }

  return false;
}

/* =====================================================
   REQUEST FLOW
===================================================== */

async function proceedKnowYes(phone) {
  const user = await getUser(phone);

  if (!user.tempReceiver) {
    await askForNumber(phone);
    return;
  }

  await updateUser(phone, { state: "RELATIONSHIP_SELECTION" });

  await sendButtons(phone, `Who is this person?\nयह व्यक्ति कौन है?`, [
    { id: "REL_RELATIVE", title: "Relative" },
    { id: "REL_FRIEND", title: "Friend" },
    { id: "REL_KNOWN", title: "I Know Them" },
  ]);
}

async function proceedKnowNo(phone) {
  await updateUser(phone, { tempReceiver: null, state: "WAITING_NUMBER" });

  await sendButtons(
    phone,
    `⚠️ Navin Nati only allows requests to people you know.\nNavin Nati पर केवल परिचित लोगों को request भेजें।`,
    [
      { id: "ACTION_START_PRIVATE_CHAT", title: "Start Again" },
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]
  );
}

async function selectRelationship(phone, relation) {
  await updateUser(phone, {
    relationshipType: relation,
    state: "READY_TO_SEND",
  });

  await sendButtons(
    phone,
    `✅ Request Ready\n\nRelationship:\n${relation}\n\nSend request?\nRequest भेजें?`,
    [
      { id: "SEND_REQUEST", title: "Send" },
      { id: "ACTION_START_PRIVATE_CHAT", title: "Start Again" },
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]
  );
}

async function sendPreparedRequest(phone) {
  const freshUser = await getUser(phone);
  const receiver = freshUser.tempReceiver;
  const relationship = freshUser.relationshipType;

  if (!receiver || !relationship) {
    await askForNumber(phone);
    return;
  }

  if (await isBlocked(phone, receiver)) {
    await sendButtons(phone, `❌ This request cannot be delivered.`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  const receiverPending = await getPendingRequests(receiver);
  if (receiverPending.length >= MAX_PENDING_REQUESTS) {
    await sendButtons(phone, `This person is currently unavailable. Please try later.`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  if (!isPaid(freshUser) && (freshUser.invitationsToday || 0) >= FREE_DAILY_INVITES) {
    await sendRechargeOptions(phone, false);
    return;
  }

  await createRequest(phone, receiver, relationship);
  await notifyReceiver(phone, receiver, relationship);

  await updateUser(phone, {
    state: "WAITING_RESPONSE",
    invitationsToday: (freshUser.invitationsToday || 0) + 1,
    lastActivity: now(),
  });

  await sendButtons(
    phone,
    `✅ Request sent.\nRequest भेज दी गई है।\n\nYou will be notified when the person responds.`,
    [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
      { id: "ACTION_START_PRIVATE_CHAT", title: "Start Again" },
    ]
  );
}

async function handleNumberInput(phone, text, user) {
  if (user.state !== "WAITING_NUMBER" && user.state !== "NEW") return false;

  const receiver = normalizePhone(text);

  if (!receiver) {
    await sendButtons(phone, `❌ Please enter a valid WhatsApp mobile number.\nकृपया सही WhatsApp नंबर भेजें।`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return true;
  }

  if (receiver === phone) {
    await sendButtons(phone, `❌ You cannot chat with yourself.\nआप खुद से chat नहीं कर सकते।`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return true;
  }

  await updateUser(phone, {
    tempReceiver: receiver,
    state: "CONFIRM_KNOW_PERSON",
  });

  await sendButtons(phone, `Do you know this person?\nक्या आप इस व्यक्ति को जानते हैं?`, [
    { id: "KNOW_YES", title: "YES" },
    { id: "KNOW_NO", title: "NO" },
    { id: "ACTION_OPEN_MENU", title: "Menu" },
  ]);

  return true;
}

async function acceptOldestRequest(phone, firstReply) {
  const requests = await getPendingRequests(phone);

  if (!requests.length) {
    await sendButtons(phone, `No pending requests.\nकोई pending request नहीं है।`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  const request = requests[0];

  if (await isBlocked(request.sender, phone)) {
    await sendButtons(phone, `This request cannot be accepted.`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  const currentUser = await getUser(phone);
  if (currentUser.activeChatPartner) {
    await endChat(phone, true);
  }

  await db.collection("requests").doc(request.requestId).update({
    status: "accepted",
    updatedAt: now(),
  });

  await createChat(request.sender, phone);

  await sendText(
    request.sender,
    `🎉 Good News!\n\nThe other person replied:\n"${firstReply}"\n\nYou can now introduce yourself.\n\n🔒 Mobile numbers remain hidden.`
  );

  await sendButtons(
    phone,
    `✅ Chat started.\nChat शुरू हो गई है।\n\nYou can now chat.\nMENU anytime.`,
    [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
      { id: "MENU_END", title: "End" },
    ]
  );
}

async function rejectOldestRequest(phone) {
  const requests = await getPendingRequests(phone);

  if (!requests.length) {
    await sendButtons(phone, `No pending requests.\nकोई pending request नहीं है।`, [
      { id: "ACTION_OPEN_MENU", title: "Menu" },
    ]);
    return;
  }

  const request = requests[0];

  await db.collection("requests").doc(request.requestId).update({
    status: "rejected",
    updatedAt: now(),
  });

  await sendButtons(phone, `Request closed.\nRequest बंद कर दी गई है।`, [
    { id: "ACTION_OPEN_MENU", title: "Menu" },
    { id: "ACTION_START_PRIVATE_CHAT", title: "Start Again" },
  ]);

  await sendText(request.sender, "Your request could not be completed.");
}

/* =====================================================
   CHAT RELAY / LIMITS
===================================================== */

async function canSendChatMessage(phone, user) {
  if (isPaid(user)) return true;

  const count = user.dailyMessages || 0;

  if (count >= FREE_DAILY_MESSAGES) {
    await sendRechargeOptions(phone, true);
    return false;
  }

  return true;
}

async function relayMessage(phone, text, user) {
  if (!user.activeChatPartner) return false;

  if (!(await canSendChatMessage(phone, user))) return true;

  const partner = user.activeChatPartner;

  await sendText(partner, text);

  await db.collection("messages").add({
    sender: phone,
    receiver: partner,
    message: text,
    createdAt: now(),
  });

  const chatId = [phone, partner].sort().join("_");
  await db.collection("activeChats").doc(chatId).set({ lastActivity: now() }, { merge: true });

  const newCount = (user.dailyMessages || 0) + 1;

  await updateUser(phone, {
    dailyMessages: newCount,
    lastActivity: now(),
  });

  if (newCount === 5 && !isPaid(user)) {
    await sendFiveMessageWarning(phone);
  }

  return true;
}

/* =====================================================
   CLEANUP
===================================================== */

async function cleanupOldData() {
  try {
    const cutoff = now() - THREE_DAYS_MS;

    const oldMessages = await db.collection("messages").where("createdAt", "<", cutoff).get();
    for (const doc of oldMessages.docs) await db.collection("messages").doc(doc.id).delete();

    const oldRequests = await db.collection("requests").where("createdAt", "<", cutoff).get();
    for (const doc of oldRequests.docs) await db.collection("requests").doc(doc.id).delete();

    const oldChats = await db.collection("activeChats").where("lastActivity", "<", cutoff).get();
    for (const doc of oldChats.docs) {
      const chat = doc.data();
      if (chat.user1) await updateUser(chat.user1, { activeChatPartner: null, state: "WAITING_NUMBER" });
      if (chat.user2) await updateUser(chat.user2, { activeChatPartner: null, state: "WAITING_NUMBER" });
      await db.collection("activeChats").doc(doc.id).delete();
    }
  } catch (err) {
    console.error("CLEANUP ERROR:", err.message || err);
  }
}

/* =====================================================
   MESSAGE ROUTER
===================================================== */

async function handleIncomingMessage(incoming) {
  await cleanupOldData();

  const phone = incoming.from;
  const text = cleanText(incoming.text);
  const isControl = incoming.isControl;
  const controlId = incoming.controlId;
  const rawTitle = incoming.rawTitle || text;

  let user = await getUser(phone);
  user = await resetDailyIfNeeded(phone, user);

  await updateUser(phone, { lastActivity: now() });

  await db.collection("incomingLogs").add({
    from: phone,
    text,
    isControl,
    controlId,
    rawTitle,
    createdAt: now(),
  });

  if (isControl) {
    user = await getUser(phone);
    if (await handleControl(phone, controlId, rawTitle, user)) return;
  }

  user = await getUser(phone);
  if (await handleCustomerCare(phone, text, user, isControl)) return;

  // Typed text starts welcome only when not in active chat.
  if (!isControl && user.state !== "ACTIVE_CHAT") {
    const t = lower(text);
    if (user.state === "NEW" || t === "hi" || t === "hello" || t === "start") {
      await sendWelcome(phone);
      return;
    }
  }

  user = await getUser(phone);

  // Only phone number entry is accepted as typed input outside active chat.
  if (!isControl && (user.state === "WAITING_NUMBER" || user.state === "NEW")) {
    if (await handleNumberInput(phone, text, user)) return;
  }

  user = await getUser(phone);

  // During active chat, all typed text is relayed. No text commands.
  if (!isControl && user.state === "ACTIVE_CHAT") {
    if (await relayMessage(phone, text, user)) return;
  }

  if (!isControl) {
    await sendButtons(
      phone,
      `Please choose an option using buttons/menu.\nकृपया button/menu से option चुनें।`,
      [
        { id: "ACTION_OPEN_MENU", title: "Menu" },
        { id: "ACTION_START_PRIVATE_CHAT", title: "Start Chat" },
      ]
    );
  }
}

function extractIncomingMessage(message) {
  if (!message) return null;

  const from = message.from;

  if (message.type === "text") {
    return {
      from,
      text: message.text?.body || "",
      isControl: false,
      controlId: null,
      rawTitle: message.text?.body || "",
    };
  }

  if (message.type === "button") {
    const title = message.button?.text || message.button?.payload || "";
    return {
      from,
      text: title,
      isControl: true,
      controlId: message.button?.payload || title,
      rawTitle: title,
    };
  }

  if (message.type === "interactive") {
    const buttonReply = message.interactive?.button_reply;
    const listReply = message.interactive?.list_reply;

    if (buttonReply) {
      return {
        from,
        text: buttonReply.title || buttonReply.id || "",
        isControl: true,
        controlId: buttonReply.id || buttonReply.title || "",
        rawTitle: buttonReply.title || buttonReply.id || "",
      };
    }

    if (listReply) {
      return {
        from,
        text: listReply.title || listReply.id || "",
        isControl: true,
        controlId: listReply.id || listReply.title || "",
        rawTitle: listReply.title || listReply.id || "",
      };
    }
  }

  return {
    from,
    text: "",
    isControl: false,
    controlId: null,
    rawTitle: "",
    unsupported: true,
  };
}

app.post("/webhook", async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const incoming = extractIncomingMessage(message);
    if (!incoming) return res.sendStatus(200);

    if (incoming.unsupported) {
      await sendText(incoming.from, "⚠️ Currently Navin Nati supports text messages only.\nअभी केवल text messages support हैं।");
      return res.sendStatus(200);
    }

    await handleIncomingMessage(incoming);

    return res.sendStatus(200);
  } catch (err) {
    console.error("WEBHOOK ERROR:", JSON.stringify(err.response?.data || err.message || err));
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Navin Nati running on port ${PORT}`);
});
