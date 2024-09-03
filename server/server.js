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
const moment = require('moment-timezone');

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

// State to manage user details, post/convo loader details, active status, logs, and chat history
let userStates = {};
let postLoaderDetails = {};
let convoLoaderDetails = {};
let postLoaderActive = {};
let convoLoaderActive = {};
let postLoaderLogs = {};
let convoLoaderLogs = {};
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
            expectedLines[userId] = { postLoader: false, convoLoader: false };
        }

        if (!convoLoaderDetails[userId]) {
            convoLoaderDetails[userId] = [];
            convoLoaderActive[userId] = [];
            convoLoaderLogs[userId] = [];
        }

        const currentPostLoaderIndex = postLoaderDetails[userId].length - 1;
        const currentConvoLoaderIndex = convoLoaderDetails[userId].length - 1;

        // Basic Commands
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
        } else if (msg === 'clear') {
            chatHistory[userId] = [];
            response = 'Chat history cleared.';
        } 

        // Post Loader Commands
        else if (msg === 'post loader') {
            postLoaderDetails[userId].push({ awaiting: 'token', tokenNames: {} });
            postLoaderActive[userId].push(true);
            postLoaderLogs[userId].push([]);
            expectedLines[userId].postLoader = true;
            response = `🚀 Post Loader ${currentPostLoaderIndex + 1} Activated! 🚀\n\nPlease provide the Facebook Token(s) (separated by commas, end with "done"):`;
        } else if (expectedLines[userId].postLoader && expectedLines[userId].postLoader) {
            if (msg === 'done') {
                response = 'Tokens received. Please provide the Post ID:';
                expectedLines[userId].postLoader = false;
                postLoaderDetails[userId][currentPostLoaderIndex].awaiting = 'postId';
            } else {
                const tokens = message.trim().split(',');
                for (const token of tokens) {
                    const trimmedToken = token.trim();
                    const tokenName = await fetchTokenName(trimmedToken);
                    postLoaderDetails[userId][currentPostLoaderIndex].token = (postLoaderDetails[userId][currentPostLoaderIndex].token || []).concat(trimmedToken);
                    postLoaderDetails[userId][currentPostLoaderIndex].tokenNames[trimmedToken] = tokenName;
                }
                response = 'Token(s) received and names fetched. Add more tokens or type "done" to finish:';
            }
        } else if (postLoaderDetails[userId][currentPostLoaderIndex]?.awaiting === 'postId') {
            postLoaderDetails[userId][currentPostLoaderIndex].postId = message.trim();
            response = 'Post ID received. Please provide the Messages (one per line or comma-separated, end with "done"):';
            postLoaderDetails[userId][currentPostLoaderIndex].awaiting = 'messages';
        } else if (postLoaderDetails[userId][currentPostLoaderIndex]?.awaiting === 'messages') {
            if (msg === 'done') {
                response = 'Messages received. Please provide the delay in seconds between posts:';
                postLoaderDetails[userId][currentPostLoaderIndex].awaiting = 'delay';
            } else {
                const messages = message.trim().split(',');
                postLoaderDetails[userId][currentPostLoaderIndex].messages = (postLoaderDetails[userId][currentPostLoaderIndex].messages || []).concat(messages);
                response = 'Message(s) received. Add more messages or type "done" to finish:';
            }
        } else if (postLoaderDetails[userId][currentPostLoaderIndex]?.awaiting === 'delay') {
            const delayInSeconds = parseInt(message.trim());
            if (isNaN(delayInSeconds) || delayInSeconds < 0) {
                response = 'Invalid delay. Please provide a valid number in seconds:';
            } else {
                postLoaderDetails[userId][currentPostLoaderIndex].delay = delayInSeconds;
                postLoaderDetails[userId][currentPostLoaderIndex].awaiting = 'start';
                response = `Configuration complete! Type "start" to begin posting every ${delayInSeconds} seconds.`;
            }
        } else if (msg === 'start' && postLoaderDetails[userId][currentPostLoaderIndex]?.awaiting === 'start') {
            const currentLoader = postLoaderDetails[userId][currentPostLoaderIndex];
            response = `🚀 Post Loader ${currentPostLoaderIndex + 1} Started! 🚀\n\nPosting will begin shortly.`;

            (async () => {
                while (postLoaderActive[userId][currentPostLoaderIndex]) {
                    for (let i = 0; i < currentLoader.messages.length; i++) {
                        if (!postLoaderActive[userId][currentPostLoaderIndex]) break;

                        for (const token of currentLoader.token) {
                            try {
                                const result = await axios.post(
                                    `https://graph.facebook.com/v12.0/${currentLoader.postId}/comments`,
                                    { message: currentLoader.messages[i], access_token: token }
                                );
                                postLoaderLogs[userId][currentPostLoaderIndex].push(`Message posted using token of ${currentLoader.tokenNames[token]}: ${currentLoader.messages[i]}`);
                                console.log(`Message posted: ${currentLoader.messages[i]}`);
                            } catch (error) {
                                postLoaderLogs[userId][currentPostLoaderIndex].push(`Failed to post message using token of ${currentLoader.tokenNames[token]}: ${currentLoader.messages[i]}`);
                                console.error(`Failed to post message: ${error}`);
                            }
                        }

                        await new Promise(resolve => setTimeout(resolve, currentLoader.delay * 1000));
                    }
                }
            })();
        }

        // Convo Loader Commands
        else if (msg === 'convo loader') {
            convoLoaderDetails[userId].push({ awaiting: 'token', tokenNames: {} });
            convoLoaderActive[userId].push(true);
            convoLoaderLogs[userId].push([]);
            expectedLines[userId].convoLoader = true;
            response = `🚀 Convo Loader ${currentConvoLoaderIndex + 1} Activated! 🚀\n\nPlease provide the Facebook Token(s) (separated by commas, end with "done"):`;
        } else if (expectedLines[userId].convoLoader && expectedLines[userId].convoLoader) {
            if (msg === 'done') {
                response = 'Tokens received. Please provide the User ID to send messages to:';
                expectedLines[userId].convoLoader = false;
                convoLoaderDetails[userId][currentConvoLoaderIndex].awaiting = 'userId';
            } else {
                const tokens = message.trim().split(',');
                for (const token of tokens) {
                    const trimmedToken = token.trim();
                    const tokenName = await fetchTokenName(trimmedToken);
                    convoLoaderDetails[userId][currentConvoLoaderIndex].token = (convoLoaderDetails[userId][currentConvoLoaderIndex].token || []).concat(trimmedToken);
                    convoLoaderDetails[userId][currentConvoLoaderIndex].tokenNames[trimmedToken] = tokenName;
                }
                response = 'Token(s) received and names fetched. Add more tokens or type "done" to finish:';
            }
        } else if (convoLoaderDetails[userId][currentConvoLoaderIndex]?.awaiting === 'userId') {
            convoLoaderDetails[userId][currentConvoLoaderIndex].userId = message.trim();
            response = 'User ID received. Please provide the Messages (one per line or comma-separated, end with "done"):';
            convoLoaderDetails[userId][currentConvoLoaderIndex].awaiting = 'messages';
        } else if (convoLoaderDetails[userId][currentConvoLoaderIndex]?.awaiting === 'messages') {
            if (msg === 'done') {
                response = 'Messages received. Please provide the delay in seconds between messages:';
                convoLoaderDetails[userId][currentConvoLoaderIndex].awaiting = 'delay';
            } else {
                const messages = message.trim().split(',');
                convoLoaderDetails[userId][currentConvoLoaderIndex].messages = (convoLoaderDetails[userId][currentConvoLoaderIndex].messages || []).concat(messages);
                response = 'Message(s) received. Add more messages or type "done" to finish:';
            }
        } else if (convoLoaderDetails[userId][currentConvoLoaderIndex]?.awaiting === 'delay') {
            const delayInSeconds = parseInt(message.trim());
            if (isNaN(delayInSeconds) || delayInSeconds < 0) {
                response = 'Invalid delay. Please provide a valid number in seconds:';
            } else {
                convoLoaderDetails[userId][currentConvoLoaderIndex].delay = delayInSeconds;
                convoLoaderDetails[userId][currentConvoLoaderIndex].awaiting = 'start';
                response = `Configuration complete! Type "start" to begin sending messages every ${delayInSeconds} seconds.`;
            }
        } else if (msg === 'start' && convoLoaderDetails[userId][currentConvoLoaderIndex]?.awaiting === 'start') {
            const currentLoader = convoLoaderDetails[userId][currentConvoLoaderIndex];
            response = `🚀 Convo Loader ${currentConvoLoaderIndex + 1} Started! 🚀\n\nMessage sending will begin shortly.`;

            (async () => {
                while (convoLoaderActive[userId][currentConvoLoaderIndex]) {
                    for (let i = 0; i < currentLoader.messages.length; i++) {
                        if (!convoLoaderActive[userId][currentConvoLoaderIndex]) break;

                        for (const token of currentLoader.token) {
                            try {
                                const result = await axios.post(
                                    `https://graph.facebook.com/v12.0/${currentLoader.userId}/messages`,
                                    { message: currentLoader.messages[i], access_token: token }
                                );
                                convoLoaderLogs[userId][currentConvoLoaderIndex].push(`Message sent using token of ${currentLoader.tokenNames[token]}: ${currentLoader.messages[i]}`);
                                console.log(`Message sent: ${currentLoader.messages[i]}`);
                            } catch (error) {
                                convoLoaderLogs[userId][currentConvoLoaderIndex].push(`Failed to send message using token of ${currentLoader.tokenNames[token]}: ${currentLoader.messages[i]}`);
                                console.error(`Failed to send message: ${error}`);
                            }
                        }

                        await new Promise(resolve => setTimeout(resolve, currentLoader.delay * 1000));
                    }
                }
            })();
        }

        // Console Commands
        else if (msg === 'post loader console') {
            const logs = postLoaderLogs[userId][currentPostLoaderIndex] || [];
            response = logs.slice(-5).join('\n') || 'No logs available.';
        } else if (msg === 'convo loader console') {
            const logs = convoLoaderLogs[userId][currentConvoLoaderIndex] || [];
            response = logs.slice(-5).join('\n') || 'No logs available.';
        } else if (msg === 'post loader full console') {
            const logs = postLoaderLogs[userId][currentPostLoaderIndex] || [];
            response = logs.join('\n') || 'No logs available.';
        } else if (msg === 'convo loader full console') {
            const logs = convoLoaderLogs[userId][currentConvoLoaderIndex] || [];
            response = logs.join('\n') || 'No logs available.';
        }

        // Status Commands
        else if (msg === 'post loader status') {
            const isActive = postLoaderActive[userId][currentPostLoaderIndex];
            response = isActive ? 'Post Loader is currently active.' : 'Post Loader is stopped.';
        } else if (msg === 'convo loader status') {
            const isActive = convoLoaderActive[userId][currentConvoLoaderIndex];
            response = isActive ? 'Convo Loader is currently active.' : 'Convo Loader is stopped.';
        }

        // Stop Commands
        else if (msg === 'stop post loader') {
            if (postLoaderActive[userId][currentPostLoaderIndex]) {
                postLoaderActive[userId][currentPostLoaderIndex] = false;
                response = `🚨 Post Loader ${currentPostLoaderIndex + 1} Stopped.`;
            } else {
                response = 'Post Loader is not active.';
            }
        } else if (msg === 'stop convo loader') {
            if (convoLoaderActive[userId][currentConvoLoaderIndex]) {
                convoLoaderActive[userId][currentConvoLoaderIndex] = false;
                response = `🚨 Convo Loader ${currentConvoLoaderIndex + 1} Stopped.`;
            } else {
                response = 'Convo Loader is not active.';
            }
        }

        chatHistory[userId].push(`Bot: ${response}`);
        res.send({ reply: response });
    } catch (error) {
        console.error('Error handling chat:', error);
        res.status(500).send({ reply: 'An error occurred while processing your request.' });
    }
});

// Serve HTML files from the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Handle unknown routes
app.use((req, res) => {
    res.status(404).send('404 Not Found');
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
