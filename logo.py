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
    kind = sys.argv[3] if len(sys.argv) > 3 else ''   # audio / video / editor — що намалювати довкола зірки
    BG, Y = '#1a1b1d', '#ffd23f'
    scx, scy = cx - mx, cy - my                         # центр зірки після центрування
    for n in (192, 512):
        S4 = n*4; im = Image.new('RGB', (S4, S4), BG); dr = ImageDraw.Draw(im)
        sc = S4*0.40/half          # фігура займає 80% іконки
        P = lambda x, y: (S4/2 + x*sc, S4/2 - y*sc)
        for s in pieces: dr.polygon([P(x - mx, y - my) for x, y in s], fill=Y)
        u = sc                     # 1 одиниця логотипа в пікселях
        X0, Y0 = P(scx, scy)
        lw = max(2, int(1.3*u))
        if kind == 'audio':        # звукові смуги: над зіркою, обабіч неї й під нею
            bar = lambda x1, x2, dy: dr.rounded_rectangle([X0 + x1*u, Y0 + dy*u - 0.95*u, X0 + x2*u, Y0 + dy*u + 0.95*u], radius=0.95*u, fill=Y)
            bar(-7, 7, -8.6); bar(-11.5, 11.5, 0.4); bar(-7, 7, 9.4)
        elif kind == 'video':      # око, зірка — зіниця
            w, h = 12.0, 7.5          # мигдалеве око: дві дуги y = ±h(1 − (x/w)²), що сходяться в кутиках
            xs_ = [w*(i/40*2 - 1) for i in range(41)]
            top = [(X0 + x*u, Y0 - h*(1 - (x/w)**2)*u) for x in xs_]
            bot = [(X0 + x*u, Y0 + h*(1 - (x/w)**2)*u) for x in reversed(xs_)]
            dr.line(top + bot + top[:2], fill=Y, width=lw, joint='curve')
        elif kind == 'editor':     # кадр кіноплівки з перфорацією
            w, h = 9.0, 9.5
            dr.rounded_rectangle([X0 - w*u, Y0 - h*u, X0 + w*u, Y0 + h*u], radius=1.2*u, outline=Y, width=lw)
            for side in (-1, 1):
                x = X0 + side*(w - 2.0)*u
                for k in range(-3, 4):
                    y = Y0 + k*2.6*u
                    dr.rectangle([x - 0.6*u, y - 0.7*u, x + 0.6*u, y + 0.7*u], fill=Y)
        rs = 1.0 if not kind else 0.8          # зірка (в оці й кадрі трохи менша)
        star_px = [P(scx + (x - scx)*rs, scy + (y - scy)*rs) for x, y in [(a - mx, b - my) for a, b in star]]
        if not kind: dr.polygon(star_px, fill=Y)      # в іконках застосунків зірки немає
        im.resize((n, n), Image.LANCZOS).save(f'{out}/icon-{n}.png')
