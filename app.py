import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory
from openai import OpenAI

app = Flask(__name__)

if app.debug:
    @app.after_request
    def add_header(response):
        if request.endpoint == 'static':
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response


def load_env(path=".env"):
    # python-dotenvを追加せずに.envを読み込む簡易ローダー
    env_file = Path(__file__).parent / path
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


load_env()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

if GEMINI_API_KEY:
    client = OpenAI(
        api_key=GEMINI_API_KEY,
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        # 混雑時に長時間待たされないよう短めに設定。リトライは自前のモデル切替で行う
        timeout=15,
        max_retries=0,
    )
    # 無料枠のflashは混雑(503)しやすいため、失敗時はflash-liteに自動で切り替える
    LLM_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"]
else:
    # .envにGEMINI_API_KEYが無い環境ではローカルOllamaにフォールバック
    client = OpenAI(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
    )
    LLM_MODELS = ["qwen2.5:1.5b"]

# 保存した文章はJSONファイルに永続化する(DBは使わない)
DOCUMENTS_FILE = Path(__file__).parent / "documents.json"

TRANSLATE_PROMPT = (
    "あなたはプロの英日翻訳者です。与えられた英文を、原文の段落構成を保ったまま"
    "自然な日本語に翻訳してください。翻訳文のみを出力し、前置きや説明は不要です。"
)

WORD_PICK_PROMPT = (
    "あなたは英語教師です。与えられた英文から、日本人の英語学習者が覚えるべき"
    "重要単語を8〜12個抽出してください。基礎的すぎる単語(a, the, is など)は除いてください。"
    "以下のJSON配列の形式のみで出力してください。説明やコードブロックは不要です。\n"
    '[{"word": "英単語", "meaning": "日本語の意味"}]'
)


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


def call_llm(system_prompt, user_text):
    last_error = None
    for model in LLM_MODELS:
        try:
            completion = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_text},
                ],
            )
            return completion.choices[0].message.content
        except Exception as e:
            app.logger.warning(f"LLM call failed on {model}: {e}")
            last_error = e
    raise last_error


def parse_json_block(text):
    # LLMがコードフェンス付きで返す場合に備えてJSON部分を取り出す
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def make_title(text):
    first_line = text.strip().splitlines()[0].strip()
    return first_line[:30] + ("…" if len(first_line) > 30 else "")


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/api/documents', methods=['GET'])
def list_documents():
    docs = load_documents()
    summary = [
        {"id": d["id"], "title": d["title"], "created_at": d["created_at"]}
        for d in docs
    ]
    return jsonify(summary)


@app.route('/api/documents/<doc_id>', methods=['GET'])
def get_document(doc_id):
    doc = find_document(load_documents(), doc_id)
    if doc is None:
        return jsonify({"error": "指定された文章が見つかりません。"}), 404
    return jsonify(doc)


@app.route('/api/documents', methods=['POST'])
def create_document():
    data = request.get_json()

    if not data or 'text' not in data or not data['text'].strip():
        return jsonify({"error": "英文を入力してください。"}), 400

    en_text = data['text'].strip()

    try:
        ja_text = call_llm(TRANSLATE_PROMPT, en_text)
    except Exception as e:
        app.logger.error(f"Translation failed: {e}")
        return jsonify({"error": "翻訳中にエラーが発生しました。"}), 500

    doc = {
        "id": uuid.uuid4().hex,
        "title": make_title(en_text),
        "en_text": en_text,
        "ja_text": ja_text,
        "words": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    docs = load_documents()
    docs.insert(0, doc)
    save_documents(docs)
    return jsonify(doc), 201


@app.route('/api/documents/<doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    docs = load_documents()
    doc = find_document(docs, doc_id)
    if doc is None:
        return jsonify({"error": "指定された文章が見つかりません。"}), 404
    docs.remove(doc)
    save_documents(docs)
    return jsonify({"message": "削除しました。"})


@app.route('/api/documents/<doc_id>/words', methods=['POST'])
def create_wordbook(doc_id):
    docs = load_documents()
    doc = find_document(docs, doc_id)
    if doc is None:
        return jsonify({"error": "指定された文章が見つかりません。"}), 404

    try:
        raw = call_llm(WORD_PICK_PROMPT, doc["en_text"])
        words = parse_json_block(raw)
        if not isinstance(words, list):
            raise ValueError("words is not a list")
    except Exception as e:
        app.logger.error(f"Word extraction failed: {e}")
        return jsonify({"error": "単語抽出中にエラーが発生しました。"}), 500

    doc["words"] = [
        {"word": str(w.get("word", "")), "meaning": str(w.get("meaning", ""))}
        for w in words
        if w.get("word")
    ]
    save_documents(docs)
    return jsonify(doc["words"])


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
