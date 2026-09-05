"""
ByteByteGo-style animated architecture diagram -> looping GIF.

Pipeline (this is the "what an AI agent needs" answer in miniature):
  1. SCENE SPEC   - nodes, arrows, timings (data, not code)
  2. RENDERER     - draws one frame at a time (Pillow here; could be SVG/HTML)
  3. CHOREOGRAPHY - easing + phases (reveal -> draw arrows -> packet -> loop)
  4. ENCODER      - frames -> GIF with loop=0
"""

import math
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- config
W, H = 960, 540          # final GIF size
SS = 2                   # supersample factor (crisp edges)
FPS_MS = 60              # frame duration
OUT = "request_flow.gif"

BG      = "#FAFAF7"
INK     = "#22223B"
ARROW   = "#4A4E69"
REQ_CLR = "#2ECC71"      # request packet
RES_CLR = "#E67E22"      # response packet

NODES = [
    ("Client",        "browser",   "#4A90D9", "monitor"),
    ("Load Balancer", "nginx",     "#E8833A", "diamond"),
    ("API Server",    "REST / gRPC","#3AA76D", "gear"),
    ("Database",      "PostgreSQL","#6C63AC", "cylinder"),
]
NW, NH = 180, 96         # node box size
NY = 330                 # node top y
GAP = (W - 80 - NW * 4) // 3   # horizontal gap between nodes

TITLE = "How a Request Flows Through a System"

FONT_B = ImageFont.truetype("arialbd.ttf", 23 * SS)
FONT_S = ImageFont.truetype("arial.ttf", 16 * SS)
FONT_T = ImageFont.truetype("arialbd.ttf", 34 * SS)

# ---------------------------------------------------------------- easing
def ease_out_back(t):
    c1, c3 = 1.70158, 2.70158
    t -= 1
    return 1 + c3 * t**3 + c1 * t**2

def ease_in_out(t):
    return 0.5 - 0.5 * math.cos(math.pi * t)

def clamp01(t):
    return max(0.0, min(1.0, t))

# ---------------------------------------------------------------- geometry
def node_rect(i, scale=1.0):
    x = (40 + i * (NW + GAP)) * SS
    cy = (NY + NH / 2) * SS
    cx = x + NW * scale / 2
    w, h = NW * scale * SS, NH * scale * SS
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)

def node_center(i):
    x0, y0, x1, y1 = node_rect(i)
    return ((x0 + x1) / 2, (y0 + y1) / 2)

# ---------------------------------------------------------------- drawing
def draw_icon(d, kind, cx, cy, r, color):
    if kind == "monitor":
        d.rounded_rectangle((cx-r, cy-r, cx+r*0.9, cy+r*0.72), 4*SS, outline=color, width=3*SS)
        d.line((cx, cy+r*0.72, cx, cy+r), fill=color, width=3*SS)
        d.line((cx-r*0.5, cy+r, cx+r*0.5, cy+r), fill=color, width=3*SS)
    elif kind == "diamond":
        d.polygon([(cx, cy-r), (cx+r, cy), (cx, cy+r), (cx-r, cy)], outline=color, width=3*SS)
        d.ellipse((cx-r*0.28, cy-r*0.28, cx+r*0.28, cy+r*0.28), outline=color, width=3*SS)
    elif kind == "gear":
        d.ellipse((cx-r*0.75, cy-r*0.75, cx+r*0.75, cy+r*0.75), outline=color, width=3*SS)
        d.ellipse((cx-r*0.3, cy-r*0.3, cx+r*0.3, cy+r*0.3), outline=color, width=3*SS)
        for a in range(0, 360, 45):
            rad = math.radians(a)
            d.line((cx+math.cos(rad)*r*0.75, cy+math.sin(rad)*r*0.75,
                    cx+math.cos(rad)*r,      cy+math.sin(rad)*r), fill=color, width=3*SS)
    elif kind == "cylinder":
        ry = r * 0.35
        d.arc((cx-r, cy-r-ry, cx+r, cy+r*0.4), 180, 360, fill=color, width=3*SS)
        d.line((cx-r, cy-r*0.3, cx-r, cy+r*0.55), fill=color, width=3*SS)
        d.line((cx+r, cy-r*0.3, cx+r, cy+r*0.55), fill=color, width=3*SS)
        d.arc((cx-r, cy-r*0.05, cx+r, cy+r*1.15), 0, 180, fill=color, width=3*SS)
        d.arc((cx-r, cy-r*0.75, cx+r, cy+r*0.45), 0, 180, fill=color, width=3*SS)

def draw_node(img, d, i, scale, highlight):
    label, sub, color, icon = NODES[i]
    if scale <= 0.01:
        return
    x0, y0, x1, y1 = node_rect(i, scale)
    border = color
    width = 5 * SS
    if highlight:                      # pulse ring when the packet passes
        ring = node_rect(i, scale * 1.08)
        d.rounded_rectangle(ring, 16*SS, outline=color, width=2*SS)
        width = 7 * SS
    d.rounded_rectangle((x0, y0, x1, y1), 14*SS, fill="white",
                        outline=border, width=width)
    cx, cy = (x0+x1)/2, (y0+y1)/2
    draw_icon(d, icon, cx - NW*scale*0.30*SS, cy, 15*SS, color)
    tw = d.textlength(label, font=FONT_B)
    d.text((cx - NW*scale*0.06*SS - tw/2, cy - 24*SS), label, font=FONT_B, fill=INK)
    tw = d.textlength(sub, font=FONT_S)
    d.text((cx - NW*scale*0.06*SS - tw/2, cy + 8*SS), sub, font=FONT_S, fill="#777788")

