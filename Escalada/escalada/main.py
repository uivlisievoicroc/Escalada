from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from escalada.routers.upload import router as upload_router
from escalada.api.save_ranking import router as save_ranking_router
from escalada.api.live import router as live_router
from escalada.api.podium import router as podium_router

app = FastAPI(title="Escalada Control Panel API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload_router, prefix="/api")
app.include_router(save_ranking_router, prefix="/api")  
app.include_router(live_router, prefix="/api")
app.include_router(podium_router, prefix="/api")