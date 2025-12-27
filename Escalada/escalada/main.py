from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from escalada.routers.upload import router as upload_router
from escalada.api.save_ranking import router as save_ranking_router
from escalada.api.live import router as live_router
from escalada.api.podium import router as podium_router
import os
import logging
import sys
from time import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('escalada.log')
    ]
)

logger = logging.getLogger(__name__)


# Define application lifespan (replaces deprecated @app.on_event)
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events for the FastAPI application"""
    # Startup logic
    logger.info("🚀 Escalada API starting up...")
    yield
    # Shutdown logic
    logger.info("🛑 Escalada API shutting down...")


app = FastAPI(
    title="Escalada Control Panel API",
    lifespan=lifespan  # Use modern lifespan instead of on_event decorators
)

# Secure CORS configuration
DEFAULT_ORIGINS = "http://localhost:5173,http://localhost:3000,http://192.168.100.205:5173"
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",")

# Allow localhost, 127.0.0.1, local network IPs, and .local hostnames
DEFAULT_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|[a-zA-Z0-9-]+\.local|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$"
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX", DEFAULT_ORIGIN_REGEX)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],  # include OPTIONS/HEAD for CORS preflight
    allow_headers=["*"],
)


# Custom middleware for request logging
@app.middleware("http")
async def log_requests(request, call_next):
    """Log all HTTP requests and responses"""
    start_time = time()
    
    # Log incoming request
    logger.info(f"{request.method} {request.url.path} - Client: {request.client.host if request.client else 'unknown'}")
    
    try:
        response = await call_next(request)
        process_time = time() - start_time
        logger.info(
            f"{request.method} {request.url.path} - Status: {response.status_code} - Duration: {process_time:.3f}s"
        )
        return response
    except Exception as e:
        process_time = time() - start_time
        logger.error(
            f"{request.method} {request.url.path} - Error: {str(e)} - Duration: {process_time:.3f}s",
            exc_info=True
        )
        raise

app.include_router(upload_router, prefix="/api")
app.include_router(save_ranking_router, prefix="/api")  
app.include_router(live_router, prefix="/api")
app.include_router(podium_router, prefix="/api")
