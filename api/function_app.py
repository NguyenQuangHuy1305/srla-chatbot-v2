import azure.functions as func
import requests
import json
import os
import traceback
import logging
import time
from typing import Dict, Any

app = func.FunctionApp()

def get_env_vars_with_retry(max_retries=3, retry_delay=1) -> Dict[str, str]:
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
        logging.info(f"Attempt {attempt + 1} to fetch environment variables")
        env_vars = {var: os.environ.get(var) for var in required_vars}
        missing_vars = [var for var, value in env_vars.items() if not value]
        
        if not missing_vars:
            logging.info("Successfully retrieved all environment variables")
            return env_vars
            
        if attempt < max_retries - 1:
            logging.warning(f"Missing environment variables: {missing_vars}. Retrying in {retry_delay} seconds...")
            time.sleep(retry_delay)
    
    error_msg = f"Failed to load environment variables after {max_retries} attempts: {missing_vars}"
    logging.error(error_msg)
    raise ValueError(error_msg)

def create_error_response(error_type: str, details: str, status_code: int, additional_info: Dict[str, Any] = None) -> func.HttpResponse:
    """
    Create a standardized error response
    """
    error_body = {
        "error": error_type,
        "details": details
    }
    if additional_info:
        error_body.update(additional_info)
    
    logging.error(f"Returning error response: {json.dumps(error_body)}")
    return func.HttpResponse(
        json.dumps(error_body),
        mimetype="application/json",
        status_code=status_code
    )

@app.route(route="chat", methods=["POST"])
def chat(req: func.HttpRequest) -> func.HttpResponse:
    request_id = f"req_{int(time.time())}_{os.urandom(4).hex()}"
    logging.info(f"[{request_id}] New chat request received")
    
    try:
        # Get and validate request body
        try:
            req_body = req.get_json()
            logging.info(f"[{request_id}] Request body received: {json.dumps(req_body)}")
        except ValueError as e:
            logging.error(f"[{request_id}] Failed to parse request JSON: {str(e)}")
            return create_error_response(
                "Invalid request",
                "Failed to parse request body as JSON",
                400
            )

        user_query = req_body.get('query')
        chat_history = req_body.get('chats', [])

        logging.info(f"[{request_id}] Query: {user_query}")
        logging.info(f"[{request_id}] Chat history length: {len(chat_history)}")

        if not user_query:
            logging.warning(f"[{request_id}] No query provided in request")
            return create_error_response(
                "No query provided",
                "The query parameter is required",
                400
            )

        # Get environment variables
        try:
            logging.info(f"[{request_id}] Fetching environment variables")
            env_vars = get_env_vars_with_retry()
        except ValueError as e:
            logging.error(f"[{request_id}] Environment variable error: {str(e)}")
            return create_error_response(
                "Configuration error",
                str(e),
                503
            )

        # Prepare request to prompt flow
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {env_vars["PROMPTFLOW_KEY"]}',
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
        }

        request_body = {
            "azure_ai_search_endpoint": env_vars["AZURE_AI_SEARCH_ENDPOINT"],
            "azure_ai_search_key": env_vars["AZURE_AI_SEARCH_KEY"],
            "azure_openai_key": env_vars["AZURE_OPENAI_KEY"],
            "azure_openai_endpoint": env_vars["AZURE_OPENAI_ENDPOINT"],
            "function_key": env_vars["FUNCTION_KEY"],
            "query": user_query,
            "chat_history": chat_history
        }

        # Make request to prompt flow
        try:
            logging.info(f"[{request_id}] Making request to Prompt Flow endpoint: {env_vars['PROMPTFLOW_ENDPOINT']}")
            logging.info(f"[{request_id}] Request headers (excluding auth): Content-Type and CORS headers set")
            logging.info(f"[{request_id}] Request body length: {len(json.dumps(request_body))} characters")
            
            start_time = time.time()
            response = requests.post(
                env_vars["PROMPTFLOW_ENDPOINT"],
                headers=headers,
                json=request_body,
                timeout=180
            )
            elapsed_time = time.time() - start_time
            
            logging.info(f"[{request_id}] Prompt Flow request completed in {elapsed_time:.2f} seconds")
            logging.info(f"[{request_id}] Response status code: {response.status_code}")
            logging.info(f"[{request_id}] Response content (first 1000 chars): {response.text[:1000]}")

            response.raise_for_status()
            
        except requests.exceptions.Timeout:
            logging.error(f"[{request_id}] Request to prompt flow timed out after {elapsed_time:.2f} seconds")
            return create_error_response(
                "Request timeout",
                "The request to the prompt flow service timed out",
                504
            )
        except requests.exceptions.RequestException as e:
            logging.error(f"[{request_id}] Request to prompt flow failed: {str(e)}")
            error_details = {
                "error_type": type(e).__name__
            }
            
            if hasattr(e, 'response') and e.response is not None:
                error_details.update({
                    "status_code": e.response.status_code,
                    "response_text": e.response.text
                })
                logging.error(f"[{request_id}] Prompt flow error response: {e.response.text}")
            
            return create_error_response(
                "Prompt flow service error",
                str(e),
                502,
                error_details
            )

        # Parse prompt flow response
        try:
            response_data = response.json()
            logging.info(f"[{request_id}] Successfully parsed response JSON")
        except json.JSONDecodeError as e:
            logging.error(f"[{request_id}] Failed to parse prompt flow response as JSON: {str(e)}")
            logging.error(f"[{request_id}] Raw response content: {response.text}")
            return create_error_response(
                "Invalid response",
                "Failed to parse response from prompt flow service",
                502
            )

        # Success case
        logging.info(f"[{request_id}] Request completed successfully")
        return func.HttpResponse(
            json.dumps(response_data),
            mimetype="application/json"
        )

    except Exception as e:
        logging.error(f"[{request_id}] Unexpected error: {str(e)}")
        logging.error(f"[{request_id}] Error type: {type(e).__name__}")
        logging.error(f"[{request_id}] Stack trace: {traceback.format_exc()}")
        
        return create_error_response(
            "Internal server error",
            str(e),
            500,
            {
                "type": "unexpected_error",
                "stack_trace": traceback.format_exc()
            }
        )