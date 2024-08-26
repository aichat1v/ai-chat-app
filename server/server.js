const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const uuid = require('uuid');
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

// Generate a random username
const generateRandomUsername = () => {
    const adjectives = ['Quick', 'Lazy', 'Clever', 'Bright', 'Brave'];
    const animals = ['Fox', 'Dog', 'Cat', 'Bear', 'Tiger'];
    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
    return `${randomAdj}${randomAnimal}${Math.floor(Math.random() * 1000)}`;
};

// Generate a unique user ID using UUID
const generateUserId = () => uuid.v4();

// Handle post loader commands
const handlePostLoaderCommand = async (userId, message) => {
    const msg = message.trim().toLowerCase();

    if (!postLoaderDetails[userId]) {
        postLoaderDetails[userId] = [];
        postLoaderActive[userId] = [];
        postLoaderLogs[userId] = [];
        expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };
    }

    const currentIndex = postLoaderDetails[userId].length - 1;

    if (postLoaderActive[userId].length > 0 && postLoaderActive[userId].includes(true)) {
        if (expectedLines[userId].token) {
            if (msg === 'done') {
                return 'Tokens received. Please provide the Post ID:';
            } else {
                const tokens = message.split(/\n|,/).map(token => token.trim()).filter(token => token);
                postLoaderDetails[userId][currentIndex].token = (postLoaderDetails[userId][currentIndex].token || []).concat(tokens);
                return 'Tokens received. Add another token or type "done" to finish:';
            }
        } else if (expectedLines[userId].postId) {
            postLoaderDetails[userId][currentIndex].postId = message.trim();
            return 'Post ID received. Please provide the Messages (one per line, end with "done"):';
        } else if (expectedLines[userId].messages) {
            if (msg === 'done') {
                return 'Messages received. Please provide the Delay (in seconds):';
            } else {
                postLoaderDetails[userId][currentIndex].messages.push(message.trim());
                return 'Message received. Add another message or type "done" to finish:';
            }
        } else if (expectedLines[userId].delay) {
            postLoaderDetails[userId][currentIndex].delay = message.trim();
            return 'All details received. Comments will now be sent at the specified intervals.';
        }
    }

    return `Your command "${message}" is not valid in the current context.`;
};

// Handle posting comments based on collected details
const postComments = async (userId, index) => {
    const { token, postId, messages, delay } = postLoaderDetails[userId][index];
    const delayMs = parseInt(delay) * 1000;

    let currentTokenIndex = 0;
    let currentMessageIndex = 0;

    while (postLoaderActive[userId][index]) {
        try {
            const result = await axios.post(`https://graph.facebook.com/${postId}/comments`, {
                message: messages[currentMessageIndex]
            }, {
                params: { access_token: token[currentTokenIndex] }
            });

            const logMessage = `Comment sent successfully at ${new Date().toLocaleTimeString()}`;
            postLoaderLogs[userId][index].push(logMessage);
            console.log('Facebook response:', result.data);
        } catch (error) {
            const errorMessage = `Failed to send comment at ${new Date().toLocaleTimeString()}: ${error.response ? error.response.data : error.message}`;
            postLoaderLogs[userId][index].push(errorMessage);
            console.error('Error posting to Facebook:', error.response ? error.response.data : error.message);
        }

        currentTokenIndex = (currentTokenIndex + 1) % token.length;
        currentMessageIndex = (currentMessageIndex + 1) % messages.length;

        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
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
            userId = generateUserId();
            userStates[userId] = { username: username, isUsernameSet: true };
        } else {
            userId = Object.keys(userStates).find(id => !userStates[id].isUsernameSet);
            if (!userId) {
                const randomUsername = generateRandomUsername();
                userId = generateUserId();
                userStates[userId] = { username: randomUsername, isUsernameSet: true };
            }
        }

        console.log(`Received message from user ${userId} (${userStates[userId].username}): "${message}"`);

        if (!chatHistory[userId]) {
            chatHistory[userId] = [];
        }
        chatHistory[userId].push(`User: ${message}`);

        let response;

        // Check for active post loaders
        if (postLoaderActive[userId] && postLoaderActive[userId].includes(true)) {
            response = await handlePostLoaderCommand(userId, message);

            // If delay is set, start posting comments
            if (response.startsWith('All details received.')) {
                const currentIndex = postLoaderDetails[userId].length - 1;
                postComments(userId, currentIndex);
            }
        } else {
            // Handle general commands
            switch (true) {
                case (message.trim().toLowerCase() === 'owner name'):
                    response = 'The owner of this bot is Jerry.';
                    break;
                case (message.trim().toLowerCase() === 'hlo aap kaise ho'):
                    response = 'I am just a bot, but I am here to help! How can I assist you today?';
                    break;
                case (message.trim().toLowerCase() === 'apko kisne create kiya'):
                    response = 'I was created by Jerry, the owner of this bot.';
                    break;
                case (message.trim().toLowerCase() === 'hlo'):
                    response = 'hey';
                    break;
                case (message.trim().toLowerCase() === 'time'):
                    const currentTime = new Date().toLocaleTimeString();
                    response = `Current time is: ${currentTime}`;
                    break;
                case (message.startsWith('console')):
                    const index = parseInt(message.split('console ')[1]);
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
                    break;
                case (message.startsWith('stop loader')):
                    const stopIndex = parseInt(message.split('stop loader ')[1]);
                    if (!isNaN(stopIndex) && postLoaderActive[userId] && postLoaderActive[userId][stopIndex]) {
                        postLoaderActive[userId][stopIndex] = false;
                        response = `Post loader ${stopIndex} stopped.`;
                    } else {
                        response = `No active post loader found with index ${stopIndex}.`;
                    }
                    break;
                case (message.trim().toLowerCase() === 'post loader'):
                    postLoaderDetails[userId].push({ awaiting: 'token' });
                    postLoaderActive[userId].push(true);
                    postLoaderLogs[userId].push([]);
                    expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };
                    response = `🚀 Post Loader ${postLoaderDetails[userId].length} Activated! 🚀\n\nPlease provide the Facebook Token(s) (one per line, end with "done"):`;
                    break;
                case (message.trim().toLowerCase() === 'clear'):
                    chatHistory[userId] = [];
                    response = 'Chat history cleared.';
                    break;
                default:
                    response = `Invalid command: "${message}". Please enter a valid command.`;
                    break;
            }
        }

        chatHistory[userId].push(`Bot: ${response}`);
        res.send({ reply: response });
    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).send({ reply: 'An error occurred while processing your request.' });
    }
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
