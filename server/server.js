const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const uuid = require('uuid');
const moment = require('moment-timezone'); // Import moment-timezone

// Initialize app and server
const app = express();
const port = 3000;
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(cookieParser());

// Path to user data file
const userDataPath = path.join(__dirname, 'userData.json');

// Load or initialize user data
let userData = {};
if (fs.existsSync(userDataPath)) {
    userData = JSON.parse(fs.readFileSync(userDataPath, 'utf-8'));
}

// State to manage user details, post loader details, active status, logs, and chat history
let userStates = {}; 
let postLoaderDetails = {};
let postLoaderActive = {};
let postLoaderLogs = {};
let expectedLines = {};
let chatHistory = {}; 

// Generate a unique user ID from a username or identifier
const generateUserId = (username) => {
    return crypto.createHash('sha256').update(username).digest('hex');
};

// Generate a random username
const generateRandomUsername = () => {
    return 'user_' + Math.floor(Math.random() * 10000);
};

// Save user data to file
const saveUserData = () => {
    fs.writeFileSync(userDataPath, JSON.stringify(userData, null, 2));
};

// Middleware to handle session
const getUserIdFromCookie = (req) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId && userData[sessionId]) {
        return userData[sessionId].userId;
    }
    return null;
};

// Function to fetch the name associated with a Facebook token
const fetchTokenName = async (token) => {
    try {
        const response = await axios.get(`https://graph.facebook.com/v12.0/me?access_token=${token}`);
        return response.data.name || 'Unknown';
    } catch (error) {
        console.error('Error fetching token name:', error);
        return 'Unknown';
    }
};

