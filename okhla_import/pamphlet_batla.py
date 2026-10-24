"""A4 Hindi pamphlet: SIR public hearing + SIR assistance camp, Batla House (Blocks G and K), Okhla AC 54.
   python3 okhla_import/pamphlet_batla.py
Devanagari is shaped by MuPDF's HTML engine; the Kohinoor Devanagari font is taken from macOS (see FONTS)."""
import fitz, segno, io, os
from fontTools.ttLib import TTCollection

OUT = "okhla_import/out/Batla_House_Public_Hearing_Pamphlet.pdf"
FONTS = "/private/tmp/claude-501/fonts"
URL = "https://macinsights.in/check-epic?state=delhi"
os.makedirs(FONTS, exist_ok=True)
if not os.path.exists(f"{FONTS}/Kohinoor-Bold.ttf"):
    for f in TTCollection("/System/Library/Fonts/Kohinoor.ttc").fonts:
        f.save(f"{FONTS}/Kohinoor-{f['name'].getDebugName(4).split()[-1]}.ttf")

NAVY, SAFFRON, GREEN, INK, PAPER, CREAM = (0.04, 0.13, 0.30), (1.0, 0.62, 0.10), (0.05, 0.50, 0.25), (0.08, 0.10, 0.16), (1, 1, 1), (1.0, 0.96, 0.88)
W, H = 595.28, 841.89
CSS = """
@font-face { font-family: K; font-weight: 400; src: url(Kohinoor-Regular.ttf); }
@font-face { font-family: K; font-weight: 600; src: url(Kohinoor-Semibold.ttf); }
@font-face { font-family: K; font-weight: 700; src: url(Kohinoor-Bold.ttf); }
* { font-family: K; margin: 0; padding: 0; }
b { font-weight: 700; }
"""
doc = fitz.open()
pg = doc.new_page(width=W, height=H)
arc = fitz.Archive(FONTS)
def box(x0, y0, x1, y1, fill, r=0, stroke=None, w=1.2):
    pg.draw_rect(fitz.Rect(x0, y0, x1, y1), color=stroke, fill=fill, width=w if stroke else 0, radius=r if r else None)
def text(x0, y0, x1, y1, html, css=""):
    rc, _ = pg.insert_htmlbox(fitz.Rect(x0, y0, x1, y1), html, css=CSS + css, archive=arc)
    if rc < 0: print("OVERFLOW:", html[:60])

# ---------------------------------------------------------------- 1. slogan band
box(0, 0, W, 176, NAVY)
box(0, 176, W, 182, SAFFRON)
text(20, 10, W - 20, 34, "<p style='text-align:center'>जनता द्वारा आयोजित &nbsp;•&nbsp; SIR सामाजिक अंकेक्षण (Social Audit)</p>", "p{font-size:13px;font-weight:600;color:#FFB84D}")
text(10, 36, W - 10, 142, "<p style='text-align:center'>वोट का अधिकार,<br>जीने का अधिकार</p>", "p{font-size:46px;font-weight:700;color:#FFFFFF;line-height:1.08}")
text(20, 146, W - 20, 172, "<p style='text-align:center'>कोई भी योग्य मतदाता छूटना नहीं चाहिए &nbsp;•&nbsp; कोई भी अयोग्य मतदाता शामिल नहीं होना चाहिए</p>", "p{font-size:12.5px;font-weight:600;color:#DCE6F7}")

# ---------------------------------------------------------------- 2. title
box(26, 194, W - 26, 266, CREAM, r=0.08, stroke=NAVY, w=2.2)
text(34, 196, W - 34, 266, "<p style='text-align:center'>SIR पर <span style='color:#D9480F'>जन सुनवाई</span><br><span style='font-size:21px'>एवं SIR सहायता कैंप &nbsp;|&nbsp; बटला हाउस, ओखला</span></p>",
     "p{font-size:32px;font-weight:700;color:#0A2147;line-height:1.1}")

# ---------------------------------------------------------------- 3. when / where
box(26, 274, 318, 412, NAVY, r=0.06)
text(38, 278, 312, 316, "<p>रविवार, 18 अक्टूबर 2026</p>", "p{font-size:25px;font-weight:700;color:#FFB84D}")
text(38, 312, 312, 346, "<p>कैंप: <b>सुबह 10 बजे से शाम 6 बजे तक</b></p>", "p{font-size:15.5px;color:#FFFFFF}")
box(38, 348, 312, 404, (1, 1, 1), r=0.10)
text(46, 349, 306, 404, "<p><b style='color:#D9480F'>जन सुनवाई</b><br><b>दोपहर 1 बजे से 4 बजे तक</b></p>", "p{font-size:17px;color:#0A2147;line-height:1.2;text-align:center}")
box(328, 274, W - 26, 412, SAFFRON, r=0.06)
text(338, 278, W - 36, 304, "<p>स्थान</p>", "p{font-size:14px;font-weight:700;color:#0A2147}")
text(338, 300, W - 36, 356, "<p>बारात घर,<br>बटला हाउस</p>", "p{font-size:25px;font-weight:700;color:#0A2147;line-height:1.05}")
box(338, 362, W - 36, 404, NAVY, r=0.12)
text(342, 363, W - 40, 404, "<p style='text-align:center'>केवल <b style='color:#FFB84D'>ब्लॉक G और ब्लॉक K</b><br>के निवासियों के लिए</p>", "p{font-size:13.5px;color:#fff;line-height:1.2}")

