from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent / "pydeps"))
import fitz

root = Path(__file__).parent
out = root / "rendered"
out.mkdir(exist_ok=True)

for pdf_path in sorted(root.glob("*.pdf")):
    doc = fitz.open(pdf_path)
    doc_out = out / pdf_path.stem
    doc_out.mkdir(exist_ok=True)
    for page_no, page in enumerate(doc):
        target = doc_out / f"page-{page_no + 1:03}.png"
        if not target.exists():
            page.get_pixmap(matrix=fitz.Matrix(1.7, 1.7), alpha=False).save(target)
    print(f"{pdf_path.name}\t{len(doc)} pages")
