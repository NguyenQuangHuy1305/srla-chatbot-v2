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
    let debugLog = [];

    function logDebugInfo(type, info) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type,
            info
        };
        debugLog.push(logEntry);
        console.log(`[${logEntry.timestamp}] ${type}:`, info);
    }

    function getDebugHeaders(headers) {
        return Object.fromEntries(
            Array.from(headers.entries())
                .filter(([key]) => key.toLowerCase().startsWith('x-debug-'))
        );
    }

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

        logDebugInfo('pagination', pageInfo);
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
        logDebugInfo('pdf_viewer_open', { url });
        const decodedUrl = decodeURIComponent(url);
        const documentName = decodedUrl.split('/').pop().split('?')[0];

        const pdfTitle = document.getElementById('pdf-title');
        pdfTitle.textContent = documentName;

        pdfViewer.src = url;
        pdfSection.classList.remove('hidden');
        chatSection.classList.remove('w-full');
        chatSection.classList.add('w-1/2');
    }

    function closePdfViewer() {
        logDebugInfo('pdf_viewer_close');
        pdfSection.classList.add('hidden');
        chatSection.classList.remove('w-1/2');
        chatSection.classList.add('w-full');
        pdfViewer.src = '';
    }

    async function handlePaginationClick(query) {
        logDebugInfo('pagination_click', { query });
        await processMessage(query, false);
    }

    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message) return;

        logDebugInfo('send_message', { message });
        userInput.value = '';
        await processMessage(message, true);
    }

    async function processMessage(message, showQuery) {
        const requestStartTime = Date.now();
        logDebugInfo('request_start', { message, showQuery });

        if (showQuery) {
            appendMessage('user', message);
        }
    
        showTypingIndicator();
    
        try {
            const requestBody = {
                query: message,
                chats: chatHistory
            };
            logDebugInfo('request_body', requestBody);

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            const debugHeaders = getDebugHeaders(response.headers);
            logDebugInfo('response_headers', {
                ...debugHeaders,
                status: response.status,
                statusText: response.statusText
            });
            
            removeTypingIndicator();
            
            const responseText = await response.text();
            logDebugInfo('response_text', {
                length: responseText.length,
                preview: responseText.slice(0, 200)
            });

            // Check if response is empty or contains error indicators
            if (!responseText) {
                logDebugInfo('error_empty_response');
                throw new Error('The server is currently unavailable. Please try again in a few moments.');
            }

            if (responseText.includes('Backend call failure')) {
                logDebugInfo('backend_call_failure', { responseText });
                throw new Error('The server is currently unavailable. Please try again in a few moments.');
            }

            let data;
            try {
                data = JSON.parse(responseText);
                logDebugInfo('parsed_response', {
                    hasError: !!data.error,
                    debugInfo: data.debug_info
                });
            } catch (parseError) {
                logDebugInfo('parse_error', {
                    error: parseError.message,
                    responsePreview: responseText.slice(0, 200)
                });
                throw new Error('Failed to parse server response');
            }
    
            if (data.error) {
                let errorMessage = data.error;
                if (data.details) {
                    errorMessage += '\n' + data.details;
                }
                
                logDebugInfo('error_response', {
                    error: data.error,
                    details: data.details,
                    debugInfo: data.debug_info
                });
                
                switch(response.status) {
                    case 503:
                        errorMessage = 'Service is temporarily unavailable. Please try again in a few moments.';
                        break;
                    case 504:
                        errorMessage = 'Request timed out. Please try again.';
                        break;
                    case 502:
                        errorMessage = 'Server is temporarily unavailable. Please try again later.';
                        break;
                    case 400:
                        errorMessage = 'Invalid request. Please check your input.';
                        break;
                }
                
                throw new Error(errorMessage);
            }
    
            const result = data.data?.final_result?.output;
            logDebugInfo('process_result', {
                hasResult: !!result,
                status: result?.status,
                hasSummary: !!result?.summary,
                hasReferences: !!result?.references,
                hasPageInfo: !!result?.page_info
            });

            if (result?.status === 'success' && result?.summary) {
                appendMessage('assistant', result.summary, result.references, true);
    
                if (result.page_info) {
                    displayPagination(result.page_info);
                } else {
                    paginationContainer.classList.add('hidden');
                }
            } else {
                throw new Error('Received unexpected response format from server');
            }
    
        } catch (error) {
            removeTypingIndicator();
            logDebugInfo('error', {
                message: error.message,
                stack: error.stack,
                timeTaken: Date.now() - requestStartTime
            });
            
            const errorMessage = error.message || 'An unexpected error occurred. Please try again.';
            appendMessage('system', errorMessage);
            
            paginationContainer.classList.add('hidden');
        }
    }

    function appendMessage(role, content, sources = [], isHTML = false) {
        logDebugInfo('append_message', { role, contentLength: content.length, sourcesCount: sources.length });
        
        chatHistory.push({
            "role": role === "user" ? "user" : "assistant",
            "content": [
                {
                    "type": "text",
                    "text": content
                }
            ]
        });
        chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
    
        const messageDiv = document.createElement('div');
        messageDiv.className = `mb-4 ${role === 'user' ? 'text-right' : 'text-left'}`;
    
        const bubble = document.createElement('div');
        bubble.className = `inline-block space-y-2 p-3 rounded-lg max-w-3/4 ${role === 'user'
            ? 'bg-blue-500 text-white'
            : role === 'system'
                ? 'bg-gray-200 text-gray-700'
                : 'bg-gray-300 text-gray-800'
            }`;
    
        // Add sources if available
        const messageId = crypto.randomUUID();
        let sources_html = document.createElement('div');
        if (sources.length > 0) {
            sources_html.innerHTML = `
                <div class="mt-4 border-t border-gray-200 pt-4">
                    <div data-accordion="open">
                        <h2>
                            <button type="button"
                                class="flex items-center justify-between w-full py-2 px-3 text-sm font-medium text-gray-500 hover:bg-gray-100 rounded-lg gap-3"
                                aria-expanded="false"
                                data-accordion-target="#refs-${messageId}">
                                <span>References (${sources.length})</span>
                                <svg class="w-3 h-3 shrink-0 transition-transform" aria-hidden="true"
                                    xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 10 6">
                                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M1 1L5 5L9 1"/>
                                </svg>
                            </button>
                        </h2>
                        <div id="refs-${messageId}"
                            class="hidden overflow-hidden transition-[height]"
                            aria-expanded="false">
                            <div class="py-2 px-3 text-sm">
                                <ul class="space-y-2 list-none">
                                    ${sources.map(source => {
                                        const match = source.match(/\[(.*?)\]\((.*?)\)/);
                                        if (match) {
                                            const [_, text, url] = match;
                                            const restOfText = source.split('),')[1] || '';
                                            return `
                                                <li>
                                                    <a href="${url}" class="text-blue-600 hover:underline cursor-pointer" onClick="event.preventDefault(); openPdfViewer('${url}')">
                                                        ${text}
                                                    </a>${restOfText}
                                                </li>
                                            `;
                                        }
                                        return `<li>${source}</li>`;
                                    }).join('')}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    
        bubble.innerHTML = marked.parse(content);
        bubble.appendChild(sources_html);
    
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
    
        // Style adjustments
        Array.from(bubble.getElementsByTagName('h5')).forEach(el => {
            el.className += 'text-lg';
        });
        Array.from(bubble.getElementsByTagName('ul')).forEach(el => {
            if (!el.closest('[data-accordion]')) {
                el.className += 'list-inside list-disc';
                el.style.marginTop = '0';
            }
        });
        Array.from(bubble.getElementsByTagName('ol')).forEach(el => {
            el.className = 'list-decimal space-y-2 pl-5';
        });
        Array.from(bubble.getElementsByTagName('li')).forEach(el => {
            el.className = 'pl-2';
            el.style.display = 'list-item';
        });
        Array.from(bubble.getElementsByTagName('table')).forEach(el => {
            el.className = 'min-w-full table-auto border-collapse bg-white bg-opacity-50 rounded-lg overflow-hidden';
            el.style.marginTop = '1rem';
            el.style.marginBottom = '1rem';
        });
        Array.from(bubble.getElementsByTagName('tr')).forEach(el => {
            el.className = 'border-b border-gray-300 hover:bg-gray-50';
        });
        Array.from(bubble.getElementsByTagName('th')).forEach(el => {
            el.className = 'px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider bg-gray-100';
        });
        Array.from(bubble.getElementsByTagName('td')).forEach(el => {
            el.className = 'px-4 py-3 text-sm text-gray-900 whitespace-normal';
        });
    
        messageDiv.appendChild(bubble);
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    
        if (sources.length > 0) {
            initFlowbite();
        }
    }

    // Event listeners
    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    closePdfButton.addEventListener('click', closePdfViewer);

    // Add debug keyboard shortcut (Ctrl+Shift+D)
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            console.log('=== Debug Log ===');
            console.table(debugLog);
            
            // Create debug data blob for download
            const debugData = JSON.stringify({
                log: debugLog,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                windowSize: {
                    width: window.innerWidth,
                    height: window.innerHeight
                },
                chatHistory: chatHistory
            }, null, 2);
            
            const blob = new Blob([debugData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `chat-debug-${new Date().toISOString()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    });

    // Add visual feedback for debug shortcut
    const debugIndicator = document.createElement('div');
    debugIndicator.style.cssText = `
        position: fixed;
        bottom: 10px;
        right: 10px;
        background: rgba(0,0,0,0.7);
        color: white;
        padding: 5px 10px;
        border-radius: 5px;
        font-size: 12px;
        display: none;
        z-index: 1000;
    `;
    debugIndicator.textContent = 'Debug logs downloaded';
    document.body.appendChild(debugIndicator);

    // Show indicator when logs are downloaded
    function showDebugIndicator() {
        debugIndicator.style.display = 'block';
        setTimeout(() => {
            debugIndicator.style.display = 'none';
        }, 2000);
    }

    // Error boundary for unexpected errors
    window.onerror = function(msg, url, lineNo, columnNo, error) {
        logDebugInfo('global_error', {
            message: msg,
            url: url,
            line: lineNo,
            column: columnNo,
            error: error?.stack || 'No stack trace available'
        });
        return false;
    };

    // Unhandled promise rejection handler
    window.addEventListener('unhandledrejection', function(event) {
        logDebugInfo('unhandled_promise_rejection', {
            reason: event.reason?.message || event.reason,
            stack: event.reason?.stack || 'No stack trace available'
        });
    });

    // Performance monitoring
    if (window.PerformanceObserver) {
        const perfObserver = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                logDebugInfo('performance', {
                    type: entry.entryType,
                    name: entry.name,
                    duration: entry.duration,
                    startTime: entry.startTime
                });
            });
        });

        perfObserver.observe({ entryTypes: ['navigation', 'resource', 'longtask'] });
    }
});