# ---------------------------------------------------------------- 4. who should come
text(26, 420, W - 26, 444, "<p>ये कैंप और जन सुनवाई इनके लिए है:</p>", "p{font-size:17px;font-weight:700;color:#0A2147}")
cards = [
    ("1", "जिनका नाम SIR सूची से गायब है", "नाम छूट गया या हट गया? अपनी बात लेकर आइए, हम नाम जुड़वाने में मदद करेंगे।", (0.78, 0.18, 0.10)),
    ("2", "जिन्हें ASDD में ग़लत डाला गया", "जीवित और यहीं रहने वाले को अनुपस्थित, स्थानांतरित, मृत या दोहरा दिखा दिया गया? अपना मामला रखें।", (0.04, 0.13, 0.30)),
    ("3", "नए मतदाता (18 वर्ष के)", "पहली बार वोट बनवाना है? फ़ॉर्म 6 भरकर नाम जुड़वाएँ, मौक़े पर मदद मिलेगी।", GREEN),
]
cx, cw, gap = 26, (W - 52 - 2 * 10) / 3, 10
for i, (n, head, body, col) in enumerate(cards):
    x0 = cx + i * (cw + gap)
    box(x0, 450, x0 + cw, 588, (1, 1, 1), r=0.05, stroke=col, w=2)
    box(x0, 450, x0 + cw, 502, col, r=0.05)
    box(x0, 484, x0 + cw, 502, col)
    pg.draw_circle(fitz.Point(x0 + 20, 467), 11, color=None, fill=(1, 1, 1))
    text(x0 + 9, 455, x0 + 31, 479, f"<p style='text-align:center'>{n}</p>", f"p{{font-size:16px;font-weight:700;color:rgb({int(col[0]*255)},{int(col[1]*255)},{int(col[2]*255)})}}")
    text(x0 + 34, 452, x0 + cw - 4, 502, f"<p>{head}</p>", "p{font-size:12.2px;font-weight:700;color:#fff;line-height:1.12}")
    text(x0 + 6, 506, x0 + cw - 6, 586, f"<p>{body}</p>", "p{font-size:12px;color:#1A2233;line-height:1.28}")

# ---------------------------------------------------------------- 5. QR
box(26, 598, W - 26, 714, CREAM, r=0.05, stroke=SAFFRON, w=2.4)
qr = segno.make(URL, error="m", micro=False)
buf = io.BytesIO(); qr.save(buf, kind="png", scale=12, border=2, dark="#0A2147", light="#FFFFFF"); buf.seek(0)
box(38, 606, 144, 706, (1, 1, 1), r=0.06, stroke=NAVY, w=1.5)
pg.insert_image(fitz.Rect(42, 609, 140, 703), stream=buf.getvalue())
text(158, 600, W - 34, 638, "<p>अपना नाम खुद जाँचें — 30 सेकंड में</p>", "p{font-size:20px;font-weight:700;color:#D9480F;line-height:1.1}")
text(158, 630, W - 34, 684,
     "<p>QR कोड स्कैन करें और अपना <b>EPIC (वोटर आईडी) नंबर</b> डालकर देखें कि आपका नाम <b>SIR 2026 की हटाई गई सूची (ASDD)</b> या <b>नोटिस सूची</b> में है या नहीं।</p>",
     "p{font-size:13px;color:#1A2233;line-height:1.28}")
box(158, 686, W - 34, 708, NAVY, r=0.2)
text(162, 686, W - 38, 708, "<p style='text-align:center'>macinsights.in/check-epic?state=delhi</p>", "p{font-size:12px;font-weight:600;color:#fff}")

# ---------------------------------------------------------------- 6. bring + footer
text(26, 720, W - 26, 760,
     "<p><b style='color:#0A2147'>साथ लाएँ:</b> वोटर आईडी (EPIC) कार्ड, आधार कार्ड, पते का प्रमाण, और नोटिस मिला हो तो नोटिस। "
     "नए मतदाता: उम्र का प्रमाण व एक फ़ोटो। <b style='color:#D9480F'>अपने परिवार, दोस्तों और पड़ोसियों को भी साथ लाएँ!</b></p>",
     "p{font-size:11.4px;color:#1A2233;line-height:1.25}")
box(0, 762, W, H, NAVY)
box(0, 762, W, 767, SAFFRON)
text(20, 770, W - 20, 796, "<p style='text-align:center'>अधिक जानकारी व सहायता के लिए संपर्क करें</p>", "p{font-size:12.5px;font-weight:600;color:#FFB84D}")
box(36, 797, 290, 832, (1, 1, 1), r=0.3)
box(305, 797, W - 36, 832, (1, 1, 1), r=0.3)
text(40, 798, 288, 832, "<p style='text-align:center'><span style='font-size:13px'>शकील</span> &nbsp;<b>8824166600</b></p>", "p{font-size:19px;color:#0A2147;line-height:1.3}")
text(309, 798, W - 40, 832, "<p style='text-align:center'><span style='font-size:13px'>नदीम</span> &nbsp;<b>95822 43287</b></p>", "p{font-size:19px;color:#0A2147;line-height:1.3}")

doc.save(OUT)
pg.get_pixmap(dpi=110).save("/private/tmp/claude-501/pamphlet_preview.png")
print(OUT)
