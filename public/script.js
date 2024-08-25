// script.js

document.addEventListener('DOMContentLoaded', () => {
    const chatBox = document.getElementById('chat-box');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const fileInput = document.getElementById('file-input');

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    fileInput.addEventListener('change', handleFileUpload);

    async function sendMessage() {
        const message = messageInput.value.trim();
        if (message === '') return;

        addMessage('user', message);
        messageInput.value = '';

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: 'user123', message })
            });
            const data = await response.json();
            addMessage('bot', data.reply);
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    function addMessage(sender, message) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}`;
        messageElement.innerHTML = `<div class="content">${message}</div>`;
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function handleFileUpload() {
        const file = fileInput.files[0];
        if (file) {
            addMessage('user', `Uploaded file: ${file.name}`);
            // Handle file upload logic here if needed
        }
    }
});
