# escalada/api/save_ranking.py
from fastapi import APIRouter
from pydantic import BaseModel
from pathlib import Path
import pandas as pd
import math
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle, Spacer
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont("FreeSans", "FreeSans.ttf"))

router = APIRouter()

class RankingIn(BaseModel):
    categorie: str
    route_count: int
    # { "Nume": [scoreR1, scoreR2, ...] }
    scores: dict[str, list[float]]
    clubs: dict[str, str] = {}
    include_clubs: bool = False
    times: dict[str, list[float | None]] | None = None
    use_time_tiebreak: bool = False

@router.post("/save_ranking")
def save_ranking(payload: RankingIn):
    cat_dir = Path("escalada/clasamente") / payload.categorie
    cat_dir.mkdir(parents=True, exist_ok=True)
    times = payload.times or {}
    use_time = payload.use_time_tiebreak

    def time_for(name: str, idx: int):
        arr = times.get(name, [])
        return arr[idx] if idx < len(arr) else None

    # ---------- excel + pdf TOTAL ----------
    overall_df = _build_overall_df(payload)
    xlsx_tot = cat_dir / "overall.xlsx"
    pdf_tot  = cat_dir / "overall.pdf"
    overall_df.to_excel(xlsx_tot, index=False)
    _df_to_pdf(overall_df, pdf_tot, title=f"{payload.categorie} – Overall")

    # ---------- excel + pdf BY‑ROUTE ----------
    scores = payload.scores
    for r in range(payload.route_count):
        # 1. colectează (nume, scor brut) pentru ruta r
        route_list = [
            (name, arr[r] if r < len(arr) else None, time_for(name, r))
            for name, arr in scores.items()
        ]
        # 2. sortează descrescător (None → ultimii)
        route_list_sorted = sorted(
            route_list,
            key=lambda x: (
                -x[1] if x[1] is not None else math.inf,
                -(x[2]) if (use_time and x[2] is not None) else (math.inf if use_time else 0)
            )
        )

        # 3. calculează punctajele de ranking cu tie-handling
        points = {}
        pos = 1
        i = 0
        while i < len(route_list_sorted):
            same_score = [
                route_list_sorted[j]
                for j in range(i, len(route_list_sorted))
                if route_list_sorted[j][1] == route_list_sorted[i][1]
                and (
                    not use_time
                    or (route_list_sorted[j][2] == route_list_sorted[i][2])
                )
            ]
            first = pos
            last = pos + len(same_score) - 1
            avg_rank = (first + last) / 2
            for name, _, _ in same_score:
                points[name] = avg_rank
            pos += len(same_score)
            i += len(same_score)
        
        # tie-handling pe Score per rută
        ranks = []
        prev_score = None
        prev_time = None
        prev_rank = 0
        for idx, (_, score, tm) in enumerate(route_list_sorted, start=1):
            if score == prev_score and ((not use_time) or tm == prev_time):
                rank = prev_rank
            else:
                rank = idx
            ranks.append(rank)
            prev_score = score
            prev_time = tm
            prev_rank = rank

        df_route = pd.DataFrame([
            {
                "Rank": ranks[i],
                "Name": name,
                "Club": payload.clubs.get(name, ""),
                "Score": score,
                **({"Time": tm} if use_time else {}),
                "Points": points.get(name)
            }
            for i, (name, score, tm) in enumerate(route_list_sorted)
        ])

        # 5. salvează Excel și PDF pentru această rută
        xlsx_route = cat_dir / f"route_{r+1}.xlsx"
        pdf_route = cat_dir / f"route_{r+1}.pdf"
        df_route.to_excel(xlsx_route, index=False)
        _df_to_pdf(df_route, pdf_route, title=f"{payload.categorie} – Route {r+1}")

    return {"status": "ok", "saved": [str(p) for p in (xlsx_tot, pdf_tot, xlsx_route, pdf_route)]}


