# LLM(Gemini / Ollama)との通信を担当するモジュール。バックエンド担当が管理する。
import json
import logging
import os
from pathlib import Path

from openai import OpenAI

logger = logging.getLogger(__name__)


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
            logger.warning(f"LLM call failed on {model}: {e}")
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
