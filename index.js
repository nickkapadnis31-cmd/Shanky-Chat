const express = require('express');
const app = express();

// Read the token from Render Environment Variables
const VERIFY_TOKEN = process.env.Verify_token; 

// Define your webhook endpoint
app.get('/webhook', (req, res) => {
    // Facebook sends these params: hub.mode, hub.verify_token, hub.challenge
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Check if a mode and token were sent
    if (mode && token) {
        // Check the mode and token sent is correct
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            // Respond with the challenge token from the request
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            // Responds with '403 Forbidden' if verify tokens do not match
            res.sendStatus(403);      
        }
    } else {
        res.sendStatus(400); // Bad Request
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});