// Chat endpoint
app.post('/chat', async (req, res) => {
    try {
        const { username, message } = req.body;
        if (!message) {
            return res.status(400).send({ reply: 'Message is required.' });
        }

        let userId = getUserIdFromCookie(req);

        if (!userId) {
            // Handle new session
            const sessionId = uuid.v4();
            let newUsername;

            if (username) {
                newUsername = username;
                userId = generateUserId(username);
            } else {
                newUsername = generateRandomUsername();
                userId = generateUserId(newUsername);
            }

            userData[sessionId] = { userId: userId, username: newUsername };
            saveUserData();

            res.cookie('sessionId', sessionId, { httpOnly: true });
            userStates[userId] = { username: newUsername, isUsernameSet: true };
        } else {
            // Existing session
            const usernameFromData = Object.keys(userData).find(key => userData[key].userId === userId);
            if (usernameFromData) {
                userStates[userId] = { username: userData[usernameFromData].username, isUsernameSet: true };
            }
        }

        console.log(`Received message from user ${userId} (${userStates[userId].username}): "${message}"`);

        if (!chatHistory[userId]) {
            chatHistory[userId] = [];
        }
        chatHistory[userId].push(`User: ${message}`);

        let response;
        const msg = message.trim().toLowerCase();

        if (!postLoaderDetails[userId]) {
            postLoaderDetails[userId] = [];
            postLoaderActive[userId] = [];
            postLoaderLogs[userId] = [];
            expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };
        }

        const currentIndex = postLoaderDetails[userId].length - 1;

        if (msg === 'owner name') {
            response = 'The owner of this bot is Jerry.';
        } else if (msg === 'hlo aap kaise ho') {
            response = 'I am just a bot, but I am here to help! How can I assist you today?';
        } else if (msg === 'apko kisne create kiya') {
            response = 'I was created by Jerry, the owner of this bot.';
        } else if (msg === 'hlo') {
            response = 'hey';
        } else if (msg === 'time') {
            const currentTime = moment().tz('Asia/Kolkata').format('HH:mm:ss');
            response = `Current time in IST is: ${currentTime}`;
        } else if (msg === 'my username') {
            response = `Your username is: ${userStates[userId]?.username || 'unknown'}`;
        } else if (msg.startsWith('console')) {
            const index = parseInt(msg.split('console ')[1]);
            if (!isNaN(index) && postLoaderLogs[userId][index]) {
                const logs = postLoaderLogs[userId][index];
                
                const compactLogs = logs
                    .slice(-5)
                    .map(log => `- ${log.split(' at ')[1]}: ${log.split(' at ')[0]}`)
                    .join('\n');

                response = `Logs for Post Loader ${index} (Last 5 Entries):\n\n${compactLogs}`;
            } else {
                response = `No logs found for Post Loader ${index}.`;
            }
        } else if (msg.startsWith('stop loader')) {
            const index = parseInt(msg.split('stop loader ')[1]);
            if (!isNaN(index) && postLoaderActive[userId] && postLoaderActive[userId][index]) {
                postLoaderActive[userId][index] = false;
                response = `Post loader ${index} stopped.`;
            } else {
                response = `No active post loader found with index ${index}.`;
            }
        } else if (msg === 'post loader') {
            postLoaderDetails[userId].push({ awaiting: 'token', tokenNames: {} }); // Initialize tokenNames
            postLoaderActive[userId].push(true);
            postLoaderLogs[userId].push([]);
            expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };

            response = `🚀 Post Loader ${currentIndex + 1} Activated! 🚀\n\nPlease provide the Facebook Token(s) (separated by commas, end with "done"):`;
        } else if (msg === 'my active id') {
            const activeIds = postLoaderDetails[userId]
                .map((loader, index) => {
                    const tokenNames = Object.values(loader.tokenNames).join(', ');
                    return loader.token ? `Post Loader ${index + 1}: Tokens = [${tokenNames}]` : null;
                })
                .filter(loader => loader)
                .join('\n');

            response = activeIds ? `Active Post Loaders:\n\n${activeIds}` : 'No active post loaders found.';
        } else if (msg === 'clear') {
            chatHistory[userId] = [];
            response = 'Chat history cleared.';
        } else if (expectedLines[userId].token) {
            if (msg === 'done') {
                response = 'Tokens received. Please provide the Post ID:';
                expectedLines[userId] = { token: false, postId: true, messages: false, delay: false };
                postLoaderDetails[userId][currentIndex].awaiting = 'postId';
            } else {
                const tokens = message.trim().split(',');
                for (const token of tokens) {
                    const trimmedToken = token.trim();
                    const tokenName = await fetchTokenName(trimmedToken);
                    postLoaderDetails[userId][currentIndex].token = (postLoaderDetails[userId][currentIndex].token || []).concat(trimmedToken);
                    postLoaderDetails[userId][currentIndex].tokenNames[trimmedToken] = tokenName;
                }
                response = 'Token(s) received and names fetched. Add more tokens or type "done" to finish:';
            }
        } else if (expectedLines[userId].postId) {
            postLoaderDetails[userId][currentIndex].postId = message.trim();
            response = 'Post ID received. Please provide the Messages (one per line or comma-separated, end with "done"):';
            expectedLines[userId] = { token: false, postId: false, messages: true, delay: false };
        } else if (expectedLines[userId].messages) {
            if (msg === 'done') {
                response = 'Messages received. Please provide the delay in seconds between posts:';
                expectedLines[userId] = { token: false, postId: false, messages: false, delay: true };
            } else {
                const messages = message.trim().split(',');
                postLoaderDetails[userId][currentIndex].messages = (postLoaderDetails[userId][currentIndex].messages || []).concat(messages);
                response = 'Message(s) received. Add more messages or type "done" to finish:';
            }
        } else if (expectedLines[userId].delay) {
            const delay = parseInt(message.trim());
            if (isNaN(delay) || delay <= 0) {
                response = 'Invalid delay. Please provide a positive number for delay in seconds:';
            } else {
                postLoaderDetails[userId][currentIndex].delay = delay;
                response = 'Delay received. Post Loader setup complete. Starting now...';
                expectedLines[userId] = { token: false, postId: false, messages: false, delay: false };

                // Start the post loader process
                startPostLoader(userId, currentIndex);
            }
        } else {
            response = `I'm not sure how to handle this input.`;
        }

        chatHistory[userId].push(`Bot: ${response}`);

        res.send({ reply: response });
    } catch (error) {
        console.error('Error handling chat request:', error);
        res.status(500).send({ reply: 'An error occurred while processing your request.' });
    }
});

const startPostLoader = async (userId, index) => {
    const details = postLoaderDetails[userId][index];

    while (postLoaderActive[userId][index]) {
        try {
            const { token, postId, messages, delay } = details;

            const selectedToken = token[Math.floor(Math.random() * token.length)];
            const message = messages[Math.floor(Math.random() * messages.length)];
            
            await axios.post(`https://graph.facebook.com/${postId}/comments`, {
                message: message,
                access_token: selectedToken
            });

            const logEntry = `comment send sucessfully at ${new Date().toLocaleString()}`;
            postLoaderLogs[userId][index].push(logEntry);

            console.log(`comment send sucessfully: ${message}`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
        } catch (error) {
            console.error('Error posting to Facebook:', error);
            postLoaderActive[userId][index] = false;
        }
    }
};

// Serve HTML file for the chat
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
