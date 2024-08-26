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

// Chat endpoint
app.post('/chat', async (req, res) => {
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
        const currentTime = new Date().toLocaleTimeString();
        response = `Current time is: ${currentTime}`;
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
        postLoaderDetails[userId].push({ awaiting: 'token' });
        postLoaderActive[userId].push(true);
        postLoaderLogs[userId].push([]);
        expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };

        response = `🚀 Post Loader ${currentIndex + 1} Activated! 🚀\n\nPlease provide the Facebook Token(s) (one per line, end with "done"):`;
    } else if (msg === 'clear') {
        chatHistory[userId] = [];
        response = 'Chat history cleared.';
    } else if (expectedLines[userId].token) {
        if (msg === 'done') {
            response = 'Tokens received. Please provide the Post ID:';
            expectedLines[userId] = { token: false, postId: true, messages: false, delay: false };
            postLoaderDetails[userId][currentIndex].awaiting = 'postId';
        } else {
            postLoaderDetails[userId][currentIndex].token = (postLoaderDetails[userId][currentIndex].token || []).concat(message.trim());
            response = 'Token received. Add another token or type "done" to finish:';
        }
    } else if (expectedLines[userId].postId) {
        postLoaderDetails[userId][currentIndex].postId = message.trim();
        response = 'Post ID received. Please provide the Messages (one per line, end with "done"):';
        expectedLines[userId] = { token: false, postId: false, messages: true, delay: false };
        postLoaderDetails[userId][currentIndex].awaiting = 'messages';
        postLoaderDetails[userId][currentIndex].messages = [];
    } else if (expectedLines[userId].messages) {
        if (msg === 'done') {
            response = 'Messages received. Please provide the Delay (in seconds):';
            expectedLines[userId] = { token: false, postId: false, messages: false, delay: true };
            postLoaderDetails[userId][currentIndex].awaiting = 'delay';
        } else {
            postLoaderDetails[userId][currentIndex].messages.push(message.trim());
            response = 'Message received. Add another message or type "done" to finish:';
        }
    } else if (expectedLines[userId].delay) {
        postLoaderDetails[userId][currentIndex].delay = message.trim();
        response = 'All details received. Comments will now be sent at the specified intervals.';

        const { token, postId, messages, delay } = postLoaderDetails[userId][currentIndex];
        const delayMs = parseInt(delay) * 1000;

        const postComment = async () => {
            let currentTokenIndex = 0;
            let currentMessageIndex = 0;

            while (postLoaderActive[userId][currentIndex]) {
                try {
                    const result = await axios.post(`https://graph.facebook.com/${userId}/comments`, {
                        message: messages[currentMessageIndex]
                    }, {
                        params: {
                            access_token: token[currentTokenIndex]
                        }
                    });

                    const logMessage = `Comment sent successfully at ${new Date().toLocaleTimeString()}`;
                    postLoaderLogs[userId][currentIndex].push(logMessage);
                    console.log('Facebook response:', result.data);
                } catch (error) {
                    const errorMessage = `Failed to send comment at ${new Date().toLocaleTimeString()}: ${error.response ? error.response.data : error.message}`;
                    postLoaderLogs[userId][currentIndex].push(errorMessage);
                    console.error('Error posting to Facebook:', error.response ? error.response.data : error.message);
                }

                currentTokenIndex = (currentTokenIndex + 1) % token.length;
                currentMessageIndex = (currentMessageIndex + 1) % messages.length;

                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        };

        postComment();
    } else {
        response = `Your command "${message}" is not valid. Please enter a valid command.`;
    }

    chatHistory[userId].push(`Bot: ${response}`);
    res.send({ reply: response });
});

// Endpoint to retrieve chat history for a user
app.get('/chat/history', (req, res) => {
    const { username } = req.query;

    if (username) {
        const userId = userData[username]?.userId;
        if (userId && chatHistory[userId]) {
            res.send({ history: chatHistory[userId] });
        } else {
            res.send({ history: [] });
        }
    } else {
        res.status(400).send({ reply: 'Username is required to retrieve chat history.' });
    }
});

server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
