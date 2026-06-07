const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const TOKEN = process.env.TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const ADMIN_NUMBER = normalizePhone(process.env.ADMIN_NUMBER || "");
const TEMPLATE_NAME = process.env.TEMPLATE_NAME || "navin_nati";
const TEMPLATE_LANGUAGE = process.env.TEMPLATE_LANGUAGE || "en";
const PAYMENT_QR_19_URL = process.env.PAYMENT_QR_19_URL || "";
const PAYMENT_QR_100_URL = process.env.PAYMENT_QR_100_URL || "";

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

function now() {
  return Date.now();
}

function todayKeyIST() {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function cleanText(text) {
  return (text || "").trim();
}

function lower(text) {
  return cleanText(text).toLowerCase();
}

function isPaid(user) {
  return user.plan && user.plan !== "free" && user.planExpiry && user.planExpiry > now();
}

function buttonTextToCommand(text) {
  const t = lower(text);

  if (t.includes("who are you") || t.includes("what's your name") || t.includes("whats your name")) return "accept";
  if (t.includes("don't want") || t.includes("dont want") || t.includes("not interested")) return "reject";
  if (t.includes("menu")) return "menu";
  if (t.includes("yes")) return "yes";
  if (t.includes("no")) return "no";
  if (t.includes("relative")) return "1";
  if (t.includes("friend")) return "2";
  if (t.includes("know")) return "3";
  if (t.includes("₹19") || t === "19" || t.includes("rs.19")) return "19";
  if (t.includes("₹100") || t === "100" || t.includes("rs.100")) return "100";
  if (t.includes("paid")) return "paid";
  if (t.includes("report only")) return "report only";
  if (t.includes("report") && t.includes("block")) return "report block";

  return cleanText(text);
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

async function sendButtons(to, body, buttons) {
  try {
    const safeButtons = buttons.slice(0, 3).map((b, index) => ({
      type: "reply",
      reply: {
        id: b.id || `btn_${index + 1}`,
        title: b.title.substring(0, 20),
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
          action: {
            buttons: safeButtons,
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
    console.error("SEND BUTTON ERROR:", err.response?.data || err.message);
    await sendText(
      to,
      `${body}\n\n${buttons.map((b) => b.title).join("\n")}`
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
    console.error("SEND IMAGE ERROR:", err.response?.data || err.message);
    await sendText(to, caption || "QR image could not be sent. Please contact customer care.");
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

async function notifyAdmin(message) {
  if (ADMIN_NUMBER) await sendText(ADMIN_NUMBER, message);
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

async function sendWelcome(phone) {
  await sendButtons(
    phone,
`👋 Welcome to Navin Nati

Private & Secure Communication

🔒 Your mobile number stays hidden.
🔒 आपका मोबाइल नंबर छुपा रहेगा।

Only people who know each other should connect here.
केवल परिचित लोगों से ही जुड़ें।

Block, Report and Customer Care are available for your safety.

Please send the WhatsApp number of your friend / known person.
कृपया अपने मित्र / परिचित का WhatsApp नंबर भेजें।`,
    [
      { id: "menu", title: "Menu" },
      { id: "about", title: "About" },
      { id: "care", title: "Customer Care" },
    ]
  );
}

async function sendMenu(phone) {
  await sendButtons(
    phone,
`📋 Navin Nati Menu

Type or tap:
नीचे विकल्प चुनें या टाइप करें:

ABOUT - About Navin Nati
REQUESTS - View Requests
END - End Chat
BLOCK - Block User
REPORT - Report User
CUSTOMER CARE - Help
START - Start Again`,
    [
      { id: "about", title: "About" },
      { id: "requests", title: "Requests" },
      { id: "care", title: "Customer Care" },
    ]
  );
}

async function sendAbout(phone) {
  await sendButtons(
    phone,
`ℹ️ About Navin Nati

Navin Nati helps known people connect privately on WhatsApp.

🔒 Phone numbers remain hidden.
🔒 मोबाइल नंबर छुपे रहते हैं।

🔒 Messages are relayed through Navin Nati.
🔒 संदेश Navin Nati के माध्यम से जाते हैं।

Safety options:
END, BLOCK, REPORT, CUSTOMER CARE

MVP supports text messages only.
अभी केवल text messages support हैं।`,
    [
      { id: "requests", title: "Requests" },
      { id: "start", title: "Start Again" },
      { id: "menu", title: "Menu" },
    ]
  );
}

async function sendRechargeOptions(phone) {
  await sendButtons(
    phone,
`🚫 Daily free limit reached.
आज की free limit समाप्त हो गई है।

Recharge Plans:
₹19 - Day Plan
₹100 - Monthly Plan

Choose plan:
Plan चुनें:`,
    [
      { id: "plan_19", title: "₹19" },
      { id: "plan_100", title: "₹100" },
      { id: "menu", title: "Menu" },
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

  const caption =
`💳 Navin Nati Payment

${isMonth ? "₹100 - Monthly Plan" : "₹19 - Day Plan"}

Scan QR and pay.
QR scan करके payment करें।

After payment reply:
PAID

Or type:
MENU`;

  if (qrUrl) {
    await sendImage(phone, qrUrl, caption);
  } else {
    await sendText(phone, `${caption}\n\nQR not configured. Please contact customer care.`);
  }

  await sendButtons(
    phone,
`After payment, tap PAID.
Payment के बाद PAID दबाएं।`,
    [
      { id: "paid", title: "PAID" },
      { id: "menu", title: "Menu" },
    ]
  );
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
    .get();

  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

async function isBlocked(sender, receiver) {
  const receiverUser = await getUser(receiver);
  const blocked = receiverUser.blockedUsers || [];
  return blocked.includes(sender);
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
    state: "WAITING_NUMBER",
    lastActivity: now(),
  });

  await updateUser(partner, {
    activeChatPartner: null,
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
    await sendText(
      partner,
`🚪 Current chat ended by the other user.
दूसरे user ने chat end कर दी है।

Type START to begin again.`
    );
  }
}

async function blockCurrentUser(phone, user) {
  if (!user.activeChatPartner) {
    await sendText(phone, "No active chat to block.\nBlock करने के लिए active chat नहीं है।");
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
`⛔ User blocked.

Current chat ended.
Future requests from this person will not be delivered.

User block हो गया है।
इस व्यक्ति की future requests deliver नहीं होंगी।`,
    [
      { id: "start", title: "Start Again" },
      { id: "menu", title: "Menu" },
    ]
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
    await sendText(phone, "No active chat to report.\nReport करने के लिए active chat नहीं है।");
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
    await sendButtons(
      phone,
`✅ Report submitted to Navin Nati admin.
Report admin को भेज दी गई है।`,
      [
        { id: "menu", title: "Menu" },
        { id: "block", title: "Block" },
      ]
    );
  }
}

async function startCustomerCare(phone) {
  await updateUser(phone, { waitingCustomerCare: true });

  await sendText(
    phone,
`🎧 Customer Care

Please type your message.
कृपया अपना message type करें।

Admin number will not be shown.
Admin number नहीं दिखेगा।`
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
`🎧 Customer Care Message

User:
${phone}

Message:
${text}`
  );

  await updateUser(phone, { waitingCustomerCare: false });

  await sendButtons(
    phone,
`✅ Your message has been sent to Customer Care.
आपका message Customer Care को भेज दिया गया है।`,
    [
      { id: "menu", title: "Menu" },
      { id: "start", title: "Start Again" },
    ]
  );

  return true;
}

async function showRequests(phone) {
  const requests = await getPendingRequests(phone);

  if (!requests.length) {
    await sendButtons(
      phone,
`📭 No pending requests.
कोई pending request नहीं है।`,
      [
        { id: "start", title: "Start Again" },
        { id: "menu", title: "Menu" },
      ]
    );
    return;
  }

  let msg = `📩 Pending Requests\nPending requests:\n\n`;

  requests.forEach((r, i) => {
    msg += `${i + 1}. ${r.relationship}\n`;
  });

  msg += `\nTap or type ACCEPT / REJECT for oldest request.`;

  await sendButtons(
    phone,
    msg,
    [
      { id: "accept", title: "Accept" },
      { id: "reject", title: "Reject" },
      { id: "menu", title: "Menu" },
    ]
  );
}

async function notifyReceiver(sender, receiver, relationship) {
  await sendTemplateInvite(receiver);

  const receiverUser = await getUser(receiver);

  if (receiverUser.activeChatPartner) {
    await sendButtons(
      receiver,
`📩 New Chat Request Received

Your current chat continues normally.
आपकी current chat जारी रहेगी।

Type REQUESTS to view pending requests.`,
      [
        { id: "requests", title: "Requests" },
        { id: "menu", title: "Menu" },
      ]
    );
  }
}

async function handleAdminCommand(phone, text) {
  if (phone !== ADMIN_NUMBER) return false;

  const msg = cleanText(text);
  const parts = msg.split(/\s+/);
  const command = lower(parts[0] || "");
  const target = normalizePhone(parts[1] || "");

  if (!["confirm", "reject"].includes(command)) return false;

  if (!target) {
    await sendText(phone, "Use: CONFIRM 91XXXXXXXXXX or REJECT 91XXXXXXXXXX");
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

    await sendButtons(
      target,
`✅ Payment approved!

${plan === "month" ? "₹100 Monthly Plan" : "₹19 Day Plan"} is active.

Payment approve हो गया है।`,
      [
        { id: "start", title: "Start Again" },
        { id: "menu", title: "Menu" },
      ]
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

    await sendButtons(
      target,
`❌ Payment could not be verified.
Payment verify नहीं हो पाया।

Please contact Customer Care if needed.`,
      [
        { id: "care", title: "Customer Care" },
        { id: "menu", title: "Menu" },
      ]
    );

    await sendText(phone, "Payment rejected and user notified.");
    return true;
  }

  return false;
}

async function handlePayment(phone, text, user) {
  const msg = lower(text);

  if (msg === "19" || msg === "₹19" || msg === "day") {
    await sendPaymentQR(phone, "day");
    return true;
  }

  if (msg === "100" || msg === "₹100" || msg === "month") {
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
${plan === "month" ? "₹100 Monthly Plan" : "₹19 Day Plan"}

Reply:
CONFIRM ${phone}

or

REJECT ${phone}`
    );

    await sendButtons(
      phone,
`✅ Payment request sent to admin.
Payment request admin को भेज दी गई है।

Please wait for approval.`,
      [
        { id: "menu", title: "Menu" },
        { id: "care", title: "Customer Care" },
      ]
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
    await sendButtons(
      phone,
`✅ Current chat ended.
Current chat end हो गई है।`,
      [
        { id: "start", title: "Start Again" },
        { id: "menu", title: "Menu" },
      ]
    );
    return true;
  }

  if (msg === "block") {
    await blockCurrentUser(phone, user);
    return true;
  }

  if (msg === "report") {
    await sendButtons(
      phone,
`⚠️ Report User

Choose:
Report Only
Report + Block`,
      [
        { id: "report_only", title: "Report Only" },
        { id: "report_block", title: "Report + Block" },
        { id: "menu", title: "Menu" },
      ]
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

  if (msg === "start" || (msg === "hi" && user.state !== "ACTIVE_CHAT") || (msg === "hello" && user.state !== "ACTIVE_CHAT")) {
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
      await sendText(phone, "❌ Please enter a valid WhatsApp mobile number.\nकृपया सही WhatsApp नंबर भेजें।");
      return true;
    }

    if (receiver === phone) {
      await sendText(phone, "❌ You cannot chat with yourself.\nआप खुद से chat नहीं कर सकते।");
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

    await sendButtons(
      phone,
`Do you know this person?
क्या आप इस व्यक्ति को जानते हैं?`,
      [
        { id: "yes", title: "YES" },
        { id: "no", title: "NO" },
        { id: "menu", title: "Menu" },
      ]
    );

    return true;
  }

  if (user.state === "CONFIRM_KNOW_PERSON") {
    if (msgLower === "no") {
      await sendButtons(
        phone,
`⚠️ Navin Nati only allows requests to people you know.
Navin Nati पर केवल परिचित लोगों को request भेजें।`,
        [
          { id: "start", title: "Start Again" },
          { id: "menu", title: "Menu" },
        ]
      );

      await updateUser(phone, {
        tempReceiver: null,
        state: "WAITING_NUMBER",
      });

      return true;
    }

    if (msgLower !== "yes") {
      await sendText(phone, "Please reply YES or NO.\nकृपया YES या NO reply करें।");
      return true;
    }

    await updateUser(phone, { state: "RELATIONSHIP_SELECTION" });

    await sendButtons(
      phone,
`Who is this person?
यह व्यक्ति कौन है?`,
      [
        { id: "relative", title: "Relative" },
        { id: "friend", title: "Friend" },
        { id: "known", title: "I Know Them" },
      ]
    );

    return true;
  }

  if (user.state === "RELATIONSHIP_SELECTION") {
    let relation = null;

    if (msg === "1" || msgLower === "relative") relation = "Relative";
    if (msg === "2" || msgLower === "friend") relation = "Friend";
    if (msg === "3" || msgLower.includes("know")) relation = "I Know Them";

    if (!relation) {
      await sendText(phone, "Reply 1, 2 or 3.\nकृपया 1, 2 या 3 reply करें।");
      return true;
    }

    await updateUser(phone, {
      relationshipType: relation,
      state: "READY_TO_SEND",
    });

    await sendButtons(
      phone,
`✅ Request Ready

Relationship:
${relation}

Send request?
Request भेजें?`,
      [
        { id: "send", title: "SEND" },
        { id: "start", title: "Start Again" },
        { id: "menu", title: "Menu" },
      ]
    );

    return true;
  }

  if (user.state === "READY_TO_SEND") {
    if (msgLower !== "send") {
      await sendText(phone, "Reply SEND to continue or MENU.\nSEND या MENU reply करें।");
      return true;
    }

    const freshUser = await getUser(phone);
    const receiver = freshUser.tempReceiver;
    const relationship = freshUser.relationshipType;

    const receiverPending = await getPendingRequests(receiver);

    if (receiverPending.length >= MAX_PENDING_REQUESTS) {
      await sendText(phone, "This person is currently unavailable. Please try later.");
      return true;
    }

    if (!isPaid(freshUser) && (freshUser.invitationsToday || 0) >= FREE_DAILY_INVITES) {
      await sendRechargeOptions(phone);
      return true;
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
`✅ Request sent.
Request भेज दी गई है।

You will be notified when the person responds.`,
      [
        { id: "menu", title: "Menu" },
        { id: "start", title: "Start Again" },
      ]
    );

    return true;
  }

  return false;
}

async function handleRequestResponse(phone, text, user) {
  const msg = lower(text);
  const requests = await getPendingRequests(phone);

  if (!requests.length) return false;

  if (msg === "menu") {
    await sendMenu(phone);
    return true;
  }

  const isReject = msg === "reject" || msg.includes("don't want") || msg.includes("dont want");
  const isAccept =
    msg === "accept" ||
    msg.includes("who are you") ||
    msg.includes("what's your name") ||
    msg.includes("whats your name") ||
    (!["reject", "menu"].includes(msg) && user.state !== "ACTIVE_CHAT");

  if (!isAccept && !isReject) return false;

  const request = requests[0];

  if (isReject) {
    await db.collection("requests").doc(request.requestId).update({
      status: "rejected",
      updatedAt: now(),
    });

    await sendButtons(
      phone,
`Request closed.
Request बंद कर दी गई है।`,
      [
        { id: "menu", title: "Menu" },
        { id: "start", title: "Start Again" },
      ]
    );

    await sendText(request.sender, "Your request could not be completed.");
    return true;
  }

  if (user.activeChatPartner) {
    await endChat(phone, true);
  }

  await db.collection("requests").doc(request.requestId).update({
    status: "accepted",
    updatedAt: now(),
  });

  await createChat(request.sender, phone);

  const firstMsg = cleanText(text);

  await sendText(
    request.sender,
`🎉 Your chat request was accepted.

The other person replied:
"${firstMsg}"

You can now introduce yourself.

🔒 Mobile numbers remain hidden.`
  );

  await sendButtons(
    phone,
`✅ Chat started.
Chat शुरू हो गई है।

Type messages normally.
MENU anytime.`,
    [
      { id: "menu", title: "Menu" },
      { id: "end", title: "End" },
    ]
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
    await sendText(phone, "Daily free messages: 5 used, 5 remaining.\nआज के 5 messages बाकी हैं।");
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

  const oldMessages = await db.collection("messages").where("createdAt", "<", cutoff).get();
  for (const doc of oldMessages.docs) {
    await db.collection("messages").doc(doc.id).delete();
  }

  const oldRequests = await db.collection("requests").where("createdAt", "<", cutoff).get();
  for (const doc of oldRequests.docs) {
    await db.collection("requests").doc(doc.id).delete();
  }

  const oldChats = await db.collection("activeChats").where("lastActivity", "<", cutoff).get();
  for (const doc of oldChats.docs) {
    const chat = doc.data();

    if (chat.user1) await updateUser(chat.user1, { activeChatPartner: null, state: "WAITING_NUMBER" });
    if (chat.user2) await updateUser(chat.user2, { activeChatPartner: null, state: "WAITING_NUMBER" });

    await db.collection("activeChats").doc(doc.id).delete();
  }
}

async function handleIncomingMessage(phone, text) {
  await cleanupOldData();

  let msg = buttonTextToCommand(text);
  let user = await getUser(phone);
  user = await resetDailyIfNeeded(phone, user);

  await updateUser(phone, { lastActivity: now() });

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
  if (await handleRequestResponse(phone, msg, user)) return;

  user = await getUser(phone);
  if (user.state !== "ACTIVE_CHAT") {
    if (await handleRequestFlow(phone, msg, user)) return;
  }

  user = await getUser(phone);
  if (user.state === "ACTIVE_CHAT") {
    if (await relayMessage(phone, msg, user)) return;
  }

  await sendButtons(
    phone,
`I could not understand.
समझ नहीं आया।

Type MENU for options.`,
    [
      { id: "menu", title: "Menu" },
      { id: "start", title: "Start Again" },
    ]
  );
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
        "⚠️ Currently Navin Nati supports text messages only.\nअभी केवल text messages support हैं।"
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
});
