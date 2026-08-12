from PIL import Image

SRC = 'assets/sakura.png'
BASE = (255, 143, 196, 255)  # 品牌粉 #ff8fc4

def make_icon(size):
    bg = Image.new('RGBA', (size, size), BASE)
    char = Image.open(SRC).convert('RGBA')
    a = char.getchannel('A')
    bbox = a.getbbox()
    char = char.crop(bbox)
    cw, ch = char.size
    # 适配到 78% 以内，保证 maskable 安全区（中心 80%）不被裁切
    maxw, maxh = size * 0.78, size * 0.78
    scale = min(maxw / cw, maxh / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    char = char.resize((nw, nh), Image.LANCZOS)
    x = (size - nw) // 2
    y = (size - nh) // 2
    bg.paste(char, (x, y), char)
    return bg

for s, fn in [(512, 'assets/icon-512.png'),
              (192, 'assets/icon-192.png'),
              (180, 'assets/icon-180.png')]:
    make_icon(s).save(fn)
    print('saved', fn)
