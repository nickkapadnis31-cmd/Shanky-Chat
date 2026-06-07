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
// BILINGUAL MESSAGES
// ==========================================
const messages = {
    // Hindi translations
    hi: {
        welcome: "नमस्ते! मैं नवीन नाती हूँ। कृपया अपनी भाषा चुनें:\nHello! I'm Navin Nati. Please choose your language:",
        language_selected: "आपने हिंदी भाषा चुनी है।\nYou have selected Hindi language.",
        start: "नवीन नाती में आपका स्वागत है\nफ़ोन नंबर छिपे रहते हैं।\nकृपया अपने किसी जानने वाले का मोबाइल नंबर दर्ज करें:",
        invalid_number: "अमान्य नंबर या अपना नंबर। कृपया फिर से प्रयास करें।",
        know_person: "क्या आप इस व्यक्ति को जानते हैं?",
        relationship: "संबंध चुनें:\n1 रिश्तेदार\n2 दोस्त\n3 जानता/जानती हूँ",
        request_sent: "अनुरोध भेज दिया गया है। स्वीकृति की प्रतीक्षा है।",
        new_request: "नया चैट अनुरोध\nकोई आपसे बात करना चाहता है।",
        accept_reject: "कृपया जवाब दें: स्वीकार करें या अस्वीकार करें",
        accepted: "अनुरोध स्वीकार कर लिया गया! अब आप बातचीत कर सकते हैं। समाप्त करने के लिए END लिखें।",
        rejected: "अनुरोध अस्वीकार कर दिया गया।",
        request_rejected: "आपका चैट अनुरोध अस्वीकार कर दिया गया था।",
        active_chat: "अब आप बातचीत कर रहे हैं।",
        chat_ended: "बातचीत समाप्त हुई। नया नंबर दर्ज करें।",
        partner_ended: "दूसरे व्यक्ति ने बातचीत समाप्त कर दी है।",
        blocked: "उपयोगकर्ता को ब्लॉक कर दिया गया और बातचीत समाप्त हो गई।",
        reported: "उपयोगकर्ता की रिपोर्ट कर दी गई। प्रशासक को सूचित कर दिया गया है।",
        no_requests: "कोई लंबित अनुरोध नहीं।",
        menu: "मेनू:\n- ABOUT\n- REQUESTS\n- END\n- BLOCK\n- REPORT\n- CUSTOMER CARE\n- START",
        about: "नवीन नाती: फ़ोन नंबर छिपे। संदेश निजी। ब्लॉक/रिपोर्ट उपलब्ध।",
        customer_care: "कृपया कस्टमर केयर के लिए अपना संदेश टाइप करें:",
        customer_care_sent: "संदेश कस्टमर केयर को भेज दिया गया है।",
        payment_selection: "आपने अपनी मुफ्त सीमा समाप्त कर ली है।\n\nयोजना चुनें:\n₹19 - 1 दिन असीमित\n₹100 - 30 दिन असीमित",
        payment_qr: "UPI पर भुगतान करें: ${UPI_ID}\nया QR स्कैन करें: ${PAYMENT_QR_URL}\n\nपूरा होने पर 'PAID' भेजें या 'MENU' भेजें।",
        payment_pending: "भुगतान सत्यापन लंबित। प्रशासक जल्द ही स्वीकृत करेगा।",
        payment_confirmed: "भुगतान पुष्टि! आपकी असीमित योजना अब सक्रिय है। START भेजें।",
        payment_rejected: "भुगतान अस्वीकार कर दिया गया। कृपया कस्टमर केयर से संपर्क करें।",
        unrecognized: "अपरिचित स्थिति। पुनः आरंभ करने के लिए START भेजें।",
        accept_button: "स्वीकार करें",
        reject_button: "अस्वीकार करें",
        yes_button: "हाँ",
        no_button: "नहीं",
        menu_button: "मेनू",
        end_button: "समाप्त करें"
    },
    // English messages (default)
    en: {
        welcome: "Hello! I'm Navin Nati. Please choose your language:\nनमस्ते! मैं नवीन नाती हूँ। कृपया अपनी भाषा चुनें:",
        language_selected: "You have selected English language.\nआपने अंग्रेज़ी भाषा चुनी है।",
        start: "Welcome to Navin Nati\nPhone numbers remain hidden.\nPlease enter the mobile number of someone you know:",
        invalid_number: "Invalid number or own number. Please try again.",
        know_person: "Do you know this person?",
        relationship: "Choose relationship:\n1 Relative\n2 Friend\n3 I Know Them",
        request_sent: "Request sent. Waiting for acceptance.",
        new_request: "New Chat Request\nSomeone wants to chat with you.",
        accept_reject: "Please reply: ACCEPT or REJECT",
        accepted: "Request accepted! You are now chatting. Type END to stop.",
        rejected: "Request rejected.",
        request_rejected: "Your chat request was rejected.",
        active_chat: "You are now chatting.",
        chat_ended: "Chat ended. Enter a new number to start.",
        partner_ended: "The other person has ended the chat.",
        blocked: "User blocked and chat ended.",
        reported: "User reported. Admin has been notified.",
        no_requests: "No pending requests.",
        menu: "MENU:\n- ABOUT\n- REQUESTS\n- END\n- BLOCK\n- REPORT\n- CUSTOMER CARE\n- START",
        about: "Navin Nati: Phone numbers hidden. Messages private. Block/Report available.",
        customer_care: "Type your message for Customer Care:",
        customer_care_sent: "Message sent to Customer Care.",
        payment_selection: "You have exhausted your free limit.\n\nChoose a plan:\n₹19 - 1 Day Unlimited\n₹100 - 30 Days Unlimited",
        payment_qr: "Pay to UPI: ${UPI_ID}\nOr scan QR: ${PAYMENT_QR_URL}\n\nReply 'PAID' when done or 'MENU' to cancel.",
        payment_pending: "Payment verification pending. Admin will approve shortly.",
        payment_confirmed: "Payment Confirmed! Your unlimited plan is now active. Send START to begin.",
        payment_rejected: "Payment Rejected. Please contact customer care.",
        unrecognized: "Unrecognized state. Reply START to reset.",
        accept_button: "ACCEPT",
        reject_button: "REJECT",
        yes_button: "YES",
        no_button: "NO",
        menu_button: "MENU",
        end_button: "END"
    }
};

