const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const TOKEN = process.env.TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ADMIN_NUMBER = normalizePhone(process.env.ADMIN_NUMBER || "");
const TEMPLATE_NAME = process.env.TEMPLATE_NAME || "navin_nati";
const TEMPLATE_LANGUAGE = process.env.TEMPLATE_LANGUAGE || "en";
const PAYMENT_QR_URL = process.env.PAYMENT_QR_URL || "";

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);

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

app.get("/", (req, res) => {
  res.send("Navin Nati Running");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

function normalizePhone(number) {
  if (!number) return null;
  let phone = String(number).replace(/\D/g, "");

  if (phone.startsWith("91") && phone.length === 12) return phone;
  if (phone.length === 10) return "91" + phone;

  return null;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function now() {
  return Date.now();
}

function isPaid(user) {
  return user.plan && user.plan !== "free" && user.planExpiry && user.planExpiry > now();
}

function cleanText(text) {
  return (text || "").trim();
}

function lower(text) {
  return cleanText(text).toLowerCase();
}

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
    console.error("SEND TEXT ERROR:", err.response?.data || err.message);
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
    console.error("SEND IMAGE ERROR:", err.response?.data || err.message);
    await sendText(to, caption || "Payment QR is currently unavailable.");
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
          language: {
            code: TEMPLATE_LANGUAGE,
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
    console.error("SEND TEMPLATE ERROR:", err.response?.data || err.message);
  }
}

async function getUser(phone) {
  const ref = db.collection("users").doc(phone);
  const snap = await ref.get();

  if (!snap.exists) {
    const user = {
      phone,
      state: "NEW",
      activeChatPartner: null,
      tempReceiver: null,
      relationshipType: null,
      blockedUsers: [],
      dailyMessages: 0,
      dailyKey: todayKey(),
      invitationsToday: 0,
      inviteKey: todayKey(),
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
  const t = todayKey();
  const updates = {};

  if (user.dailyKey !== t) {
    updates.dailyKey = t;
    updates.dailyMessages = 0;
  }

  if (user.inviteKey !== t) {
    updates.inviteKey = t;
    updates.invitationsToday = 0;
  }

  if (Object.keys(updates).length > 0) {
    await updateUser(phone, updates);
    return { ...user, ...updates };
  }

  return user;
}

async function sendWelcome(phone) {
  await sendText(
    phone,
`👋 Welcome to Navin Nati

🔒 Your mobile number remains hidden.
🔒 Only you and the person you chat with can see messages.
🔒 Block and Report options are available for your safety.

Please enter the WhatsApp number of someone you know.

Type MENU anytime for options.`
  );
}

async function sendMenu(phone) {
  await sendText(
    phone,
`📋 Navin Nati Menu

Type one option:

ABOUT
REQUESTS
END
BLOCK
REPORT
CUSTOMER CARE
START
DAY
MONTH`
  );
}

async function sendAbout(phone) {
  await sendText(
    phone,
`ℹ️ About Navin Nati

Safe & Private Chat

• Phone numbers remain hidden.
• Messages are relayed through Navin Nati.
• Block and Report options are available.
• Text messages only in MVP.`
  );
}

async function sendRechargeOptions(phone) {
  await sendText(
    phone,
`🚫 Daily free limit reached.

Plans:
DAY - ₹19 / 1 Day Unlimited
MONTH - ₹100 / 30 Days Unlimited

Reply DAY or MONTH to recharge.
Or type MENU.`
  );
}

async function sendPaymentQR(phone, plan) {
  const planText =
    plan === "day"
      ? "₹19 - 1 Day Unlimited"
      : "₹100 - 30 Days Unlimited";

  await updateUser(phone, {
    requestedPlan: plan,
    state: "PAYMENT_PENDING",
  });

  const caption =
`💳 Navin Nati Payment

Plan:
${planText}

Scan the QR and complete payment.

After payment reply:
PAID

Or type MENU.`;

  if (PAYMENT_QR_URL) {
    await sendImage(phone, PAYMENT_QR_URL, caption);
  } else {
    await sendText(phone, caption);
  }
}

async function notifyAdmin(message) {
  if (ADMIN_NUMBER) {
    await sendText(ADMIN_NUMBER, message);
  }
}

async function createRequest(sender, receiver, relationship) {
  const requestRef = db.collection("requests").doc();
  const requestId = requestRef.id;

  await requestRef.set({
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
  const snap = await db
    .collection("requests")
    .where("receiver", "==", phone)
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .get();

  return snap.docs.map((d) => d.data());
}

async function createChat(user1, user2) {
  const chatId = [user1, user2].sort().join("_");

  await db.collection("activeChats").doc(chatId).set({
    chatId,
    user1,
    user2,
    createdAt: now(),
    lastActivity: now(),
    status: "active",
  });

  await updateUser(user1, {
    activeChatPartner: user2,
    state: "ACTIVE_CHAT",
    lastActivity: now(),
  });

  await updateUser(user2, {
    activeChatPartner: user1,
    state: "ACTIVE_CHAT",
    lastActivity: now(),
  });

  return chatId;
}

async function endChat(phone, notify = true) {
  const user = await getUser(phone);

  if (!user.activeChatPartner) {
    await updateUser(phone, { state: "WAITING_NUMBER" });
    return;
  }

  const partner = user.activeChatPartner;

  await updateUser(phone, {
    activeChatPartner: null,
    state: "WAITING_NUMBER",
    lastActivity: now(),
  });

  await updateUser(partner, {
    activeChatPartner: null,
    state: "WAITING_NUMBER",
    lastActivity: now(),
  });

  const chatId = [phone, partner].sort().join("_");
  await db.collection("activeChats").doc(chatId).set(
    {
      status: "ended",
      endedAt: now(),
      lastActivity: now(),
    },
    { merge: true }
  );

  if (notify) {
    await sendText(partner, "🚫 Current chat ended by the other user.");
  }
}

async function isBlocked(sender, receiver) {
  const receiverUser = await getUser(receiver);
  const blocked = receiverUser.blockedUsers || [];
  return blocked.includes(sender);
}

async function blockCurrentUser(phone, user) {
  if (!user.activeChatPartner) {
    await sendText(phone, "No active chat to block.");
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

  await sendText(
    phone,
`⛔ User blocked.

Current chat ended.
Future requests from this person will not be delivered.`
  );

  await checkAbuseFlag(partner);
}

async function checkAbuseFlag(phone) {
  const snap = await db
    .collection("blockedUsers")
    .where("blocked", "==", phone)
    .get();

  const blockers = new Set();
  snap.docs.forEach((d) => blockers.add(d.data().blocker));

  if (blockers.size >= 3) {
    await db.collection("flags").add({
      user: phone,
      reason: "Blocked by 3 different users",
      createdAt: now(),
    });

    await notifyAdmin(
`⚠️ Abuse Alert

User flagged:
${phone}

Reason:
Blocked by 3 different users.`
    );
  }
}

async function reportCurrentUser(phone, user, blockToo = false) {
  if (!user.activeChatPartner) {
    await sendText(phone, "No active chat to report.");
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
`🚨 User Report

Reporter:
${phone}

Reported:
${reported}

Block also:
${blockToo ? "YES" : "NO"}`
  );

  if (blockToo) {
    await blockCurrentUser(phone, user);
  } else {
    await sendText(phone, "✅ Report submitted to Navin Nati admin.");
  }
}

async function startCustomerCare(phone) {
  await updateUser(phone, { waitingCustomerCare: true });

  await sendText(
    phone,
`📞 Customer Care

Please type your message.

Your message will be sent to Navin Nati admin.`
  );
}

async function handleCustomerCare(phone, text, user) {
  if (!user.waitingCustomerCare) return false;

  await db.collection("customerCare").add({
    user: phone,
    message: text,
    createdAt: now(),
  });

  await notifyAdmin(
`📞 Customer Care Message

User:
${phone}

Message:
${text}`
  );

  await updateUser(phone, { waitingCustomerCare: false });

  await sendText(phone, "✅ Your message has been sent to Customer Care.");
  return true;
}

async function showRequests(phone) {
  const requests = await getPendingRequests(phone);

  if (requests.length === 0) {
    await sendText(phone, "No pending requests.");
    return;
  }

  let msg = "📩 Pending Requests\n\n";

  requests.forEach((r, i) => {
    msg += `${i + 1}. ${r.relationship}\n`;
  });

  msg +=
`\nReply:
ACCEPT
REJECT`;

  await sendText(phone, msg);
}

async function notifyReceiver(sender, receiver, relationship) {
  await sendTemplateInvite(receiver);

  const receiverUser = await getUser(receiver);

  if (receiverUser.activeChatPartner) {
    await sendText(
      receiver,
`📩 New Chat Request Received

Current chat continues normally.

Type REQUESTS to view pending requests.`
    );
  }
}

async function handleAdminCommand(phone, text) {
  if (phone !== ADMIN_NUMBER) return false;

  const msg = cleanText(text);
  const parts = msg.split(/\s+/);
  const command = (parts[0] || "").toLowerCase();
  const target = normalizePhone(parts[1] || "");

  if (!["confirm", "reject"].includes(command)) return false;

  if (!target) {
    await sendText(phone, "Please use: CONFIRM 91XXXXXXXXXX or REJECT 91XXXXXXXXXX");
    return true;
  }

  const user = await getUser(target);

  if (command === "confirm") {
    const plan = user.requestedPlan || "day";
    const expiry = now() + (plan === "month" ? MONTH_PLAN_MS : DAY_PLAN_MS);

    await updateUser(target, {
      plan,
      planExpiry: expiry,
      requestedPlan: null,
      state: "WAITING_NUMBER",
    });

    await db.collection("payments").add({
      user: target,
      plan,
      status: "approved",
      approvedAt: now(),
      approvedBy: phone,
    });

    await sendText(
      target,
`✅ Payment approved!

Your ${plan === "month" ? "30 Days" : "1 Day"} unlimited plan is active.`
    );

    await sendText(phone, "Payment approved and user updated.");
    return true;
  }

  if (command === "reject") {
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

    await sendText(
      target,
`❌ Payment could not be verified.

Please contact Customer Care if needed.`
    );

    await sendText(phone, "Payment rejected and user notified.");
    return true;
  }

  return false;
}

async function handlePayment(phone, text, user) {
  const msg = lower(text);

  if (msg === "day") {
    await sendPaymentQR(phone, "day");
    return true;
  }

  if (msg === "month") {
    await sendPaymentQR(phone, "month");
    return true;
  }

  if (msg === "paid") {
    const plan = user.requestedPlan || "day";

    await db.collection("payments").add({
      user: phone,
      plan,
      status: "pending",
      createdAt: now(),
    });

    await notifyAdmin(
`💰 Payment Request

User:
${phone}

Plan:
${plan === "month" ? "₹100 / 30 Days" : "₹19 / 1 Day"}

Reply:
CONFIRM ${phone}

or

REJECT ${phone}`
    );

    await sendText(
      phone,
`✅ Payment request sent.

Admin will verify and approve shortly.`
    );

    return true;
  }

  return false;
}

async function handleCommands(phone, text, user) {
  const msg = lower(text);

  if (msg === "menu") {
    await sendMenu(phone);
    return true;
  }

  if (msg === "about") {
    await sendAbout(phone);
    return true;
  }

  if (msg === "requests") {
    await showRequests(phone);
    return true;
  }

  if (msg === "end") {
    await endChat(phone, true);
    await sendText(phone, "✅ Current chat ended.");
    return true;
  }

  if (msg === "block") {
    await blockCurrentUser(phone, user);
    return true;
  }

  if (msg === "report") {
    await sendText(
      phone,
`Report Options:

REPORT ONLY
REPORT BLOCK`
    );
    return true;
  }

  if (msg === "report only") {
    await reportCurrentUser(phone, user, false);
    return true;
  }

  if (msg === "report block") {
    await reportCurrentUser(phone, user, true);
    return true;
  }

  if (msg === "customer care") {
    await startCustomerCare(phone);
    return true;
  }

  if (msg === "start" || msg === "hi" || msg === "hello") {
    await updateUser(phone, {
      state: "WAITING_NUMBER",
      activeChatPartner: null,
      tempReceiver: null,
      relationshipType: null,
      waitingCustomerCare: false,
    });

    await sendWelcome(phone);
    return true;
  }

  return false;
}

async function handleRequestFlow(phone, text, user) {
  const msg = cleanText(text);
  const msgLower = lower(msg);

  if (user.state === "WAITING_NUMBER" || user.state === "NEW") {
    const receiver = normalizePhone(msg);

    if (!receiver) {
      await sendText(phone, "❌ Please enter a valid WhatsApp mobile number.");
      return true;
    }

    if (receiver === phone) {
      await sendText(phone, "❌ You cannot chat with yourself.");
      return true;
    }

    if (await isBlocked(phone, receiver)) {
      await sendText(phone, "❌ This request cannot be delivered.");
      return true;
    }

    await updateUser(phone, {
      tempReceiver: receiver,
      state: "CONFIRM_KNOW_PERSON",
    });

    await sendText(
      phone,
`Do you know this person?

Reply:
YES
NO`
    );

    return true;
  }

  if (user.state === "CONFIRM_KNOW_PERSON") {
    if (msgLower === "no") {
      await sendText(phone, "⚠️ Navin Nati only allows requests to people you know.");

      await updateUser(phone, {
        tempReceiver: null,
        state: "WAITING_NUMBER",
      });

      return true;
    }

    if (msgLower !== "yes") {
      await sendText(phone, "Please reply YES or NO.");
      return true;
    }

    await updateUser(phone, { state: "RELATIONSHIP_SELECTION" });

    await sendText(
      phone,
`Who is this person?

Reply:
1 - Relative
2 - Friend
3 - I Know Them`
    );

    return true;
  }

  if (user.state === "RELATIONSHIP_SELECTION") {
    let relation = null;

    if (msg === "1") relation = "Relative";
    if (msg === "2") relation = "Friend";
    if (msg === "3") relation = "I Know Them";

    if (!relation) {
      await sendText(phone, "Reply 1, 2 or 3.");
      return true;
    }

    await updateUser(phone, {
      relationshipType: relation,
      state: "READY_TO_SEND",
    });

    await sendText(
      phone,
`✅ Request Ready

Relationship:
${relation}

Reply SEND to send request.`
    );

    return true;
  }

  if (user.state === "READY_TO_SEND") {
    if (msgLower !== "send") {
      await sendText(phone, "Reply SEND to continue or MENU.");
      return true;
    }

    const freshUser = await getUser(phone);
    const receiver = freshUser.tempReceiver;
    const relationship = freshUser.relationshipType;

    const receiverPending = await getPendingRequests(receiver);

    if (receiverPending.length >= MAX_PENDING_REQUESTS) {
      await sendText(phone, "This person is currently unavailable. Please try again later.");
      return true;
    }

    if (!isPaid(freshUser)) {
      if ((freshUser.invitationsToday || 0) >= FREE_DAILY_INVITES) {
        await sendText(phone, "Daily invitation limit reached. Type DAY or MONTH to recharge.");
        return true;
      }
    }

    await createRequest(phone, receiver, relationship);
    await notifyReceiver(phone, receiver, relationship);

    await updateUser(phone, {
      state: "WAITING_RESPONSE",
      invitationsToday: (freshUser.invitationsToday || 0) + 1,
      lastActivity: now(),
    });

    await sendText(
      phone,
`✅ Request sent.

You'll be notified when the person responds.`
    );

    return true;
  }

  return false;
}

async function handleRequestResponse(phone, text) {
  const msg = lower(text);

  if (!["accept", "reject"].includes(msg)) return false;

  const requests = await getPendingRequests(phone);

  if (requests.length === 0) {
    await sendText(phone, "No pending requests.");
    return true;
  }

  const request = requests[0];

  if (msg === "reject") {
    await db.collection("requests").doc(request.requestId).update({
      status: "rejected",
      updatedAt: now(),
    });

    await sendText(phone, "Request closed.");
    await sendText(request.sender, "Your request could not be completed.");
    return true;
  }

  if (await isBlocked(request.sender, phone)) {
    await sendText(phone, "This request cannot be accepted.");
    return true;
  }

  await db.collection("requests").doc(request.requestId).update({
    status: "accepted",
    updatedAt: now(),
  });

  await createChat(request.sender, phone);

  await sendText(
    request.sender,
`✅ Chat started.

Type messages normally.
Type MENU anytime.`
  );

  await sendText(
    phone,
`✅ Chat started.

Type messages normally.
Type MENU anytime.`
  );

  return true;
}

async function canSendChatMessage(phone, user) {
  if (isPaid(user)) return true;

  const count = user.dailyMessages || 0;

  if (count >= FREE_DAILY_MESSAGES) {
    await sendRechargeOptions(phone);
    return false;
  }

  if (count === 5) {
    await sendText(phone, "Daily free messages: 5 used, 5 remaining.");
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

  await db.collection("activeChats").doc(chatId).set(
    {
      lastActivity: now(),
    },
    { merge: true }
  );

  await updateUser(phone, {
    dailyMessages: (user.dailyMessages || 0) + 1,
    lastActivity: now(),
  });

  return true;
}

async function cleanupOldData() {
  const cutoff = now() - THREE_DAYS_MS;

  const oldChats = await db
    .collection("activeChats")
    .where("lastActivity", "<", cutoff)
    .get();

  for (const doc of oldChats.docs) {
    const chat = doc.data();

    await db.collection("activeChats").doc(doc.id).delete();

    const messages = await db
      .collection("messages")
      .where("createdAt", "<", cutoff)
      .get();

    for (const m of messages.docs) {
      await db.collection("messages").doc(m.id).delete();
    }

    if (chat.user1) {
      await updateUser(chat.user1, {
        activeChatPartner: null,
        state: "WAITING_NUMBER",
      });
    }

    if (chat.user2) {
      await updateUser(chat.user2, {
        activeChatPartner: null,
        state: "WAITING_NUMBER",
      });
    }
  }

  const oldRequests = await db
    .collection("requests")
    .where("createdAt", "<", cutoff)
    .get();

  for (const r of oldRequests.docs) {
    await db.collection("requests").doc(r.id).delete();
  }
}

async function handleIncomingMessage(phone, text) {
  await cleanupOldData();

  let user = await getUser(phone);
  user = await resetDailyIfNeeded(phone, user);

  await updateUser(phone, { lastActivity: now() });

  const msg = cleanText(text);

  await db.collection("incomingLogs").add({
    from: phone,
    text: msg,
    createdAt: now(),
  });

  if (await handleAdminCommand(phone, msg)) return;

  user = await getUser(phone);

  if (await handleCustomerCare(phone, msg, user)) return;

  user = await getUser(phone);

  if (await handlePayment(phone, msg, user)) return;

  user = await getUser(phone);

  if (await handleCommands(phone, msg, user)) return;

  user = await getUser(phone);

  if (await handleRequestResponse(phone, msg)) return;

  user = await getUser(phone);

  if (user.state !== "ACTIVE_CHAT") {
    if (await handleRequestFlow(phone, msg, user)) return;
  }

  user = await getUser(phone);

  if (user.state === "ACTIVE_CHAT") {
    if (await relayMessage(phone, msg, user)) return;
  }

  await sendText(phone, "Type MENU for options or START to begin.");
}

function extractIncomingMessage(message) {
  if (!message) return null;

  const from = message.from;

  if (message.type === "text") {
    return {
      from,
      text: message.text?.body || "",
    };
  }

  if (message.type === "button") {
    return {
      from,
      text: message.button?.text || message.button?.payload || "",
    };
  }

  if (message.type === "interactive") {
    return {
      from,
      text:
        message.interactive?.button_reply?.title ||
        message.interactive?.button_reply?.id ||
        message.interactive?.list_reply?.title ||
        message.interactive?.list_reply?.id ||
        "",
    };
  }

  return {
    from,
    text: "",
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
      await sendText(
        incoming.from,
        "⚠️ Currently Navin Nati supports text messages only."
      );

      return res.sendStatus(200);
    }

    await handleIncomingMessage(incoming.from, incoming.text);

    return res.sendStatus(200);
  } catch (err) {
    console.error("WEBHOOK ERROR:", err.response?.data || err.message || err);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Navin Nati running on port ${PORT}`);
});02146
