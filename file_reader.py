# アップロードされたPDF・画像からテキストを抽出するモジュール。バックエンド担当が管理する。
import pymupdf

import llm_service

# 画像PDFのOCRは時間とAPI利用量がかかるため、先頭ページのみに制限する
MAX_OCR_PAGES = 5
# 長文すぎる場合の文字数上限(翻訳APIへの入力サイズを抑える)
MAX_TEXT_CHARS = 20000
# 抽出テキストがこれ未満なら「画像PDF」とみなしてOCRに切り替える
MIN_TEXT_THRESHOLD = 50

SUPPORTED_IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def extract_text_from_file(filename, data):
    """ファイル名と中身(bytes)を受け取り、英文テキストを返す。

    - 文字PDF: PyMuPDFでテキスト抽出
    - 画像PDF: 先頭ページを画像化してGeminiでOCR
    - PNG/JPG: GeminiでOCR
    """
    name = filename.lower()

    if name.endswith(".pdf"):
        return _extract_from_pdf(data)

    for ext, mime in SUPPORTED_IMAGE_TYPES.items():
        if name.endswith(ext):
            return llm_service.ocr_image(data, mime)

    raise ValueError("対応していないファイル形式です。(PDF / PNG / JPG のみ)")


def _extract_from_pdf(data):
    doc = pymupdf.open(stream=data, filetype="pdf")

    text = "\n".join(page.get_text() for page in doc)
    if len(text.strip()) >= MIN_TEXT_THRESHOLD:
        return text[:MAX_TEXT_CHARS]

    # テキストがほぼ無い→スキャン画像PDFとみなし、ページを画像化してOCR
    texts = []
    for i in range(min(len(doc), MAX_OCR_PAGES)):
        pix = doc[i].get_pixmap(dpi=150)
        texts.append(llm_service.ocr_image(pix.tobytes("png"), "image/png"))
    return "\n".join(texts)[:MAX_TEXT_CHARS]
