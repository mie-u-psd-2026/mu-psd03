# Flaskのルーティング定義。処理の実体は llm_service.py / document_store.py に分離している。
from flask import Flask, request, jsonify, send_from_directory

import llm_service
from document_store import (
    load_documents,
    save_documents,
    find_document,
    create_document_record,
)

app = Flask(__name__)

if app.debug:
    @app.after_request
    def add_header(response):
        if request.endpoint == 'static':
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response


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
        ja_text = llm_service.call_llm(llm_service.TRANSLATE_PROMPT, en_text)
    except Exception as e:
        app.logger.error(f"Translation failed: {e}")
        return jsonify({"error": "翻訳中にエラーが発生しました。"}), 500

    doc = create_document_record(en_text, ja_text)

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
        raw = llm_service.call_llm(llm_service.WORD_PICK_PROMPT, doc["en_text"])
        words = llm_service.parse_json_block(raw)
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
