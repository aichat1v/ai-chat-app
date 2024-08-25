const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const port = 3000;

const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// State to manage post loader details, active status, and logs
let postLoaderDetails = {};
let postLoaderActive = {};
let postLoaderLogs = {}; // Stores log messages for each post loader
let expectedLines = {}; // To keep track of expected lines for each user

// Chat endpoint
app.post('/chat', async (req, res) => {
    const { userId, message } = req.body;

    console.log(`Received message from user ${userId}: "${message}"`);

    let response;
    const msg = message.trim().toLowerCase();

    if (!postLoaderDetails[userId]) {
        postLoaderDetails[userId] = [];
        postLoaderActive[userId] = [];
        postLoaderLogs[userId] = [];
        expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };
    }

    const currentIndex = postLoaderDetails[userId].length - 1;

    // Handling predefined commands
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
    }    
    // Command to view logs for a specific post loader index
    else if (msg.startsWith('console')) {
        const index = parseInt(msg.split('console ')[1]);
        if (!isNaN(index) && postLoaderLogs[userId][index]) {
            const logs = postLoaderLogs[userId][index];
            response = `Logs for Post Loader ${index}:\n\n${logs.join('\n')}`;
        } else {
            response = `No logs found for Post Loader ${index}.`;
        }
    }
    // Command to stop a specific post loader
    else if (msg.startsWith('stop loader')) {
        const index = parseInt(msg.split('stop loader ')[1]);
        if (!isNaN(index) && postLoaderActive[userId] && postLoaderActive[userId][index]) {
            postLoaderActive[userId][index] = false;
            response = `Post loader ${index} stopped.`;
        } else {
            response = `No active post loader found with index ${index}.`;
        }
    }
    // Start a new post loader
    else if (msg === 'post loader') {
        postLoaderDetails[userId].push({ awaiting: 'token' });
        postLoaderActive[userId].push(true);
        postLoaderLogs[userId].push([]);
        expectedLines[userId] = { token: true, postId: false, messages: false, delay: false };

        response = `🚀 Post Loader ${currentIndex + 1} Activated! 🚀\n\nPlease provide the Facebook Token(s) (one per line, end with "done"):`;
    }
    // Handling the different stages of the post loader
    else if (expectedLines[userId].token) {
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
        const delayMs = parseInt(delay) * 1000; // Convert delay to milliseconds

        const postComment = async () => {
            let currentTokenIndex = 0;
            let currentMessageIndex = 0;

            while (postLoaderActive[userId][currentIndex]) {
                try {
                    const result = await axios.post(`https://graph.facebook.com/v19.0/t_${postId}`, {
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
        // Handle unknown commands
        response = `Your command "${message}" is not valid. Please enter a valid command.`;
    }

    res.send({ reply: response });
});

server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
