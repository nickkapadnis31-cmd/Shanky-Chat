// server.js
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
app.use(express.json());

// ==========================================
// ENVIRONMENT VARIABLES & CONFIGURATION
// ==========================================
const PORT = process.env.PORT || 3000;
const {
    VERIFY_TOKEN,
    TOKEN,
    PHONE_NUMBER_ID,
    FIREBASE_CONFIG,
    ADMIN_NUMBER,
    UPI_ID,
    PAYMENT_QR_URL
} = process.env;

// ==========================================
// FIREBASE INITIALIZATION
// ==========================================
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (error) {
        console.error("Firebase config error. Ensure FIREBASE_CONFIG is a valid JSON string.");
    }
}
const db = admin.firestore();

// ==========================================
// WHATSAPP API HELPER
// ==========================================
async function sendWhatsAppMessage(to, text) {
    try {
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: text }
            }
        });
    } catch (error) {
        console.error(`Failed to send message to ${to}:`, error.response ? error.response.data : error.message);
    }
}

// ==========================================
// USER & LIMITS HELPERS
// ==========================================
async function getUser(phone) {
    const doc = await db.collection('users').doc(phone).get();
    if (!doc.exists) {
        const newUser = {
            phone, state: 'START', activeChatPartner: null, tempReceiver: null,
            relationshipType: null, pendingRequests: [], blockedUsers: [],
            dailyMessages: 0, invitationsToday: 0, plan: 'FREE', planExpiry: null,
            waitingCustomerCare: false, createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastActivity: admin.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('users').doc(phone).set(newUser);
        return newUser;
    }
    return doc.data();
}

async function updateUser(phone, data) {
    data.lastActivity = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('users').doc(phone).update(data);
}

function hasActivePlan(user) {
    if (user.plan === 'FREE') return false;
    if (user.planExpiry && user.planExpiry.toDate() > new Date()) return true;
    return false; // Plan expired
}

function checkLimits(user, type) {
    if (hasActivePlan(user)) return true;
    
    // Simplistic daily check (in production, reset these daily via cron or timestamp check)
    if (type === 'message' && user.dailyMessages >= 10) return false;
    if (type === 'invite' && user.invitationsToday >= 3) return false;
    return true;
}

function triggerPaywall(phone) {
    sendWhatsAppMessage(phone, "You have exhausted your free limit.\n\nChoose a plan:\n₹19 - 1 Day Unlimited\n₹100 - 30 Days Unlimited\n\nReply with DAY or MONTH to select.");
    updateUser(phone, { state: 'PAYMENT_SELECTION' });
}

// ==========================================
// ADMIN HANDLER
// ==========================================
async function handleAdminMessage(text) {
    const parts = text.trim().split(' ');
    const command = parts[0].toUpperCase();
    const targetPhone = parts[1];

    if ((command === 'CONFIRM' || command === 'REJECT') && targetPhone) {
        const userRef = db.collection('users').doc(targetPhone);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return sendWhatsAppMessage(ADMIN_NUMBER, `User ${targetPhone} not found.`);

        if (command === 'CONFIRM') {
            const plan = parts[2] === 'MONTH' ? 30 : 1;
            const expiry = new Date();
            expiry.setDate(expiry.getDate() + plan);
            
            await userRef.update({
                plan: plan === 30 ? 'MONTH' : 'DAY',
                planExpiry: admin.firestore.Timestamp.fromDate(expiry),
                state: 'START'
            });
            await sendWhatsAppMessage(targetPhone, "Payment Confirmed! Your unlimited plan is now active. Send START to begin.");
            await sendWhatsAppMessage(ADMIN_NUMBER, `Plan activated for ${targetPhone}`);
        } else {
            await sendWhatsAppMessage(targetPhone, "Payment Rejected. Please contact customer care.");
            await sendWhatsAppMessage(ADMIN_NUMBER, `Payment rejected for ${targetPhone}`);
        }
    }
}

// ==========================================
// MAIN WEBHOOK ROUTER
// ==========================================
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        
        // --- ADD THESE TWO LINES HERE ---
        console.log("=== INCOMING WEBHOOK ===");
        console.log(JSON.stringify(body, null, 2));
        // --------------------------------

        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                const changes = entry.changes[0].value;
                if (changes.messages && changes.messages[0]) {
                    const message = changes.messages[0];
                    const sender = message.from;
                    const text = message.text?.body?.trim();

                    if (!text) continue; // MVP: Only text messages

                    // 1. Admin Commands Override
                    if (sender === ADMIN_NUMBER) {
                        await handleAdminMessage(text);
                        continue;
                    }

                    let user = await getUser(sender);
                    const upperText = text.toUpperCase();

                    // 2. Global Commands
                    if (['MENU', 'START', 'END', 'BLOCK', 'REPORT', 'REQUESTS', 'CUSTOMER CARE'].includes(upperText)) {
                        switch (upperText) {
                            case 'START':
                                await updateUser(sender, { state: 'WAITING_NUMBER', activeChatPartner: null, tempReceiver: null });
                                await sendWhatsAppMessage(sender, "Welcome to Navin Nati\nPhone numbers remain hidden.\nOnly participants can see messages.\nPlease enter the mobile number of someone you know.");
                                continue;
                            case 'MENU':
                                await sendWhatsAppMessage(sender, "MENU:\n- ABOUT\n- REQUESTS\n- END\n- BLOCK\n- REPORT\n- CUSTOMER CARE\n- START");
                                continue;
                            case 'ABOUT':
                                await sendWhatsAppMessage(sender, "Navin Nati: Phone numbers hidden. Messages private. Block/Report available.");
                                continue;
                            case 'END':
                                if (user.activeChatPartner) {
                                    await updateUser(user.activeChatPartner, { activeChatPartner: null, state: 'WAITING_NUMBER' });
                                    await sendWhatsAppMessage(user.activeChatPartner, "The other person has ended the chat.");
                                    await updateUser(sender, { activeChatPartner: null, state: 'WAITING_NUMBER' });
                                    await sendWhatsAppMessage(sender, "Chat ended. Enter a new number to start.");
                                } else {
                                    await sendWhatsAppMessage(sender, "You have no active chat.");
                                }
                                continue;
                            case 'BLOCK':
                                if (user.activeChatPartner) {
                                    const partner = user.activeChatPartner;
                                    await updateUser(sender, { 
                                        activeChatPartner: null, state: 'WAITING_NUMBER', 
                                        blockedUsers: admin.firestore.FieldValue.arrayUnion(partner) 
                                    });
                                    await updateUser(partner, { activeChatPartner: null, state: 'WAITING_NUMBER' });
                                    await sendWhatsAppMessage(sender, "User blocked and chat ended.");
                                    // Partner is not informed per spec
                                }
                                continue;
                            case 'REPORT':
                                if (user.activeChatPartner) {
                                    await db.collection('reports').add({
                                        reporter: sender, reported: user.activeChatPartner, timestamp: new Date()
                                    });
                                    await sendWhatsAppMessage(ADMIN_NUMBER, `REPORT ALERT: ${sender} reported ${user.activeChatPartner}`);
                                    await sendWhatsAppMessage(sender, "User reported. The admin has been notified.");
                                }
                                continue;
                            case 'CUSTOMER CARE':
                                await updateUser(sender, { state: 'CUSTOMER_CARE' });
                                await sendWhatsAppMessage(sender, "Type your message for Customer Care:");
                                continue;
                            case 'REQUESTS':
                                if (user.pendingRequests.length > 0) {
                                    await updateUser(sender, { state: 'MANAGING_REQUESTS' });
                                    await sendWhatsAppMessage(sender, `You have ${user.pendingRequests.length} pending requests.\nReply ACCEPT to accept the first one, or REJECT.`);
                                } else {
                                    await sendWhatsAppMessage(sender, "No pending requests.");
                                }
                                continue;
                        }
                    }

                    // 3. State Machine
                    switch (user.state) {
                        case 'START':
                            await updateUser(sender, { state: 'WAITING_NUMBER' });
                            await sendWhatsAppMessage(sender, "Welcome to Navin Nati\nPhone numbers remain hidden.\nPlease enter the mobile number of someone you know.");
                            break;

                        case 'WAITING_NUMBER':
                            const validNumber = /^\d{10,15}$/.test(text); // Basic validation
                            if (!validNumber || text === sender) {
                                await sendWhatsAppMessage(sender, "Invalid number or own number. Try again.");
                            } else {
                                await updateUser(sender, { tempReceiver: text, state: 'CONFIRM_KNOW_PERSON' });
                                await sendWhatsAppMessage(sender, "Do you know this person?\nYES or NO");
                            }
                            break;

                        case 'CONFIRM_KNOW_PERSON':
                            if (upperText === 'YES') {
                                await updateUser(sender, { state: 'RELATIONSHIP_FLOW' });
                                await sendWhatsAppMessage(sender, "Relationship?\n1 Relative\n2 Friend\n3 I Know Them");
                            } else {
                                await updateUser(sender, { state: 'WAITING_NUMBER', tempReceiver: null });
                                await sendWhatsAppMessage(sender, "Request cancelled. Enter a new number.");
                            }
                            break;

                        case 'RELATIONSHIP_FLOW':
                            if (['1', '2', '3'].includes(text)) {
                                if (!checkLimits(user, 'invite')) {
                                    return triggerPaywall(sender);
                                }
                                await updateUser(sender, { relationshipType: text, state: 'WAITING_FOR_ACCEPTANCE', invitationsToday: admin.firestore.FieldValue.increment(1) });
                                
                                // Add to receiver's pending list
                                const receiverDoc = await getUser(user.tempReceiver);
                                if (receiverDoc.pendingRequests.length < 5 && !receiverDoc.blockedUsers.includes(sender)) {
                                    await updateUser(user.tempReceiver, { pendingRequests: admin.firestore.FieldValue.arrayUnion(sender) });
                                    await sendWhatsAppMessage(user.tempReceiver, "New Chat Request\nSomeone wants to chat with you.\nReply: ACCEPT, REJECT, or MENU (if you're free) or use REQUESTS menu.");
                                    await sendWhatsAppMessage(sender, "Request sent. Waiting for acceptance.");
                                } else {
                                    await sendWhatsAppMessage(sender, "User unavailable or queue full.");
                                    await updateUser(sender, { state: 'WAITING_NUMBER' });
                                }
                            } else {
                                await sendWhatsAppMessage(sender, "Invalid choice. 1, 2, or 3.");
                            }
                            break;

                        case 'MANAGING_REQUESTS':
                        case 'START': // Catch-all for receiver replying ACCEPT straight away
                            if (upperText === 'ACCEPT' && user.pendingRequests.length > 0) {
                                const partner = user.pendingRequests[0];
                                // Remove from queue
                                await updateUser(sender, { 
                                    pendingRequests: admin.firestore.FieldValue.arrayRemove(partner),
                                    activeChatPartner: partner,
                                    state: 'ACTIVE_CHAT'
                                });
                                await updateUser(partner, { activeChatPartner: sender, state: 'ACTIVE_CHAT' });
                                await sendWhatsAppMessage(sender, "Request accepted! You are now chatting. Type END to stop.");
                                await sendWhatsAppMessage(partner, "Your request was accepted! You are now chatting.");
                            } else if (upperText === 'REJECT' && user.pendingRequests.length > 0) {
                                const partner = user.pendingRequests[0];
                                await updateUser(sender, { pendingRequests: admin.firestore.FieldValue.arrayRemove(partner), state: 'WAITING_NUMBER' });
                                await sendWhatsAppMessage(partner, "Your chat request was rejected.");
                                await sendWhatsAppMessage(sender, "Request rejected.");
                            }
                            break;

                        case 'ACTIVE_CHAT':
                            if (user.activeChatPartner) {
                                if (!checkLimits(user, 'message')) {
                                    return triggerPaywall(sender);
                                }
                                // Relay message
                                await sendWhatsAppMessage(user.activeChatPartner, text);
                                await updateUser(sender, { dailyMessages: admin.firestore.FieldValue.increment(1) });
                                // Store log
                                await db.collection('messages').add({
                                    from: sender, to: user.activeChatPartner, text: text, timestamp: admin.firestore.FieldValue.serverTimestamp()
                                });
                            } else {
                                await updateUser(sender, { state: 'WAITING_NUMBER' });
                            }
                            break;

                        case 'CUSTOMER_CARE':
                            await db.collection('customerCare').add({ phone: sender, message: text, timestamp: new Date() });
                            await sendWhatsAppMessage(ADMIN_NUMBER, `CUSTOMER CARE from ${sender}:\n${text}`);
                            await updateUser(sender, { state: 'WAITING_NUMBER' });
                            await sendWhatsAppMessage(sender, "Message sent to Customer Care.");
                            break;

                        case 'PAYMENT_SELECTION':
                            if (upperText === 'DAY' || upperText === 'MONTH') {
                                await updateUser(sender, { state: 'PAYMENT_QR' });
                                await sendWhatsAppMessage(sender, `Pay to UPI: ${UPI_ID}\nOr scan QR: ${PAYMENT_QR_URL}\n\nReply 'PAID' when done or 'MENU' to cancel.`);
                            }
                            break;

                        case 'PAYMENT_QR':
                            if (upperText === 'PAID') {
                                await sendWhatsAppMessage(ADMIN_NUMBER, `Payment Request\nUser: ${sender}\nPlan: Check records.\nReply CONFIRM ${sender} [DAY/MONTH] or REJECT ${sender}`);
                                await sendWhatsAppMessage(sender, "Payment verification pending. Admin will approve shortly.");
                                await updateUser(sender, { state: 'WAITING_NUMBER' });
                            }
                            break;

                        default:
                            await sendWhatsAppMessage(sender, "Unrecognized state. Reply START to reset.");
                            break;
                    }
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook Error:", error);
        res.sendStatus(500);
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Navin Nati MVP Server running on port ${PORT}`);
});
