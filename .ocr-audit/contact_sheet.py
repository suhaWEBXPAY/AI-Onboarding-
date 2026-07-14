from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent / "pydeps"))
from PIL import Image, ImageDraw

for folder in (Path(__file__).parent / "rendered").iterdir():
    pages = sorted(folder.glob("*.png"))
    if len(pages) < 5:
        continue
    width, height = 240, 330
    sheet = Image.new("RGB", (width * 5, height * ((len(pages) + 4) // 5)), "white")
    draw = ImageDraw.Draw(sheet)
    for i, page in enumerate(pages):
        image = Image.open(page).convert("RGB")
        image.thumbnail((width - 8, height - 24))
        x, y = (i % 5) * width, (i // 5) * height
        sheet.paste(image, (x + (width - image.width) // 2, y + 20))
        draw.text((x + 4, y + 3), str(i + 1), fill="black")
    sheet.save(folder.parent / f"{folder.name}__contact.jpg", quality=88)
    print(folder.name)
