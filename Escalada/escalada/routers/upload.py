from fastapi import APIRouter, UploadFile, File, Form, HTTPException
import openpyxl
from io import BytesIO
from zipfile import BadZipFile

router = APIRouter(tags=["upload"])

@router.post("/upload")
async def upload_listbox(
    
    category: str = Form(...),
    file: UploadFile = File(...)
):
    # verific MIME
    if file.content_type not in ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel"):
        raise HTTPException(status_code=400, detail="Tip fișier neacceptat")

    data = await file.read()
    try:
        wb = openpyxl.load_workbook(filename=BytesIO(data), read_only=True)
    except BadZipFile:
        raise HTTPException(status_code=400, detail="Fișierul încărcat nu este un .xlsx valid")
    
    ws = wb.active

    result = []
    # presupunem că prima linie sunt anteturi: Nume, Club
    for row in ws.iter_rows(min_row=2, values_only=True):
        nume, club = row[:2]
        if nume and club:
            result.append({"nume": str(nume), "club": str(club)})

    return {"categorie": category, "concurenti": result}