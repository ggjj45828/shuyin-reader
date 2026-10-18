"""把 piper 的 <model>.onnx.json 里的 phoneme_id_map 转成 sherpa-onnx 需要的 tokens.txt。

为什么需要：sherpa-onnx 的 VITS 走 tokens.txt（每行「符号 id」），
而 piper 模型只带 onnx.json。CI 里下完模型如果没有 tokens.txt，就用这个脚本生成。
"""
import json
import os
import sys


def main():
    if len(sys.argv) < 2:
        raise SystemExit("用法：python3 onnx-json-to-tokens.py <模型目录>")
    folder = sys.argv[1]
    if os.path.exists(os.path.join(folder, "tokens.txt")):
        print("已有 tokens.txt，跳过")
        return
    names = [n for n in os.listdir(folder) if n.endswith(".onnx.json")]
    if not names:
        raise SystemExit("目录里没有 *.onnx.json：" + folder)
    config = json.load(open(os.path.join(folder, names[0]), encoding="utf-8"))
    mapping = config.get("phoneme_id_map") or {}
    rows = []
    for symbol, ids in mapping.items():
        if isinstance(ids, list) and ids:
            rows.append((ids[0], symbol))
    rows.sort()
    out = os.path.join(folder, "tokens.txt")
    with open(out, "w", encoding="utf-8") as handle:
        for _, symbol in rows:
            handle.write(symbol + "\n")
    print("生成 %s（%d 个符号）" % (out, len(rows)))


if __name__ == "__main__":
    main()
