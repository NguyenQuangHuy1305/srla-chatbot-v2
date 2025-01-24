document.addEventListener('DOMContentLoaded', function () {
    const MAX_CHAT_HISTORY = 5;

    const chatContainer = document.getElementById('chat-container');
    const userInput = document.getElementById('user-input');
    const sendButton = document.querySelector('button');
    const paginationContainer = document.getElementById('pagination-container');
    const pdfSection = document.getElementById('pdf-section');
    const pdfViewer = document.getElementById('pdf-viewer');
    const chatSection = document.getElementById('chat-section');
    const closePdfButton = document.getElementById('close-pdf');

    let chatHistory = [];

    function showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'mb-4 text-left';
        typingDiv.id = 'typing-indicator';

        const typingBubble = document.createElement('div');
        typingBubble.className = 'typing-indicator';

        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('span');
            typingBubble.appendChild(dot);
        }

        typingDiv.appendChild(typingBubble);
        chatContainer.appendChild(typingDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function removeTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    function displayPagination(pageInfo) {
        if (!pageInfo || !pageInfo.total_pages) {
            paginationContainer.classList.add('hidden');
            return;
        }

        paginationContainer.classList.remove('hidden');
        paginationContainer.innerHTML = '';

        // Add "Previous" link
        if (pageInfo.current_page > 1) {
            const prevLink = document.createElement('span');
            prevLink.className = 'cursor-pointer hover:underline text-blue-500 mr-4';
            prevLink.textContent = 'Previous';
            prevLink.addEventListener('click', () => {
                handlePaginationClick(`Show me page ${pageInfo.current_page - 1}`);
            });
            paginationContainer.appendChild(prevLink);
        }

        // Add page numbers
        for (let i = 1; i <= pageInfo.total_pages; i++) {
            const pageLink = document.createElement('span');
            pageLink.className = `cursor-pointer hover:underline mx-1 ${i === pageInfo.current_page
                ? 'text-blue-600 font-bold'
                : 'text-blue-500'
                }`;
            pageLink.textContent = i;

            pageLink.addEventListener('click', () => {
                if (i !== pageInfo.current_page) {
                    handlePaginationClick(`Show me page ${i}`);
                }
            });

            paginationContainer.appendChild(pageLink);
        }

        // Add "Next" link
        if (pageInfo.current_page < pageInfo.total_pages) {
            const nextLink = document.createElement('span');
            nextLink.className = 'cursor-pointer hover:underline text-blue-500 ml-4';
            nextLink.textContent = 'Next';
            nextLink.addEventListener('click', () => {
                handlePaginationClick(`Show me page ${pageInfo.current_page + 1}`);
            });
            paginationContainer.appendChild(nextLink);
        }
    }

    function openPdfViewer(url) {
        // Extract document name from URL for the title
        const decodedUrl = decodeURIComponent(url);
        const documentName = decodedUrl.split('/').pop().split('?')[0];

        // Update the PDF viewer title
        const pdfTitle = document.getElementById('pdf-title');
        pdfTitle.textContent = documentName;

        // Load the PDF
        pdfViewer.src = url;

        // Show the PDF section
        pdfSection.classList.remove('hidden');
        chatSection.classList.remove('w-full');
        chatSection.classList.add('w-1/2');
    }

    function closePdfViewer() {
        pdfSection.classList.add('hidden');
        chatSection.classList.remove('w-1/2');
        chatSection.classList.add('w-full');
        pdfViewer.src = '';
    }

    async function handlePaginationClick(query) {
        await processMessage(query, false);
    }

    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message) return;

        userInput.value = '';
        await processMessage(message, true);
    }

    async function processMessage(message, showQuery) {
        if (showQuery) {
            appendMessage('user', message);
        }

        showTypingIndicator();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: message,
                    chats: chatHistory
                })
            });

            removeTypingIndicator();

            // First check if the response is ok
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Get the response text first
            const responseText = await response.text();

            // Try to parse it as JSON
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                console.error('Failed to parse JSON:', responseText);
                throw new Error(`Failed to parse response as JSON: ${responseText}`);
            }

            console.log('API Response:', data);

            // Check for explicit error in response
            if (data.error) {
                throw new Error(`API Error: ${data.error}\nDetails: ${JSON.stringify(data.details || {}, null, 2)}`);
            }

            // Handle the success case
            const result = data.final_result?.output;
            if (result?.status === 'success' && result?.summary) {
                appendMessage('assistant', result.summary, sources = result.references, isHTML = true);

                if (result.page_info) {
                    displayPagination(result.page_info);
                } else {
                    paginationContainer.classList.add('hidden');
                }

                console.log('Metrics:', data.final_result?.system_metrics);
                console.log('Pagination:', result?.page_info);
            } else {
                // Log the unexpected format and show a more user-friendly message
                console.error('Unexpected response format:', data);
                throw new Error('Received unexpected response format from server');
            }

        } catch (error) {
            removeTypingIndicator();
            console.error('Error:', error);
            appendMessage('system', `Error: ${error.message}`);
            paginationContainer.classList.add('hidden');
        }
    }

    function appendMessage(role, content, sources = [], isHTML = false) {
        // Append to chat history
        chatHistory.push({
            "role": role == "user" ? "user" : "assistant",
            "content": [
                {
                    "type": "text",
                    "text": content
                }
            ]
        });
        chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);

        // Embed into the web page
        const messageDiv = document.createElement('div');
        messageDiv.className = `mb-4 ${role === 'user' ? 'text-right' : 'text-left'}`;

        const bubble = document.createElement('div');
        bubble.className = `inline-block space-y-2 p-3 rounded-lg max-w-3/4 ${role === 'user'
            ? 'bg-blue-500 text-white'
            : role === 'system'
                ? 'bg-gray-200 text-gray-700'
                : 'bg-gray-300 text-gray-800'
            }`;

        content_markdown = content;

        // Add sources
        if (sources.length > 0) {
            let sources_markdown = '##### Sources\n'
            for (let i = 0; i < sources.length; i++) {
                sources_markdown += `- ${sources[i]}\n`
            }
            content_markdown += '\n' + sources_markdown;
        }

        // Inject in converted markdown
        bubble.innerHTML = marked.parse(content_markdown);

        // Add click handlers to any PDF links
        if (isHTML) {
            const links = bubble.getElementsByTagName('a');
            Array.from(links).forEach(link => {
                if (link.href.includes('/api/documents/')) {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        openPdfViewer(link.href);
                    });
                    link.className = 'text-blue-600 hover:underline cursor-pointer';
                }
            });
        }

        // Inject CSS styles
        // h5
        Array.from(bubble.getElementsByTagName('h5')).forEach(el => {
            el.className += 'text-lg';
        });
        // List
        Array.from(bubble.getElementsByTagName('ul')).forEach(el => {
            el.className += 'list-inside list-disc';
            el.style.marginTop = '0';
        });

        // Add bubble to DOM
        messageDiv.appendChild(bubble);
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Event listeners
    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    closePdfButton.addEventListener('click', closePdfViewer);
});