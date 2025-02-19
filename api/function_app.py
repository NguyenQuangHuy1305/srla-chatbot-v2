import azure.functions as func
import requests
import json
import os
import traceback
import logging
import time
import sys
import platform
from datetime import datetime
from typing import Dict, Any
from opencensus.ext.azure.log_exporter import AzureLogHandler
from opencensus.ext.azure.trace_exporter import AzureExporter
from opencensus.trace import config_integration
from opencensus.trace.samplers import ProbabilitySampler
from opencensus.trace.tracer import Tracer

app = func.FunctionApp()

# Configure basic logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Required environment variables
required_vars = [
    "PROMPTFLOW_ENDPOINT",
    "PROMPTFLOW_KEY",
    "AZURE_AI_SEARCH_ENDPOINT",
    "AZURE_AI_SEARCH_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_KEY",
    "FUNCTION_KEY",
    "APPLICATIONINSIGHTS_CONNECTION_STRING"  # Add this for App Insights
]

# Initialize Application Insights
try:
    appinsights_connection_string = os.environ.get('APPLICATIONINSIGHTS_CONNECTION_STRING')
    if appinsights_connection_string:
        logger.addHandler(AzureLogHandler(
            connection_string=appinsights_connection_string
        ))
        tracer = Tracer(
            exporter=AzureExporter(
                connection_string=appinsights_connection_string
            ),
            sampler=ProbabilitySampler(1.0)
        )
        config_integration.trace_integrations(['requests'])
        logger.info("Application Insights initialized successfully")
    else:
        logger.warning("APPLICATIONINSIGHTS_CONNECTION_STRING not found")
except Exception as e:
    logger.error(f"Failed to initialize Application Insights: {str(e)}")

def get_system_info() -> Dict[str, Any]:
    """Get basic system information for debugging"""
    return {
        "python_version": sys.version,
        "platform": platform.platform(),
        "timestamp": datetime.now().isoformat(),
        "env_vars_present": [k for k in required_vars if os.environ.get(k) is not None],
    }

def get_env_vars_with_retry(max_retries=3, retry_delay=1) -> Dict[str, str]:
    """Get environment variables with retry mechanism for cold starts"""
    for attempt in range(max_retries):
        env_vars = {var: os.environ.get(var) for var in required_vars}
        missing_vars = [var for var, value in env_vars.items() if not value]
        
        if not missing_vars:
            return env_vars
            
        if attempt < max_retries - 1:
            time.sleep(retry_delay)
    
    error_msg = f"Failed to load environment variables after {max_retries} attempts: {missing_vars}"
    logger.error(error_msg)
    raise ValueError(error_msg)

def create_error_response(error_type: str, details: str, status_code: int, request_id: str, additional_info: Dict[str, Any] = None) -> func.HttpResponse:
    """Create a standardized error response with debug information"""
    error_body = {
        "error": error_type,
        "details": details,
        "debug_info": {
            "request_id": request_id,
            "timestamp": datetime.now().isoformat(),
            **get_system_info()
        }
    }
    
    if additional_info:
        error_body["debug_info"].update(additional_info)
    
    # Log error details to Application Insights
    logger.error(
        f"Error response: {error_type}", 
        extra={
            "custom_dimensions": {
                "request_id": request_id,
                "error_type": error_type,
                "status_code": status_code,
                "details": details,
                **(additional_info if additional_info else {})
            }
        }
    )
    
    headers = {
        "X-Debug-RequestId": request_id,
        "X-Debug-ErrorType": error_type,
        "X-Debug-Timestamp": error_body["debug_info"]["timestamp"],
        "Access-Control-Expose-Headers": "X-Debug-RequestId, X-Debug-ErrorType, X-Debug-Timestamp"
    }
    
    return func.HttpResponse(
        json.dumps(error_body),
        mimetype="application/json",
        status_code=status_code,
        headers=headers
    )

