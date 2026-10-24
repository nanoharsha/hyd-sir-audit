"""Contact sheet of roll cards (cropped from the Jan-2025 PDFs) beside the house number we now hold.
   python3 okhla_import/card_sheet.py out.png METHOD [n] [part] [seed]"""
import sys, csv, random, fitz, pandas as pd, re
from PIL import Image, ImageDraw
out, method = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 16
part = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else None
seed = int(sys.argv[5]) if len(sys.argv) > 5 else 1
H = "/Users/khush/Voter Enumeration App"
PDF = f"{H}/sir-ocr/sir-ocr-macos/pdfs/2025-EROLLGEN-U05-54-FinalRoll-Revision1-ENG-{{}}-WI.pdf"
aud = [r for r in csv.DictReader(open(f"{H}/electoral_app_cf/okhla_import/out/house_review.csv"))]
ob = pd.read_csv(f"{H}/sir-ocr/updated/base_roll_2025_updated_with_changes.csv", dtype=str, keep_default_na=False)
ob = ob[ob.part_number.astype(int).between(59, 69)]
key = {(int(r.part_number), r.epic_id.replace(" ", "").upper()): r for r in ob.itertuples()}
rows = [a for a in aud if a["method"] == method and 59 <= int(a["old_part"]) <= 69 and (part is None or int(a["old_part"]) == part)]
random.seed(seed); random.shuffle(rows)
tiles = []
for a in rows:
    r = key.get((int(a["old_part"]), re.sub(r"[^A-Z0-9]", "", a["epic"].upper())))
    if not r: continue
    pg_rows = ob[(ob.part_number == r.part_number) & (ob.page == r.page)]
    idx = list(pg_rows["index"].astype(int)).index(int(r.index)) if int(r.index) in list(pg_rows["index"].astype(int)) else None
    if idx is None or idx >= 30: continue
    doc = fitz.open(PDF.format(a["old_part"])); pg = doc[int(r.page) - 1]; R = pg.rect
    col, row = idx % 3, idx // 3
    x0 = (33 + col * 451.5) / 1413; y0 = (67 + row * 188.4) / 2000
    clip = fitz.Rect(R.width * x0, R.height * y0, R.width * (x0 + 442 / 1413), R.height * (y0 + 180 / 2000))
    im = Image.frombytes("RGB", (int((clip.width) * 1.6), int(clip.height * 1.6)), fitz.Pixmap(fitz.csRGB, pg.get_pixmap(dpi=115, clip=clip)).samples) if False else None
    pm = pg.get_pixmap(dpi=115, clip=clip); im = Image.frombytes("RGB", (pm.width, pm.height), pm.samples)
    cap = f"P{a['old_part']} #{a['serial_2025']}  was: {a['house_in_pack'][:30]!r}  now: {a['house_now'][:30]!r}"
    canvas = Image.new("RGB", (im.width, im.height + 16), "white"); canvas.paste(im, (0, 16))
    ImageDraw.Draw(canvas).text((3, 2), cap, fill=(180, 0, 0)); tiles.append(canvas)
    if len(tiles) >= n: break
w = max(t.width for t in tiles); h = max(t.height for t in tiles); cols = 2
sheet = Image.new("RGB", (w * cols, h * ((len(tiles) + cols - 1) // cols)), "white")
for i, t in enumerate(tiles): sheet.paste(t, ((i % cols) * w, (i // cols) * h))
sheet.save(out); print(len(tiles), sheet.size)
