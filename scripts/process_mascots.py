from pathlib import Path
from PIL import Image
from rembg import remove
import numpy as np
from scipy import ndimage

SRC_DIR = Path("C:/Users/Administrator/Downloads")
OUT_DIR = Path("C:/Users/Administrator/WorkBuddy/2026-07-28-02-08-39/workbench/assets")

FILES = [
    ("AI网页版链接 (1).png", "sakura.png"),   # 小樱
    ("AI网页版链接 (2).png", "ran.png"),      # 小兰·红心蛋
    ("AI网页版链接 (3).png", "miki.png"),     # 美琪·音符蛋
    ("AI网页版链接 (4).png", "suu.png"),      # 小丝·三叶草蛋
    ("AI网页版链接 (5).png", "dia.png"),      # 方块·方块蛋
]

MIN_RATIO = 0.06  # 保留连通块面积 >= 最大连通块 * 该比例（清掉角落水印/杂点）


def clean_small_spots(img: Image.Image) -> Image.Image:
    """去掉小孤立块（水印/杂点），只保留主体。"""
    arr = np.array(img, dtype=np.float32)
    alpha = arr[:, :, 3]
    mask = alpha > 30
    labeled, n = ndimage.label(mask)
    if n == 0:
        return img
    component_ids, counts = np.unique(labeled[labeled > 0], return_counts=True)
    largest = counts.max()
    keep_ids = component_ids[counts >= max(largest * MIN_RATIO, 600)]
    keep_mask = np.isin(labeled, keep_ids)
    arr[:, :, 3] = np.where(keep_mask, alpha, 0)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def clean_alpha_fringe(img: Image.Image) -> Image.Image:
    """清掉 AI 抠图留下的低透明度灰边/残影：alpha 阈值 + 轻微腐蚀。"""
    arr = np.array(img, dtype=np.float32)
    a = arr[:, :, 3]
    mask = a > 50
    struct = np.ones((3, 3))
    eroded = ndimage.binary_erosion(mask, struct, iterations=1)
    newa = np.where(eroded, a, 0).astype(np.uint8)
    arr[:, :, 3] = newa
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def process(src_name: str, out_name: str):
    src = SRC_DIR / src_name
    if not src.exists():
        print(f"[skip] not found: {src}")
        return

    print(f"processing {src_name} ...")
    img = Image.open(src)
    out = remove(img)              # rembg AI 抠背景
    out = clean_small_spots(out)   # 再清小水印/孤立杂点
    out = clean_alpha_fringe(out)  # 清灰边残影
    out.save(OUT_DIR / out_name, "PNG")
    print(f"  -> {OUT_DIR / out_name}")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for src, dst in FILES:
        process(src, dst)
    print("done")


if __name__ == "__main__":
    main()
