require("dotenv").config();

const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Firebase Setup
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// VERIFY WEBHOOK
app.get("/webhook", (req, res) => {

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);

});

// MAIN WEBHOOK
app.post("/webhook", async (req, res) => {

  try {

    console.log(JSON.stringify(req.body, null, 2));

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;

    const userMessage =
      message.text?.body?.trim() || "";

    // USER REFERENCE
    const userRef = db.collection("users").doc(from);

    // SAVE USER
    await userRef.set({
      phone: from,
      updatedAt: new Date()
    }, { merge: true });

    // SAVE MESSAGE
    await db.collection("messages").add({
      from,
      text: userMessage,
      createdAt: new Date()
    });

    // GET USER DATA
    const userSnap = await userRef.get();

    const userData = userSnap.data() || {};

    const state = userData.state || "new";

    let replyText = "";

    // =========================
    // START FLOW
    // =========================
    if (
      userMessage.toLowerCase() === "hi" ||
      state === "new"
    ) {

      replyText =
`👋 Welcome to Blind Chat

Send any WhatsApp number to connect and chat privately without sharing mobile numbers.`;

      await userRef.set({
        state: "waiting_for_number"
      }, { merge: true });

    }

    // =========================
    // WAITING FOR NUMBER
    // =========================
    else if (state === "waiting_for_number") {

      const cleanNumber =
        userMessage.replace(/\D/g, "");

      replyText =
`✅ You entered:

${cleanNumber}

Reply:
1 to confirm
2 to type again`;

      await userRef.set({
        pendingNumber: cleanNumber,
        state: "waiting_for_confirmation"
      }, { merge: true });

    }

    // =========================
    // NUMBER CONFIRMATION
    // =========================
    else if (state === "waiting_for_confirmation") {

      // CONFIRM
      if (userMessage === "1") {

        const targetNumber =
          userData.pendingNumber;

        // SEND INVITATION
        await axios.post(
          `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: targetNumber,
            text: {
              body:
`💬 Someone you know wants to chat with you without sharing mobile number.

Reply to continue chatting 👇

👋 Hi
🤔 Who are you? Name please?
❌ I don't want to chat`
            }
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.TOKEN}`,
              "Content-Type": "application/json"
            }
          }
        );

        // SAVE USER1 SESSION
        await userRef.set({
          state: "waiting_for_accept",
          chatPartner: targetNumber
        }, { merge: true });

        // SAVE USER2 SESSION
        await db.collection("users").doc(targetNumber).set({
          state: "pending_request",
          chatPartner: from
        }, { merge: true });

        replyText =
`📨 Invitation sent successfully. Waiting for reply.`;

      }

      // TYPE AGAIN
      else {

        replyText =
`Send the WhatsApp number again.`;

        await userRef.set({
          state: "waiting_for_number"
        }, { merge: true });

      }

    }

    // =========================
    // USER2 ACCEPTS CHAT
    // =========================
    else if (state === "pending_request") {

      const partner = userData.chatPartner;

      // USER2 ACCEPTED
      await userRef.set({
        state: "chatting"
      }, { merge: true });

      // UPDATE USER1
      await db.collection("users").doc(partner).set({
        state: "chatting"
      }, { merge: true });

      // INFORM USER1
      await axios.post(
        `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: partner,
          text: {
            body:
`🎉 Your chat request was accepted.

You can now start chatting.`
          }
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      replyText =
`🎉 Chat connected successfully.

You can now start chatting.`;

    }

    // =========================
    // ACTIVE CHAT RELAY
    // =========================
    else if (state === "chatting") {

      // END CHAT
      if (userMessage.toLowerCase() === "/end") {

        const partner = userData.chatPartner;

        // RESET CURRENT USER
        await userRef.set({
          state: "idle",
          chatPartner: admin.firestore.FieldValue.delete()
        }, { merge: true });

        // RESET PARTNER
        await db.collection("users").doc(partner).set({
          state: "idle",
          chatPartner: admin.firestore.FieldValue.delete()
        }, { merge: true });

        // INFORM PARTNER
        await axios.post(
          `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: partner,
            text: {
              body:
`❌ Chat ended by other user.`
            }
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.TOKEN}`,
              "Content-Type": "application/json"
            }
          }
        );

        replyText =
`✅ Chat ended successfully.`;

      }

      // RELAY MESSAGE
      else {

        const partner = userData.chatPartner;

        // FORWARD MESSAGE
        await axios.post(
          `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: partner,
            text: {
              body: userMessage
            }
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.TOKEN}`,
              "Content-Type": "application/json"
            }
          }
        );

        return res.sendStatus(200);

      }

    }

    // =========================
    // DEFAULT
    // =========================
    else {

      replyText =
`Send "Hi" to start.`;

    }

    // SEND REPLY
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: {
          body: replyText
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.sendStatus(200);

  } catch (error) {

    console.log(error.response?.data || error.message);

    return res.sendStatus(500);

  }

});

// START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
