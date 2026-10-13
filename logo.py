import math, sys
from PIL import Image, ImageDraw
# Геометрія (одиниці; центр 0,0; y вгору). 8 однакових паралелограмів + зірка.
g, w, L = 4.0, 9.0, 26.0          # проміжок, ширина смуги, довжина
d = g / math.sqrt(2)              # зсув діагонального зрізу, щоб проміжок по діагоналі теж = g
base = [(g/2, g/2+d), (g/2+w, g/2+w+d), (g/2+w, g/2+w+d+L), (g/2, g/2+d+L)]
def rot(p, k):                    # поворот на k*90°
    x, y = p
    for _ in range(k): x, y = -y, x
    return (x, y)
pieces = []
for k in range(4):
    pieces.append([rot(p, k) for p in base])
    pieces.append([rot((-x, y), k) for x, y in base])   # дзеркальна пара
cx, cy, R = 26.0, 26.0, 7.5        # зірка в куті між верхнім і правим променем
star = [(cx + (R if i % 2 == 0 else R*0.42)*math.cos(math.pi/2 + i*math.pi/5),
         cy + (R if i % 2 == 0 else R*0.42)*math.sin(math.pi/2 + i*math.pi/5)) for i in range(10)]
shapes = pieces + [star]
# центруємо всю композицію (разом із зіркою) у квадраті
xs = [x for s in shapes for x, _ in s]; ys = [y for s in shapes for _, y in s]
mx, my = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2
half = max(max(xs)-min(xs), max(ys)-min(ys))/2
shapes = [[(x-mx, y-my) for x, y in s] for s in shapes]
def svg_path(scale=1, off=0):
    return ' '.join('M' + ' L'.join(f'{off+x*scale:.2f} {off-y*scale:.2f}' for x, y in s) + ' Z' for s in shapes)
if sys.argv[1] == 'svg':          # для шапки: viewBox навколо фігури
    print(f'<svg class="logo" viewBox="{-half:.2f} {-half:.2f} {2*half:.2f} {2*half:.2f}" fill="currentColor" aria-hidden="true"><path d="{svg_path()}"/></svg>')
else:
    out = sys.argv[2]
    glyph = sys.argv[3] if len(sys.argv) > 3 else ''   # знак застосунку в кружечку внизу праворуч: ♫ ▶ ✂
    from PIL import ImageFont
    for n in (192, 512):
        S4 = n*4; im = Image.new('RGB', (S4, S4), '#1a1b1d'); dr = ImageDraw.Draw(im)
        sc = S4*(0.36 if glyph else 0.40)/half          # фігура займає 80% іконки (зі знаком — 72%)
        cx0 = cy0 = S4/2 - (S4*0.04 if glyph else 0)
        for s in shapes: dr.polygon([(cx0+x*sc, cy0-y*sc) for x, y in s], fill='#ffd23f')
        if glyph:
            r = S4*0.19; bx = by = S4*0.76
            dr.ellipse([bx-r, by-r, bx+r, by+r], fill='#151618', outline='#ffd23f', width=int(S4*0.018))
            f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', int(r*(1.75 if glyph == '✂' else 1.25)))
            dr.text((bx, by), glyph, font=f, fill='#ffd23f', anchor='mm')
        im.resize((n, n), Image.LANCZOS).save(f'{out}/icon-{n}.png')
