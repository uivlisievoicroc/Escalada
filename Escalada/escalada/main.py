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

app = FastAPI(title="Escalada Control Panel API")

# Secure CORS configuration
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Allow localhost, 127.0.0.1, and local network IPs (192.168.x.x, 10.x.x.x) with any port
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$",
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

@app.on_event("startup")
async def startup_event():
    logger.info("Application starting up")