# ------- helpers -------
def _build_overall_df(p: RankingIn) -> pd.DataFrame:
    from math import prod

    scores = p.scores
    times = p.times or {}
    use_time = p.use_time_tiebreak
    data = []
    n = p.route_count
    n_comp = len(scores)

    for name, arr in scores.items():
        # calcul rank points identic frontend
        rp = [None] * n
        for r in range(n):
            scored = []
            for nume, sc in scores.items():
                if r < len(sc) and sc[r] is not None:
                    t_val = None
                    t_arr = times.get(nume, [])
                    if r < len(t_arr):
                        t_val = t_arr[r]
                    scored.append((nume, sc[r], t_val))
            scored.sort(
                key=lambda x: (
                    -x[1],
                    -(x[2]) if (use_time and x[2] is not None) else (math.inf if use_time else 0)
                )
            )

            i = 0
            pos = 1
            while i < len(scored):
                current = scored[i]
                same = [current]
                while (
                    i + len(same) < len(scored)
                    and scored[i][1] == scored[i + len(same)][1]
                    and (
                        not use_time
                        or scored[i + len(same)][2] == current[2]
                    )
                ):
                    same.append(scored[i + len(same)])
                avg = (pos + pos + len(same) - 1) / 2
                for nume, _, _ in same:
                    if nume == name:
                        rp[r] = avg
                pos += len(same)
                i += len(same)

        # completează lipsurile cu penalizare
        filled = [v if v is not None else n_comp + 1 for v in rp]
        while len(filled) < n:
            filled.append(n_comp + 1)

        total = round(prod(filled) ** (1 / n), 3)
        club = p.clubs.get(name, "")
        row = [name, club]
        time_row = times.get(name, [])
        for idx in range(n):
            row.append(arr[idx] if idx < len(arr) else None)
            if use_time:
                row.append(time_row[idx] if idx < len(time_row) else None)
        row.append(total)
        data.append(row)

    cols = ["Nume", "Club"]
    for i in range(n):
        cols.append(f"Score R{i+1}")
        if use_time:
            cols.append(f"Time R{i+1}")
    cols.append("Total")
    df = pd.DataFrame(data, columns=cols)
    df.sort_values("Total", inplace=True)
    ranks = []
    prev_total = None
    prev_rank = 0
    for idx, total in enumerate(df["Total"], start=1):
        rank = prev_rank if total == prev_total else idx
        ranks.append(rank)
        prev_total = total
        prev_rank = rank
    df.insert(0, "Rank", ranks)
    return df

def _build_by_route_df(p: RankingIn) -> pd.DataFrame:
    rows = []
    n = p.route_count
    times = p.times or {}
    for r in range(n):
        for name, arr in p.scores.items():
            score = arr[r] if r < len(arr) else None
            t_arr = times.get(name, [])
            tm = t_arr[r] if r < len(t_arr) else None
            rows.append({"Route": r + 1, "Name": name, "Score": score, "Time": tm})
    return pd.DataFrame(rows)

def _df_to_pdf(df: pd.DataFrame, pdf_path: Path, title="Ranking"):
    # Create document with margins and landscape A4
    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=landscape(A4),
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )

    # Styles for title
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'TitleStyle',
        parent=styles['Heading1'],
        alignment=1,        # center
        fontSize=18,
        fontName="FreeSans",
        spaceAfter=12,
    )

    # Build table data
    data = [df.columns.tolist()] + df.astype(str).values.tolist()

    # Create table
    table = Table(data, hAlign='CENTER')
    # Table styling
    tbl_style = TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), 'FreeSans'),
        ('FONTNAME', (0, 1), (-1, -1), 'FreeSans'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4F81BD')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
    ])
    # Alternate row background colors
    for i in range(1, len(data)):
        bg_color = colors.whitesmoke if i % 2 == 0 else colors.lightgrey
        tbl_style.add('BACKGROUND', (0, i), (-1, i), bg_color)

    table.setStyle(tbl_style)

    # Build document elements
    elements = []
    elements.append(Paragraph(title, title_style))
    elements.append(Spacer(1, 12))
    elements.append(table)

    # Generate PDF
    doc.build(elements)