def draw_arrow(d, i, t):
    """Arrow from node i to node i+1, drawn with progress t in [0,1]."""
    if t <= 0:
        return
    x0, y0, x1, y1 = node_rect(i)
    y = (y0 + y1) / 2
    start, end = x1 + 6*SS, node_rect(i + 1)[0] - 6*SS
    tip = start + (end - start) * ease_in_out(t)
    d.line((start, y, tip, y), fill=ARROW, width=4*SS)
    if t > 0.85:                       # arrowhead appears near the end
        d.polygon([(tip, y), (tip - 12*SS, y - 8*SS), (tip - 12*SS, y + 8*SS)], fill=ARROW)

def draw_packet(img, d, pos, color):
    x, y = pos
    rgb = tuple(int(color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
    for r, alpha in ((18, 40), (13, 80), (8, 255)):
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.ellipse((x-r*SS, y-r*SS, x+r*SS, y+r*SS), fill=rgb + (alpha,))
        img.alpha_composite(overlay)
    d.ellipse((x-5*SS, y-5*SS, x+5*SS, y+5*SS), fill=color)

# ---------------------------------------------------------------- timeline
def frame_renderer(frame_idx, total):
    """Pure function: frame index -> RGB image."""
    img = Image.new("RGBA", (W*SS, H*SS), BG)
    d = ImageDraw.Draw(img)

    d.text((W*SS/2 - d.textlength(TITLE, font=FONT_T)/2, 46*SS),
           TITLE, font=FONT_T, fill=INK)

    # phase boundaries (in frames)
    REVEAL = 10            # frames per node reveal
    ARROWF = 8             # frames per arrow draw
    TRAVEL = 26            # frames per packet leg
    HOLD   = 14

    t = 0
    # -- phase 1: nodes pop in
    for i in range(4):
        p = clamp01((frame_idx - t) / REVEAL)
        scale = ease_out_back(p) if p > 0 else 0.0
        highlight = False
        if 0 < p < 1 and i > 0:
            pass
        draw_node(img, d, i, min(scale, 1.05), highlight)
        t += REVEAL

    # -- phase 2: arrows draw
    arrow_t = [clamp01((frame_idx - (t + k*ARROWF)) / ARROWF) for k in range(3)]
    for k, at in enumerate(arrow_t):
        draw_arrow(d, k, at)
    t += 3 * ARROWF

    # -- phase 3: request packet forward, then response back
    forward_t = clamp01((frame_idx - t) / TRAVEL)
    t += TRAVEL
    back_t = clamp01((frame_idx - t) / TRAVEL)
    t += TRAVEL

    active = -1
    if forward_t > 0 and back_t == 0:
        posf = forward_t * 3
        active = min(int(round(posf)), 3)
        seg = min(int(posf), 2)
        frac = posf - seg
        xa = node_rect(seg)[2] + 6*SS
        xb = node_rect(seg+1)[0] - 6*SS
        ya = (node_rect(seg)[1] + node_rect(seg)[3]) / 2
        px, py = xa + (xb - xa) * frac, ya
        draw_packet(img, d, (px, py), REQ_CLR)
    elif back_t > 0:
        posf = (1 - back_t) * 3
        seg = min(int(posf), 2)
        frac = posf - seg
        xa = node_rect(seg)[2] + 6*SS
        xb = node_rect(seg+1)[0] - 6*SS
        ya = (node_rect(seg)[1] + node_rect(seg)[3]) / 2
        px, py = xa + (xb - xa) * frac, ya
        active = seg
        draw_packet(img, d, (px, py), RES_CLR)

    # highlight the node the packet just arrived at / is leaving
    if active >= 0:
        for i in range(4):
            base = ease_out_back(clamp01((frame_idx - i*REVEAL) / REVEAL))
            draw_node(img, d, i, min(base, 1.05), i == active)

    # -- captions
    if forward_t > 0 and back_t == 0 and forward_t < 1:
        msg = "request  ->"
        col = REQ_CLR
    elif back_t > 0 and back_t < 1:
        msg = "<-  response"
        col = RES_CLR
    else:
        msg, col = None, None
    if msg:
        f = ImageFont.truetype("arialbd.ttf", 20*SS)
        tw = d.textlength(msg, font=f)
        d.text((W*SS/2 - tw/2, H*SS - 64*SS), msg, font=f, fill=col)

    return img.convert("RGB").resize((W, H), Image.LANCZOS)

def main():
    REVEAL, ARROWF, TRAVEL, HOLD = 10, 8, 26, 14
    total = 4*REVEAL + 3*ARROWF + 2*TRAVEL + HOLD
    frames = [frame_renderer(i, total) for i in range(total)]
    frames[0].save(
        OUT, save_all=True, append_images=frames[1:],
        duration=FPS_MS, loop=0, optimize=True,
    )
    import os
    print(f"saved {OUT}: {total} frames, {os.path.getsize(OUT)/1024:.0f} KB")

if __name__ == "__main__":
    main()