// ==========================================
// BUTTON MESSAGE HELPER
// ==========================================
async function sendInteractiveButtons(to, text, buttons) {
    try {
        const buttonObjects = buttons.map((btn, index) => ({
            type: "reply",
            reply: {
                id: `btn_${index}`,
                title: btn.title
            }
        }));

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
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: text },
                    action: { buttons: buttonObjects }
                }
            }
        });
    } catch (error) {
        console.error(`Failed to send buttons to ${to}:`, error.response ? error.response.data : error.message);
        // Fallback to text
        await sendWhatsAppMessage(to, text + "\n\n" + buttons.map(b => b.title).join(" / "));
    }
}

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
                text: { body: text, preview_url: false }
            }
        });
    } catch (error) {
        console.error(`Failed to send message to ${to}:`, error.response ? error.response.data : error.message);
    }
}

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
// USER & LIMITS HELPERS
// ==========================================
async function getUser(phone) {
    const doc = await db.collection('users').doc(phone).get();
    if (!doc.exists) {
        const newUser = {
            phone, state: 'LANGUAGE_SELECTION', language: 'en', activeChatPartner: null, tempReceiver: null,
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
    return false;
}

function checkLimits(user, type) {
    if (hasActivePlan(user)) return true;
    if (type === 'message' && user.dailyMessages >= 10) return false;
    if (type === 'invite' && user.invitationsToday >= 3) return false;
    return true;
}

function getMessage(user, key, params = {}) {
    let text = messages[user.language || 'en'][key] || messages.en[key];
    // Replace parameters
    Object.keys(params).forEach(param => {
        text = text.replace(`\${${param}}`, params[param]);
    });
    return text;
}

function triggerPaywall(user) {
    const msg = getMessage(user, 'payment_selection');
    sendWhatsAppMessage(user.phone, msg);
    updateUser(user.phone, { state: 'PAYMENT_SELECTION' });
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

        const user = userDoc.data();
        
        if (command === 'CONFIRM') {
            const plan = parts[2] === 'MONTH' ? 30 : 1;
            const expiry = new Date();
            expiry.setDate(expiry.getDate() + plan);
            
            await userRef.update({
                plan: plan === 30 ? 'MONTH' : 'DAY',
                planExpiry: admin.firestore.Timestamp.fromDate(expiry),
                state: 'WAITING_NUMBER'
            });
            
            const confirmMsg = getMessage(user, 'payment_confirmed');
            await sendWhatsAppMessage(targetPhone, confirmMsg);
            await sendWhatsAppMessage(ADMIN_NUMBER, `Plan activated for ${targetPhone}`);
        } else {
            const rejectMsg = getMessage(user, 'payment_rejected');
            await sendWhatsAppMessage(targetPhone, rejectMsg);
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
        
        console.log("=== INCOMING WEBHOOK ===");
        console.log(JSON.stringify(body, null, 2));

        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                const changes = entry.changes[0].value;
                
                // Handle status updates
                if (changes.statuses) {
                    console.log("Status update:", changes.statuses[0]);
                    continue;
                }
                
                if (changes.messages && changes.messages[0]) {
                    const message = changes.messages[0];
                    const sender = message.from;
                    let text = null;
                    let buttonResponse = null;
                    
                    // Extract text or button response
                    if (message.text?.body) {
                        text = message.text.body.trim();
                    } else if (message.interactive?.button_reply) {
                        buttonResponse = message.interactive.button_reply.title;
                        text = buttonResponse; // Treat button response as text
                    }
                    
                    if (!text) continue;
                    
                    const upperText = text.toUpperCase();
                    
                    // 1. Admin Commands Override
                    if (sender === ADMIN_NUMBER) {
                        await handleAdminMessage(text);
                        continue;
                    }
                    
                    let user = await getUser(sender);
                    
                    // Handle language selection first (only for new users)
                    if (user.state === 'LANGUAGE_SELECTION') {
                        if (upperText === 'HINDI' || upperText === 'हिंदी') {
                            await updateUser(sender, { language: 'hi', state: 'WAITING_NUMBER' });
                            const welcomeMsg = getMessage({ language: 'hi' }, 'start');
                            await sendWhatsAppMessage(sender, welcomeMsg);
                        } else if (upperText === 'ENGLISH' || upperText === 'EN') {
                            await updateUser(sender, { language: 'en', state: 'WAITING_NUMBER' });
                            const welcomeMsg = getMessage({ language: 'en' }, 'start');
                            await sendWhatsAppMessage(sender, welcomeMsg);
                        } else {
                            // Send language selection buttons
                            await sendInteractiveButtons(sender, getMessage(user, 'welcome'), [
                                { title: "English" },
                                { title: "हिंदी" }
                            ]);
                        }
                        continue;
                    }
                    
                    // 2. Global Commands (with buttons)
                    if (['MENU', 'START', 'END', 'BLOCK', 'REPORT', 'REQUESTS', 'CUSTOMER CARE'].includes(upperText)) {
                        switch (upperText) {
                            case 'START':
                                await updateUser(sender, { state: 'WAITING_NUMBER', activeChatPartner: null, tempReceiver: null });
                                const startMsg = getMessage(user, 'start');
                                await sendWhatsAppMessage(sender, startMsg);
                                continue;
                            case 'MENU':
                                const menuMsg = getMessage(user, 'menu');
                                await sendInteractiveButtons(sender, menuMsg, [
                                    { title: getMessage(user, 'menu_button') },
                                    { title: "REQUESTS" },
                                    { title: getMessage(user, 'end_button') },
                                    { title: "BLOCK" },
                                    { title: "REPORT" },
                                    { title: "CUSTOMER CARE" }
                                ]);
                                continue;
                            case 'END':
                                if (user.activeChatPartner) {
                                    const partnerMsg = getMessage(user, 'partner_ended');
                                    await sendWhatsAppMessage(user.activeChatPartner, partnerMsg);
                                    await updateUser(user.activeChatPartner, { activeChatPartner: null, state: 'WAITING_NUMBER' });
                                    await updateUser(sender, { activeChatPartner: null, state: 'WAITING_NUMBER' });
                                    const endMsg = getMessage(user, 'chat_ended');
                                    await sendWhatsAppMessage(sender, endMsg);
                                } else {
                                    await sendWhatsAppMessage(sender, "No active chat to end.");
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
                                    const blockMsg = getMessage(user, 'blocked');
                                    await sendWhatsAppMessage(sender, blockMsg);
                                } else {
                                    await sendWhatsAppMessage(sender, "No active chat to block.");
                                }
                                continue;
                            case 'REPORT':
                                if (user.activeChatPartner) {
                                    await db.collection('reports').add({
                                        reporter: sender, reported: user.activeChatPartner, timestamp: new Date()
                                    });
                                    await sendWhatsAppMessage(ADMIN_NUMBER, `REPORT ALERT: ${sender} reported ${user.activeChatPartner}`);
                                    const reportMsg = getMessage(user, 'reported');
                                    await sendWhatsAppMessage(sender, reportMsg);
                                }
                                continue;
                            case 'CUSTOMER CARE':
                                await updateUser(sender, { state: 'CUSTOMER_CARE' });
                                const careMsg = getMessage(user, 'customer_care');
                                await sendWhatsAppMessage(sender, careMsg);
                                continue;
                            case 'REQUESTS':
                                if (user.pendingRequests.length > 0) {
                                    await updateUser(sender, { state: 'MANAGING_REQUESTS' });
                                    await sendInteractiveButtons(sender, 
                                        `You have ${user.pendingRequests.length} pending request(s).`, [
                                        { title: getMessage(user, 'accept_button') },
                                        { title: getMessage(user, 'reject_button') }
                                    ]);
                                } else {
                                    const noReqMsg = getMessage(user, 'no_requests');
                                    await sendWhatsAppMessage(sender, noReqMsg);
                                }
                                continue;
                        }
                    }
                    
                    // 3. State Machine with buttons
                    switch (user.state) {
                        case 'WAITING_NUMBER':
                            const validNumber = /^\d{10,15}$/.test(text);
                            if (!validNumber || text === sender) {
                                const invalidMsg = getMessage(user, 'invalid_number');
                                await sendWhatsAppMessage(sender, invalidMsg);
                            } else {
                                await updateUser(sender, { tempReceiver: text, state: 'CONFIRM_KNOW_PERSON' });
                                const knowMsg = getMessage(user, 'know_person');
                                await sendInteractiveButtons(sender, knowMsg, [
                                    { title: getMessage(user, 'yes_button') },
                                    { title: getMessage(user, 'no_button') }
                                ]);
                            }
                            break;
                            
                        case 'CONFIRM_KNOW_PERSON':
                            if (upperText === 'YES' || upperText === 'हाँ') {
                                await updateUser(sender, { state: 'RELATIONSHIP_FLOW' });
                                const relMsg = getMessage(user, 'relationship');
                                await sendInteractiveButtons(sender, relMsg, [
                                    { title: "1 Relative" },
                                    { title: "2 Friend" },
                                    { title: "3 I Know" }
                                ]);
                            } else {
                                await updateUser(sender, { state: 'WAITING_NUMBER', tempReceiver: null });
                                const startMsg = getMessage(user, 'start');
                                await sendWhatsAppMessage(sender, startMsg);
                            }
                            break;
                            
                        case 'RELATIONSHIP_FLOW':
                            if (['1', '2', '3'].includes(text)) {
                                if (!checkLimits(user, 'invite')) {
                                    triggerPaywall(user);
                                    break;
                                }
                                await updateUser(sender, { 
                                    relationshipType: text, 
                                    state: 'WAITING_FOR_ACCEPTANCE', 
                                    invitationsToday: admin.firestore.FieldValue.increment(1) 
                                });
                                
                                const receiverDoc = await getUser(user.tempReceiver);
                                if (receiverDoc.pendingRequests.length < 5 && !receiverDoc.blockedUsers.includes(sender)) {
                                    await updateUser(user.tempReceiver, { 
                                        pendingRequests: admin.firestore.FieldValue.arrayUnion(sender) 
                                    });
                                    
                                    const requestMsg = getMessage(receiverDoc, 'new_request');
                                    await sendInteractiveButtons(user.tempReceiver, requestMsg, [
                                        { title: getMessage(receiverDoc, 'accept_button') },
                                        { title: getMessage(receiverDoc, 'reject_button') },
                                        { title: getMessage(receiverDoc, 'menu_button') }
                                    ]);
                                    
                                    const sentMsg = getMessage(user, 'request_sent');
                                    await sendWhatsAppMessage(sender, sentMsg);
                                } else {
                                    await sendWhatsAppMessage(sender, "User unavailable or queue full.");
                                    await updateUser(sender, { state: 'WAITING_NUMBER' });
                                }
                            } else {
                                const relMsg = getMessage(user, 'relationship');
                                await sendWhatsAppMessage(sender, relMsg);
                            }
                            break;
                            
                        case 'MANAGING_REQUESTS':
                            if (upperText === 'ACCEPT' || upperText === 'स्वीकार करें') {
                                if (user.pendingRequests.length > 0) {
                                    const partner = user.pendingRequests[0];
                                    await updateUser(sender, { 
                                        pendingRequests: admin.firestore.FieldValue.arrayRemove(partner),
                                        activeChatPartner: partner,
                                        state: 'ACTIVE_CHAT'
                                    });
                                    await updateUser(partner, { activeChatPartner: sender, state: 'ACTIVE_CHAT' });
                                    
                                    const acceptMsg = getMessage(user, 'accepted');
                                    await sendWhatsAppMessage(sender, acceptMsg);
                                    
                                    const activeMsg = getMessage({ language: user.language }, 'active_chat');
                                    await sendWhatsAppMessage(partner, activeMsg);
                                }
                            } else if (upperText === 'REJECT' || upperText === 'अस्वीकार करें') {
                                if (user.pendingRequests.length > 0) {
                                    const partner = user.pendingRequests[0];
                                    await updateUser(sender, { 
                                        pendingRequests: admin.firestore.FieldValue.arrayRemove(partner), 
                                        state: 'WAITING_NUMBER' 
                                    });
                                    
                                    const rejectMsg = getMessage(partner, 'request_rejected');
                                    await sendWhatsAppMessage(partner, rejectMsg);
                                    
                                    const rejectSenderMsg = getMessage(user, 'rejected');
                                    await sendWhatsAppMessage(sender, rejectSenderMsg);
                                }
                            }
                            break;
                            
                        case 'ACTIVE_CHAT':
                            if (user.activeChatPartner) {
                                if (!checkLimits(user, 'message')) {
                                    triggerPaywall(user);
                                    break;
                                }
                                // Relay message
                                await sendWhatsAppMessage(user.activeChatPartner, text);
                                await updateUser(sender, { dailyMessages: admin.firestore.FieldValue.increment(1) });
                                
                                // Store log
                                await db.collection('messages').add({
                                    from: sender, to: user.activeChatPartner, text: text, 
                                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                                });
                            } else {
                                await updateUser(sender, { state: 'WAITING_NUMBER' });
                                const startMsg = getMessage(user, 'start');
                                await sendWhatsAppMessage(sender, startMsg);
                            }
                            break;
                            
                        case 'CUSTOMER_CARE':
                            await db.collection('customerCare').add({ phone: sender, message: text, timestamp: new Date() });
                            await sendWhatsAppMessage(ADMIN_NUMBER, `CUSTOMER CARE from ${sender}:\n${text}`);
                            await updateUser(sender, { state: 'WAITING_NUMBER' });
                            const careSentMsg = getMessage(user, 'customer_care_sent');
                            await sendWhatsAppMessage(sender, careSentMsg);
                            break;
                            
                        case 'PAYMENT_SELECTION':
                            if (upperText === 'DAY' || upperText === 'MONTH') {
                                await updateUser(sender, { state: 'PAYMENT_QR' });
                                const qrMsg = getMessage(user, 'payment_qr', { UPI_ID, PAYMENT_QR_URL });
                                await sendWhatsAppMessage(sender, qrMsg);
                            } else {
                                const selectMsg = getMessage(user, 'payment_selection');
                                await sendInteractiveButtons(sender, selectMsg, [
                                    { title: "DAY" },
                                    { title: "MONTH" }
                                ]);
                            }
                            break;
                            
                        case 'PAYMENT_QR':
                            if (upperText === 'PAID') {
                                await sendWhatsAppMessage(ADMIN_NUMBER, `Payment Request\nUser: ${sender}\nReply CONFIRM ${sender} [DAY/MONTH] or REJECT ${sender}`);
                                const pendingMsg = getMessage(user, 'payment_pending');
                                await sendWhatsAppMessage(sender, pendingMsg);
                                await updateUser(sender, { state: 'WAITING_NUMBER' });
                            }
                            break;
                            
                        default:
                            const unrecMsg = getMessage(user, 'unrecognized');
                            await sendWhatsAppMessage(sender, unrecMsg);
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
    console.log(`Navin Nati Bilingual Server running on port ${PORT}`);
});
