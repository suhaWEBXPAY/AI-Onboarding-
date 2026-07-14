from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent / "pydeps"))
from PIL import Image

root = Path(__file__).parent
source = root / "documents__stakeholder-info__front_652240887V.jpeg"
image = Image.open(source)
image.rotate(270, expand=True).save(root / "front_652240887V_rotated.png")
