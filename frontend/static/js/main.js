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
        const sources_id_prefix = crypto.randomUUID();
        let sources_markdown = '';
        let sources_html = document.createElement('div');
        if (sources.length > 0) {
            sources_markdown = '##### Sources\n';
            sources_html.innerHTML += "<h5>Sources</h5>";

            sources_html.innerHTML += `
                <div id="accordion-flush" data-accordion="collapse"
                    data-active-classes="bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    data-inactive-classes="text-gray-500 dark:text-gray-400">
                    <h2 id="accordion-flush-heading-1">
                        <button type="button"
                            class="flex items-center justify-between w-full py-5 font-medium rtl:text-right text-gray-500 border-b border-gray-200 dark:border-gray-700 dark:text-gray-400 gap-3"
                            data-accordion-target="#accordion-flush-body-1" aria-expanded="true" aria-controls="accordion-flush-body-1">
                            <span>What is Flowbite?</span>
                            <svg data-accordion-icon class="w-3 h-3 rotate-180 shrink-0" aria-hidden="true"
                                xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 10 6">
                                <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M9 5 5 1 1 5" />
                            </svg>
                        </button>
                    </h2>

                    <div id="accordion-flush-body-1" class="hidden" aria-labelledby="accordion-flush-heading-1">
                        <div class="py-5 border-b border-gray-200 dark:border-gray-700">
                            <p class="mb-2 text-gray-500 dark:text-gray-400">Flowbite is an open-source library of interactive
                                components built on top of Tailwind CSS including buttons, dropdowns, modals, navbars, and more.</p>
                            <p class="text-gray-500 dark:text-gray-400">Check out this guide to learn how to <a
                                    href="/docs/getting-started/introduction/"
                                    class="text-blue-600 dark:text-blue-500 hover:underline">get started</a> and start developing
                                websites even faster with components on top of Tailwind CSS.</p>
                        </div>
                    </div>
                </div>
            `;

            for (let i = 0; i < sources.length; i++) {
                sources_markdown += `- ${sources[i]}\n`
            }
        }

        // Inject in converted markdown
        bubble.innerHTML = marked.parse(content_markdown);
        bubble.innerHTML += marked.parse('\n' + sources_markdown);
        bubble.appendChild(sources_html);

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
        // Unordered list
        Array.from(bubble.getElementsByTagName('ul')).forEach(el => {
            el.className += 'list-inside list-disc';
            el.style.marginTop = '0';
        });
        // Ordered list
        Array.from(bubble.getElementsByTagName('ol')).forEach(el => {
            el.className += 'list-inside list-decimal';
            el.style.marginTop = '0';
        });
        // Tables
        Array.from(bubble.getElementsByTagName('table')).forEach(el => {
            el.className += 'table-auto border-collapse border-gray-600';
        });
        // Table rows
        Array.from(bubble.getElementsByTagName('tr')).forEach(el => {
            el.className += 'border-b border-gray-500';
        });
        // Table cells
        Array.from(bubble.getElementsByTagName('td')).forEach(el => {
            el.className += 'py-2';
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