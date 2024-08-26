const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const uuid = require('uuid');
const cookieParser = require('cookie-parser');
const session = require('express-session');

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

// Set up session handling with in-memory store
app.use(session({
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
                // If no user session, assign a random username and generate user ID
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
        const msg = message.trim().toLowerCase();

        if (!postLoaderDetails[userId]) {
            postLoaderDetails[userId] = [];
            postLoaderActive[userId] = [];
            postLoaderLogs[userId] = [];
            expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };
        }

        const currentIndex = postLoaderDetails[userId].length - 1;

        // Handle commands depending on the post loader state
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
                response = `Your command "${message}" is not valid in the current context.`;
            }
        } else {
            // No post loader is active, handle general commands
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
                    const currentTime = new Date().toLocaleTimeString();
                    response = `Current time is: ${currentTime}`;
                    break;
                case (msg.startsWith('console')):
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
                    break;
                case (msg.startsWith('stop loader')):
                    const stopIndex = parseInt(msg.split('stop loader ')[1]);
                    if (!isNaN(stopIndex) && postLoaderActive[userId] && postLoaderActive[userId][stopIndex]) {
                        postLoaderActive[userId][stopIndex] = false;
                        response = `Post loader ${stopIndex} stopped.`;
                    } else {
                        response = `No active post loader found with index ${stopIndex}.`;
                    }
                    break;
                case (msg === 'post loader'):
                    postLoaderDetails[userId].push({ awaiting: 'token' });
                    postLoaderActive[userId].push(true);
                    postLoaderLogs[userId].push([]);
                    expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };
                    response = `🚀 Post Loader ${postLoaderDetails[userId].length} Activated! 🚀\n\nPlease provide the Facebook Token(s) (one per line, end with "done"):`;
                    break;
                case (msg === 'clear'):
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

// Endpoint to retrieve chat history for a user
app.get('/chat/history', (req, res) => {
    const { username } = req.query;

    if (username) {
        const userId = Object.keys(userStates).find(id => userStates[id].username === username);
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
