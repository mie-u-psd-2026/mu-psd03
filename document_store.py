# 文章データ(documents.json)の読み書きを担当するモジュール。バックエンド担当が管理する。
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

# 保存した文章はJSONファイルに永続化する(DBは使わない)
DOCUMENTS_FILE = Path(__file__).parent / "documents.json"


def load_documents():
    if DOCUMENTS_FILE.exists():
        return json.loads(DOCUMENTS_FILE.read_text(encoding="utf-8"))
    return []


def save_documents(docs):
    DOCUMENTS_FILE.write_text(
        json.dumps(docs, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def find_document(docs, doc_id):
    return next((d for d in docs if d["id"] == doc_id), None)


def make_title(text):
    first_line = text.strip().splitlines()[0].strip()
    return first_line[:30] + ("…" if len(first_line) > 30 else "")


def create_document_record(en_text, ja_text):
    return {
        "id": uuid.uuid4().hex,
        "title": make_title(en_text),
        "en_text": en_text,
        "ja_text": ja_text,
        "words": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
