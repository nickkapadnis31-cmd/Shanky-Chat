require("dotenv").config();

const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

app.get("/webhook", (req, res) => {

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);

});

app.post("/webhook", async (req, res) => {

  try {

    console.log(JSON.stringify(req.body, null, 2));

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {

      const from = message.from;

      const userMessage =
        message.text?.body?.trim() || "";

      // Save user
      await db.collection("users").doc(from).set({
        phone: from,
        createdAt: new Date()
      }, { merge: true });

      // Save message
      await db.collection("messages").add({
        from,
        text: userMessage,
        createdAt: new Date()
      });

      // Get user data
      const userRef = db.collection("users").doc(from);

      const userSnap = await userRef.get();

      const userData = userSnap.data() || {};

      const state = userData.state || "new";

      let replyText = "";

      // START FLOW
      if (
        userMessage.toLowerCase() === "hi" ||
        state === "new"
      ) {

        replyText =
`👋 Welcome to Shanky Chat

Send any WhatsApp number to connect and chat privately without sharing mobile numbers.`;

        await userRef.set({
          state: "waiting_for_number"
        }, { merge: true });

      }

      // WAITING FOR NUMBER
      else if (state === "waiting_for_number") {

        replyText =
`✅ You entered:

${userMessage}

Reply:
1 to confirm
2 to type again`;

        await userRef.set({
          pendingNumber: userMessage,
          state: "waiting_for_confirmation"
        }, { merge: true });

      }

      // CONFIRMATION
      else if (state === "waiting_for_confirmation") {

        if (userMessage === "1") {

          replyText =
`📨 Invitation sent successfully.`;

          await userRef.set({
            state: "idle"
          }, { merge: true });

        } else {

          replyText =
`Send the WhatsApp number again.`;

          await userRef.set({
            state: "waiting_for_number"
          }, { merge: true });

        }

      }

      // DEFAULT
      else {

        replyText =
`Send "Hi" to start.`;

      }

      // Send reply
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

    }

    res.sendStatus(200);

  } catch (error) {

    console.log(error.response?.data || error.message);

    res.sendStatus(500);

  }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