@app.route(route="chat", methods=["POST"])
def chat(req: func.HttpRequest) -> func.HttpResponse:
    request_id = f"req_{int(time.time())}_{os.urandom(4).hex()}"
    debug_info = {"request_start_time": datetime.now().isoformat()}
    
    # Start tracing the request
    with tracer.span("chat_request") as span:
        span.add_attribute("request_id", request_id)
        
        try:
            # Parse request body
            try:
                req_body = req.get_json()
                debug_info["request_body_size"] = len(json.dumps(req_body))
                logger.info("Request received", extra={
                    "custom_dimensions": {
                        "request_id": request_id,
                        "request_body_size": debug_info["request_body_size"]
                    }
                })
            except ValueError as e:
                return create_error_response(
                    "Invalid request",
                    "Failed to parse request body as JSON",
                    400,
                    request_id,
                    {"parse_error": str(e)}
                )

            user_query = req_body.get('query')
            chat_history = req_body.get('chats', [])
            debug_info.update({
                "query_length": len(user_query) if user_query else 0,
                "chat_history_length": len(chat_history)
            })

            if not user_query:
                return create_error_response(
                    "No query provided",
                    "The query parameter is required",
                    400,
                    request_id,
                    debug_info
                )

            # Get environment variables
            try:
                env_vars = get_env_vars_with_retry()
                debug_info["env_vars_loaded"] = True
            except ValueError as e:
                return create_error_response(
                    "Configuration error",
                    str(e),
                    503,
                    request_id,
                    debug_info
                )

            # Prepare prompt flow request
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

            # Make prompt flow request
            try:
                with tracer.span("prompt_flow_request") as prompt_span:
                    start_time = time.time()
                    response = requests.post(
                        env_vars["PROMPTFLOW_ENDPOINT"],
                        headers=headers,
                        json=request_body,
                        timeout=180
                    )
                    request_time = time.time() - start_time
                    debug_info["prompt_flow_time"] = request_time
                    debug_info["prompt_flow_status"] = response.status_code
                    
                    prompt_span.add_attribute("request_time", request_time)
                    prompt_span.add_attribute("status_code", response.status_code)
                    
                    logger.info("Prompt flow request completed", extra={
                        "custom_dimensions": {
                            "request_id": request_id,
                            "request_time": request_time,
                            "status_code": response.status_code
                        }
                    })
                    
                    response.raise_for_status()
                
            except requests.exceptions.Timeout:
                return create_error_response(
                    "Request timeout",
                    "The request to the prompt flow service timed out",
                    504,
                    request_id,
                    {**debug_info, "timeout_after": 180}
                )
            except requests.exceptions.RequestException as e:
                error_details = {
                    **debug_info,
                    "error_type": type(e).__name__
                }
                
                if hasattr(e, 'response') and e.response is not None:
                    error_details.update({
                        "prompt_flow_status": e.response.status_code,
                        "prompt_flow_response_preview": e.response.text[:500]
                    })
                
                return create_error_response(
                    "Prompt flow service error",
                    str(e),
                    502,
                    request_id,
                    error_details
                )

            # Parse prompt flow response
            try:
                response_data = response.json()
                debug_info["response_size"] = len(json.dumps(response_data))
                logger.info("Response parsed successfully", extra={
                    "custom_dimensions": {
                        "request_id": request_id,
                        "response_size": debug_info["response_size"]
                    }
                })
            except json.JSONDecodeError as e:
                return create_error_response(
                    "Invalid response",
                    "Failed to parse response from prompt flow service",
                    502,
                    request_id,
                    {
                        **debug_info,
                        "response_preview": response.text[:500],
                        "parse_error": str(e)
                    }
                )

            # Add debug headers to success response
            headers = {
                "X-Debug-RequestId": request_id,
                "X-Debug-Time": str(debug_info["prompt_flow_time"]),
                "X-Debug-Timestamp": datetime.now().isoformat(),
                "Access-Control-Expose-Headers": "X-Debug-RequestId, X-Debug-Time, X-Debug-Timestamp"
            }

            # Success case
            return func.HttpResponse(
                json.dumps({
                    "data": response_data,
                    "debug_info": debug_info
                }),
                mimetype="application/json",
                headers=headers
            )

        except Exception as e:
            logger.exception(f"Unhandled exception in chat function: {str(e)}", extra={
                "custom_dimensions": {
                    "request_id": request_id,
                    "error_type": type(e).__name__,
                    "stack_trace": traceback.format_exc()
                }
            })
            return create_error_response(
                "Internal server error",
                str(e),
                500,
                request_id,
                {
                    **debug_info,
                    "error_type": type(e).__name__,
                    "stack_trace": traceback.format_exc()
                }
            )