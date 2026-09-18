import os
import sys
import json
import re
import easyocr

# Suppress PyTorch and EasyOCR verbose warnings
os.environ["PYTHONWARNINGS"] = "ignore"

# Global reader instance for caching model weights in RAM
_reader = None

def get_reader():
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    return _reader

def solve_with_easyocr(image_path):
    if not os.path.exists(image_path):
        return None

    reader = get_reader()
    try:
        result = reader.readtext(image_path, detail=0)
    except Exception as e:
        sys.stderr.write(f"EasyOCR Error reading {image_path}: {e}\n")
        return None

    # 1. Join text and turn lowercase
    raw_text = "".join(result).replace(" ", "").lower()

    # 2. Strip out punctuation/symbols
    clean_text = re.sub(r'[^a-z0-9]', '', raw_text)

    # 3. Post-process font fix: If it has 5 letters and an 'i' in the 4th spot, it's almost certainly a 'j'
    if len(clean_text) == 5 and clean_text[3] == 'i':
        clean_text = clean_text[:3] + 'j' + clean_text[4:]

    return clean_text

def run_pipe_mode():
    """Persistent mode reading JSON requests from stdin and responding to stdout."""
    # Pre-warm reader
    get_reader()
    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            image_path = req.get("image")
            if not image_path:
                resp = {"error": "Missing image path"}
            else:
                solved = solve_with_easyocr(image_path)
                resp = {"success": True, "text": solved or ""}
        except Exception as e:
            resp = {"success": False, "error": str(e)}

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--pipe":
        run_pipe_mode()
    elif len(sys.argv) > 1:
        img_path = sys.argv[1]
        solved = solve_with_easyocr(img_path)
        if solved:
            print(solved)
        else:
            print("")
    else:
        print("Usage: python3 solve_easyocr.py <image_path> OR python3 solve_easyocr.py --pipe")
