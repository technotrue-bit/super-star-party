# Renders public/og-image.png (1200x630) for social link previews.
# Run: python3 tools/make-og-image.py
from PIL import Image, ImageDraw, ImageFont

ROOT = __file__.rsplit("/tools/", 1)[0]
BG = (0x2B, 0x1D, 0x4E)
GOLD = (0xFF, 0xD2, 0x3F)
WHITE = (0xFF, 0xFF, 0xFF)
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

W, H = 1200, 630
img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# Right side: two minigame stills, stacked with a slight offset.
shot = Image.open(f"{ROOT}/public/minigames/pie_flick.webp").convert("RGB").resize((400, 250))
shot2 = Image.open(f"{ROOT}/public/minigames/slingshot_summit.webp").convert("RGB").resize((400, 250))
for box, pic in (((790, 110), shot2), ((760, 300), shot)):
    frame = Image.new("RGB", (pic.width + 12, pic.height + 12), GOLD)
    img.paste(frame, (box[0] - 6, box[1] - 6))
    img.paste(pic, box)

# Left side: title and tagline.
title_font = ImageFont.truetype(BOLD, 84)
sub_font = ImageFont.truetype(REG, 32)
tag_font = ImageFont.truetype(BOLD, 30)
draw.text((70, 165), "SUPER", font=title_font, fill=GOLD)
draw.text((70, 265), "STAR PARTY", font=title_font, fill=GOLD)
draw.text((70, 390), "A bright, mischievous party-board game.", font=sub_font, fill=WHITE)
draw.text((70, 440), "Free to play in your browser.", font=sub_font, fill=WHITE)
draw.text((70, 530), "trueaigaming.com", font=tag_font, fill=GOLD)

img.save(f"{ROOT}/public/og-image.png", optimize=True)
print("wrote public/og-image.png")
