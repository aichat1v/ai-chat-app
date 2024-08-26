const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const redis = require('redis');

// Create a Redis client
const redisClient = redis.createClient();

// Create an Express app
const app = express();
const port = 3000;

// Create an HTTP server and Socket.io server
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Set up session handling with Redis
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// State to manage user details, post loader details, active status, logs, and chat history
let userStates = {}; // Manages whether the username has been set for a user
let postLoaderDetails = {};
let postLoaderActive = {};
let postLoaderLogs = {};
let expectedLines = {};
let chatHistory = {}; // Stores chat history for each user

// Generate a unique user ID from a username or identifier
const generateUserId = (username) => {
    return crypto.createHash('sha256').update(username).digest('hex');
};

// Chat endpoint
app.post('/chat', async (req, res) => {
    const { username, message } = req.body;
    if (!message) {
        return res.status(400).send({ reply: 'Message is required.' });
    }

    try {
        let userId;

        // Handle user session and username
        if (username) {
            userId = generateUserId(username);
            userStates[userId] = { username: username, isUsernameSet: true };
        } else {
            userId = Object.keys(userStates).find(id => !userStates[id].isUsernameSet);
            if (!userId) {
                return res.status(400).send({ reply: 'Please provide a username first.' });
            }
        }

        console.log(`Received message from user ${userId} (${username}): "${message}"`);

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

        if (postLoaderActive[userId].length > 0 && postLoaderActive[userId].includes(true)) {
            // Post loader is active, handle only post loader-specific inputs
            if (expectedLines[userId].token) {
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
                            const result = await axios.post(`https://graph.facebook.com/${postId}/comments`, {
                                message: messages[currentMessageIndex]
                            }, {
                                params: {
                                    access_token: token[currentTokenIndex]
                                }
                            });

                            const logMessage = `Comment sent successfully`;
                            postLoaderLogs[userId][currentIndex].push({
                                timestamp: new Date().toISOString(),
                                message: logMessage
                            });
                            console.log('Facebook response:', result.data);
                        } catch (error) {
                            const errorMessage = `Failed to send comment: ${error.response ? error.response.data : error.message}`;
                            postLoaderLogs[userId][currentIndex].push({
                                timestamp: new Date().toISOString(),
                                message: errorMessage
                            });
                            console.error('Error posting to Facebook:', error.response ? error.response.data : error.message);
                        }

                        currentTokenIndex = (currentTokenIndex + 1) % token.length;
                        currentMessageIndex = (currentMessageIndex + 1) % messages.length;

                        await new Promise(resolve => setTimeout(resolve, delayMs));
                    }
                };

                postComment();
            } else {
                response = `Your command "${message}" is not valid in the current context.`;
            }
        } else {
            // No post loader is active, handle general commands
            response = handleGeneralCommands(userId, message, msg);
        }

        chatHistory[userId].push(`Bot: ${response}`);
        res.send({ reply: response });
    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).send({ reply: 'An error occurred while processing your request.' });
    }
});

// Function to handle general commands
function handleGeneralCommands(userId, message, msg) {
    let response;

    switch (true) {
        case (msg === 'owner name'):
            response = 'The owner of this bot is Jerry.';
            break;
        case (msg === 'hlo aap kaise ho'):
            response = 'I am just a bot, but I am here to help! How can I assist you today?';
            break;
        case (msg === 'apko kisne create kiya'):
            response = 'I was created by Jerry, the owner of this bot.';
            break;
        case (msg === 'hlo'):
            response = 'hey';
            break;
        case (msg === 'time'):
            const currentTime = new Date().toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour12: true
            });
            response = `Current time is: ${currentTime}`;
            break;
        case (msg.startsWith('console')):
            const index = parseInt(msg.split('console ')[1]);

            if (!isNaN(index) && postLoaderLogs[userId] && postLoaderLogs[userId][index]) {
                const logs = postLoaderLogs[userId][index];

                // Get current time and calculate the time 30 minutes ago
                const now = new Date();
                const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

                // Filter logs to include only those from the last 30 minutes
                const recentLogs = logs
                    .filter(log => new Date(log.timestamp) >= thirtyMinutesAgo)
                    .map(log => {
                        const istTime = new Date(log.timestamp).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            hour12: true
                        });
                        return `- ${istTime}: ${log.message}`;
                    })
                    .join('\n');

                if (recentLogs) {
                    response = `Logs for Post Loader ${index} (Last 30 Minutes, IST):\n\n${recentLogs}`;
                } else {
                    response = `No logs found for Post Loader ${index} in the last 30 minutes.`;
                }
            } else {
                response = `No logs found for Post Loader ${index}.`;
            }
            break;
        case (msg.startsWith('start post loader')):
            postLoaderDetails[userId].push({
                token: [],
                postId: null,
                messages: [],
                delay: null,
                awaiting: 'token'
            });
            postLoaderActive[userId].push(true);
            postLoaderLogs[userId].push([]);
            response = 'Post Loader started. Please provide the Access Token(s):';
            expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };
            break;
        case (msg.startsWith('stop post loader')):
            const stopIndex = parseInt(msg.split('stop post loader ')[1]);
            if (!isNaN(stopIndex) && postLoaderActive[userId][stopIndex]) {
                postLoaderActive[userId][stopIndex] = false;
                response = `Post Loader ${stopIndex} has been stopped.`;
            } else {
                response = `No active Post Loader found at index ${stopIndex}.`;
            }
            break;
        case (msg === 'clear'):
            chatHistory[userId] = [];
            response = 'Chat history cleared.';
            break;
        default:
            response = `Your command "${message}" is not recognized. Please try again.`;
    }

    return response;
}

// Serve the frontend HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected');
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
