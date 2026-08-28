# deepseek-tokenize.py — SwitchBench 离线 token 估计的 Python 侧 helper。
#
# 使用官方 DeepSeek v4 tokenizer（仓库根 deepseek_v4_tokenizer/，与官方
# deepseek_tokenizer.py 同一加载路径：transformers.AutoTokenizer）。
# 输入（stdin）：JSON 数组 [{id, messages?|text?}]；messages 走官方 chat_template
# 渲染后计数（与请求线格式同构），text 直接计数。
# 输出（stdout）：JSON 数组 [{id, tokens, method}]。
# 用途：Baseline（DSH session log 无 usage 事件，OPEN-5 降级口径）的 input token
# 估计 + A/B run 的估计器校准（A/B 有 API 真实 usage 可对照）。
import json
import sys

import transformers


def main():
    tokenizer_dir = sys.argv[1]
    items = json.load(sys.stdin)
    tokenizer = transformers.AutoTokenizer.from_pretrained(tokenizer_dir, trust_remote_code=True)
    out = []
    for item in items:
        if item.get("messages") is not None:
            try:
                text = tokenizer.apply_chat_template(item["messages"], tokenize=False)
                method = "chat_template"
            except Exception as error:  # 模板渲染失败时降级为纯文本拼接，method 如实标注
                text = "\n".join(
                    str(message.get("content", ""))
                    for message in item["messages"]
                    if isinstance(message, dict)
                )
                method = f"plain_concat (template error: {type(error).__name__})"
        else:
            text = item.get("text", "")
            method = "plain_text"
        out.append({"id": item["id"], "tokens": len(tokenizer.encode(text)), "method": method})
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
