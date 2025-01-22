import azure.functions as func
import requests
import json
import os
import traceback
import logging

app = func.FunctionApp()

@app.route(route="chat")
def chat(req: func.HttpRequest) -> func.HttpResponse:
    try:
        # Get request body
        req_body = req.get_json()
        user_query = req_body.get('query')
        chat_history = req_body.get('chats', [])  # Get chat history from request
        
        logging.info(f"Received query: {user_query}")
        logging.info(f"Received chat history: {json.dumps(chat_history)}")

        if not user_query:
            return func.HttpResponse(
                json.dumps({"error": "No query provided"}),
                mimetype="application/json",
                status_code=400
            )

        # Get environment variables
        promptflow_endpoint = os.environ.get("PROMPTFLOW_ENDPOINT")
        promptflow_key = os.environ.get("PROMPTFLOW_KEY")
        azure_ai_search_endpoint = os.environ.get("AZURE_AI_SEARCH_ENDPOINT")
        azure_ai_search_key = os.environ.get("AZURE_AI_SEARCH_KEY")
        azure_openai_endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
        azure_openai_key = os.environ.get("AZURE_OPENAI_KEY")
        function_key = os.environ.get("FUNCTION_KEY")

        # Log environment variable status (without exposing actual values)
        env_vars_status = {
            "PROMPTFLOW_ENDPOINT": bool(promptflow_endpoint),
            "PROMPTFLOW_KEY": bool(promptflow_key),
            "AZURE_AI_SEARCH_ENDPOINT": bool(azure_ai_search_endpoint),
            "AZURE_AI_SEARCH_KEY": bool(azure_ai_search_key),
            "AZURE_OPENAI_ENDPOINT": bool(azure_openai_endpoint),
            "AZURE_OPENAI_KEY": bool(azure_openai_key),
            "FUNCTION_KEY": bool(function_key)
        }
        logging.info(f"Environment variables status: {json.dumps(env_vars_status)}")

        # Verify all required environment variables
        missing_vars = [var for var, value in env_vars_status.items() if not value]
        if missing_vars:
            error_msg = f"Missing environment variables: {', '.join(missing_vars)}"
            logging.error(error_msg)
            return func.HttpResponse(
                json.dumps({
                    "error": "Missing environment variables",
                    "details": error_msg
                }),
                mimetype="application/json",
                status_code=500
            )

        # Call prompt flow endpoint
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {promptflow_key}'
        }

        # request body (included chat history)
        request_body = {
            "azure_ai_search_endpoint": azure_ai_search_endpoint,
            "azure_ai_search_key": azure_ai_search_key,
            "azure_openai_key": azure_openai_key,
            "azure_openai_endpoint": azure_openai_endpoint,
            "function_key": function_key,
            "query": user_query,
            "chat_history": chat_history if chat_history else []
        }

        logging.info(f"Calling promptflow endpoint: {promptflow_endpoint}")
        logging.info(f"Chat history being sent: {json.dumps(chat_history[:-1] if chat_history else [])}")
        
        response = requests.post(
            promptflow_endpoint,
            headers=headers,
            json=request_body
        )

        logging.info(f"Promptflow response status: {response.status_code}")
        logging.info(f"Promptflow response headers: {dict(response.headers)}")
        
        # Log response content (be careful with sensitive data)
        try:
            response_content = response.json()
            logging.info("Successfully parsed response as JSON")
        except json.JSONDecodeError:
            logging.error(f"Failed to parse response as JSON. Response text: {response.text[:500]}...")
            response_content = None

        if response.status_code == 200:
            return func.HttpResponse(
                json.dumps(response_content),
                mimetype="application/json"
            )
        else:
            error_msg = {
                "error": "Error from prompt flow service",
                "details": {
                    "status_code": response.status_code,
                    "response": response.text[:1000]  # Limit response text length
                }
            }
            logging.error(f"Error response: {json.dumps(error_msg)}")
            return func.HttpResponse(
                json.dumps(error_msg),
                mimetype="application/json",
                status_code=response.status_code
            )

    except Exception as e:
        error_msg = str(e)
        stack_trace = traceback.format_exc()
        logging.error(f"Unexpected error: {error_msg}")
        logging.error(f"Stack trace: {stack_trace}")
        return func.HttpResponse(
            json.dumps({
                "error": "Unexpected error",
                "details": {
                    "error": error_msg,
                    "traceback": stack_trace
                }
            }),
            mimetype="application/json",
            status_code=500
        )