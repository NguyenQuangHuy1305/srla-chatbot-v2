import azure.functions as func
import requests
import json
import os
import traceback
import logging
import time

app = func.FunctionApp()

def get_env_vars_with_retry(max_retries=3, retry_delay=1):
    """
    Get environment variables with retry mechanism for cold starts
    """
    required_vars = [
        "PROMPTFLOW_ENDPOINT",
        "PROMPTFLOW_KEY",
        "AZURE_AI_SEARCH_ENDPOINT",
        "AZURE_AI_SEARCH_KEY",
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_KEY",
        "FUNCTION_KEY"
    ]
    
    for attempt in range(max_retries):
        env_vars = {var: os.environ.get(var) for var in required_vars}
        missing_vars = [var for var, value in env_vars.items() if not value]
        
        if not missing_vars:
            return env_vars
            
        if attempt < max_retries - 1:
            logging.warning(f"Missing environment variables: {missing_vars}. Retrying in {retry_delay} seconds...")
            time.sleep(retry_delay)
    
    raise ValueError(f"Failed to load environment variables after {max_retries} attempts: {missing_vars}")

@app.route(route="chat", methods=["POST"])
def chat(req: func.HttpRequest) -> func.HttpResponse:
    try:
        # Get request body
        req_body = req.get_json()
        user_query = req_body.get('query')
        chat_history = req_body.get('chats', [])

        logging.info(f"Received query: {user_query}")
        logging.info(f"Received chat history: {json.dumps(chat_history)}")

        if not user_query:
            return func.HttpResponse(
                json.dumps({
                    "error": "No query provided",
                    "details": "The query parameter is required"
                }),
                mimetype="application/json",
                status_code=400
            )

        try:
            # Get environment variables with retry
            env_vars = get_env_vars_with_retry()
        except ValueError as e:
            return func.HttpResponse(
                json.dumps({
                    "error": "Configuration error",
                    "details": str(e)
                }),
                mimetype="application/json",
                status_code=503  # Service Unavailable
            )

        # Call prompt flow endpoint
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {env_vars["PROMPTFLOW_KEY"]}',
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
        }

        # request body
        request_body = {
            "azure_ai_search_endpoint": env_vars["AZURE_AI_SEARCH_ENDPOINT"],
            "azure_ai_search_key": env_vars["AZURE_AI_SEARCH_KEY"],
            "azure_openai_key": env_vars["AZURE_OPENAI_KEY"],
            "azure_openai_endpoint": env_vars["AZURE_OPENAI_ENDPOINT"],
            "function_key": env_vars["FUNCTION_KEY"],
            "query": user_query,
            "chat_history": chat_history if chat_history else []
        }

        try:
            response = requests.post(
                env_vars["PROMPTFLOW_ENDPOINT"],
                headers=headers,
                json=request_body,
                timeout=30  # Add timeout
            )
            response.raise_for_status()  # Raise exception for bad status codes
        except requests.exceptions.Timeout:
            return func.HttpResponse(
                json.dumps({
                    "error": "Request timeout",
                    "details": "The request to the prompt flow service timed out"
                }),
                mimetype="application/json",
                status_code=504  # Gateway Timeout
            )
        except requests.exceptions.RequestException as e:
            return func.HttpResponse(
                json.dumps({
                    "error": "Prompt flow service error",
                    "details": str(e)
                }),
                mimetype="application/json",
                status_code=502  # Bad Gateway
            )

        try:
            response_data = response.json()
        except json.JSONDecodeError:
            return func.HttpResponse(
                json.dumps({
                    "error": "Invalid response",
                    "details": "Failed to parse response from prompt flow service"
                }),
                mimetype="application/json",
                status_code=502
            )

        return func.HttpResponse(
            json.dumps(response_data),
            mimetype="application/json"
        )

    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}")
        logging.error(f"Stack trace: {traceback.format_exc()}")
        return func.HttpResponse(
            json.dumps({
                "error": "Internal server error",
                "details": str(e),
                "type": "unexpected_error"
            }),
            mimetype="application/json",
            status_code=500
        )